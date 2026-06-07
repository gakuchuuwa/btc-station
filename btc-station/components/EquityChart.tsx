'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LineSeries,
  LineType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts'
import { DEFAULT_INITIAL_CAPITAL } from '@/lib/backtest/constants'

export interface TradeEquityInput {
  exit_time?: number
  pnl_abs: number
}

export interface EquityPoint {
  time: number
  equity: number
}

export interface EquitySummary {
  initial_capital?: number
  max_drawdown_pct?: number | null
  closed_max_drawdown_pct?: number | null
  max_drawdown_duration_days?: number | null
  max_dd_peak_ts?: number | null
  max_dd_trough_ts?: number | null
  max_dd_recovery_ts?: number | null
  closed_max_dd_peak_ts?: number | null
  closed_max_dd_trough_ts?: number | null
  closed_max_dd_recovery_ts?: number | null
  backtest_start?: string | null
  backtest_end?: string | null
  total_trades?: number
}

interface DrawdownZone {
  id: string
  from: number
  to: number
  fill: string
  border: string
  labelColor: string
  label: string
  pct: number
}

function buildDrawdownZones(summary?: EquitySummary | null): DrawdownZone[] {
  if (!summary) return []
  const zones: DrawdownZone[] = []

  const push = (
    id: string,
    peak: number | null | undefined,
    trough: number | null | undefined,
    pct: number | null | undefined,
    style: { fill: string; border: string; labelColor: string; label: string },
  ) => {
    if (peak == null || trough == null || pct == null || pct <= 0) return
    const from = normalizeUnixSec(peak)
    const to = normalizeUnixSec(trough)
    if (!from || !to || from >= to) return
    zones.push({
      id,
      from,
      to,
      pct: Math.abs(pct),
      ...style,
      label: style.label,
    })
  }

  push(
    'balance-dd',
    summary.closed_max_dd_peak_ts,
    summary.closed_max_dd_trough_ts,
    summary.closed_max_drawdown_pct,
    {
      fill: 'rgba(0,230,118,0.14)',
      border: 'rgba(0,230,118,0.55)',
      labelColor: '#00E676',
      label: '资金回撤',
    },
  )
  push(
    'equity-dd',
    summary.max_dd_peak_ts,
    summary.max_dd_trough_ts,
    summary.max_drawdown_pct,
    {
      fill: 'rgba(245,158,11,0.14)',
      border: 'rgba(245,158,11,0.55)',
      labelColor: '#f7931a',
      label: '权益回撤',
    },
  )
  return zones
}

interface EquityChartProps {
  trades?: TradeEquityInput[]
  equity?: EquityPoint[]
  balance?: EquityPoint[]
  summary?: EquitySummary | null
  rangeStart?: string
  rangeEnd?: string
  height?: number
  fillHeight?: boolean
  showHeader?: boolean
}

const isValidNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

function normalizeUnixSec(t: number): number {
  return t > 1e12 ? Math.floor(t / 1000) : t
}

function parseToUnixSec(input: string | null | undefined, endOfDay = false): number | undefined {
  if (!input?.trim()) return undefined
  const s = input.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const iso = endOfDay ? `${s}T23:59:59` : `${s}T00:00:00`
    const ms = Date.parse(iso)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
  }
  const iso = s.includes('T') ? s : s.replace(' ', 'T')
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

function formatDateLabel(sec: number): string {
  const d = new Date(sec * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toChartData(points: EquityPoint[]): { time: Time; value: number }[] {
  return points
    .filter(p => isValidNum(p.time) && isValidNum(p.equity))
    .map(p => ({ time: normalizeUnixSec(p.time) as Time, value: p.equity }))
    .sort((a, b) => (a.time as number) - (b.time as number))
    .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time)
}

/** 把稀疏结算点扩成与 equity 同时间轴的阶梯序列，否则 WithSteps 在缩放后几乎看不见 */
function expandBalanceSteps(balance: EquityPoint[], equity: EquityPoint[]): EquityPoint[] {
  if (balance.length === 0) return []
  if (equity.length === 0) return balance

  const bal = [...balance]
    .map(p => ({ time: normalizeUnixSec(p.time), equity: p.equity }))
    .sort((a, b) => a.time - b.time)

  const eqTimes = equity.map(p => normalizeUnixSec(p.time)).sort((a, b) => a - b)
  const out: EquityPoint[] = []
  let bi = 0
  let cur = bal[0].equity

  for (const t of eqTimes) {
    while (bi + 1 < bal.length && bal[bi + 1].time <= t) {
      bi++
      cur = bal[bi].equity
    }
    const prev = out[out.length - 1]
    if (!prev || prev.time !== t || prev.equity !== cur) {
      out.push({ time: t, equity: cur })
    }
  }

  const lastBal = bal[bal.length - 1]
  const lastT = eqTimes[eqTimes.length - 1]
  if (lastBal.time > lastT) {
    out.push({ time: lastBal.time, equity: lastBal.equity })
  }
  return out
}

/** 后端未返回 balance 时，从 trades 按出场时间重建阶梯资金曲线 */
export function buildBalanceFromTrades(
  trades: TradeEquityInput[],
  initialCapital: number,
  startTime?: number,
): EquityPoint[] {
  const closed = [...trades]
    .filter(t => t.exit_time && isValidNum(t.pnl_abs))
    .sort((a, b) => (a.exit_time ?? 0) - (b.exit_time ?? 0))
  if (closed.length === 0) return []

  const t0 = startTime ?? normalizeUnixSec(closed[0].exit_time!)
  const points: EquityPoint[] = [{ time: t0, equity: initialCapital }]
  let cum = initialCapital
  for (const t of closed) {
    cum += t.pnl_abs
    points.push({ time: normalizeUnixSec(t.exit_time!), equity: cum })
  }
  return points
}

function resolveTimeVisibleRange(
  series: EquityPoint[],
  rangeStart?: string,
  rangeEnd?: string,
  summary?: EquitySummary | null,
): { from: number; to: number } | null {
  if (series.length === 0) return null
  const start = rangeStart || summary?.backtest_start || undefined
  const end = rangeEnd || summary?.backtest_end || undefined
  const dataFrom = normalizeUnixSec(series[0].time)
  const dataTo = normalizeUnixSec(series[series.length - 1].time)
  let from = parseToUnixSec(start, false) ?? dataFrom
  let to = parseToUnixSec(end, true) ?? dataTo
  from = Math.max(from, dataFrom)
  to = Math.min(to, dataTo)
  if (from >= to) return { from: dataFrom, to: dataTo }
  return { from, to }
}

const CHART_OPTS = {
  layout: { background: { color: '#131722' }, textColor: '#787b86', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, attributionLogo: false },
  grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
  rightPriceScale: { borderColor: '#363a45' },
  crosshair: { vertLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#363a45' }, horzLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#363a45' } },
  handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
  handleScale: { axisPressedMouseMove: false, mouseWheel: false, pinch: false },
} as const

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{ width: 8, height: 8, borderRadius: 1, background: color, flexShrink: 0 }} />
      {label}
    </span>
  )
}

function DrawdownZoneOverlay({
  chartRef,
  wrapRef,
  zones,
}: {
  chartRef: React.RefObject<IChartApi | null>
  wrapRef: React.RefObject<HTMLDivElement | null>
  zones: DrawdownZone[]
}) {
  const [bands, setBands] = useState<Array<{ left: number; width: number; zone: DrawdownZone; labelTop: number }>>([])

  useEffect(() => {
    const chart = chartRef.current
    const wrap = wrapRef.current
    if (!chart || !wrap || zones.length === 0) {
      setBands([])
      return
    }

    const update = () => {
      const ts = chart.timeScale()
      const next = zones
        .map((zone, idx) => {
          const x1 = ts.timeToCoordinate(zone.from as Time)
          const x2 = ts.timeToCoordinate(zone.to as Time)
          if (x1 == null || x2 == null) return null
          const left = Math.min(x1, x2)
          const width = Math.abs(x2 - x1)
          if (width < 3) return null
          return { left, width, zone, labelTop: 6 + idx * 18 }
        })
        .filter((b): b is { left: number; width: number; zone: DrawdownZone; labelTop: number } => b != null)
      setBands(next)
    }

    update()
    chart.timeScale().subscribeVisibleTimeRangeChange(update)
    const ro = new ResizeObserver(update)
    ro.observe(wrap)
    return () => {
      chart.timeScale().unsubscribeVisibleTimeRangeChange(update)
      ro.disconnect()
    }
  }, [chartRef, wrapRef, zones])

  if (bands.length === 0) return null

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {bands.map(b => (
        <div
          key={b.zone.id}
          style={{
            position: 'absolute',
            top: 0,
            bottom: 22,
            left: b.left,
            width: b.width,
            background: b.zone.fill,
            borderLeft: `1px dashed ${b.zone.border}`,
            borderRight: `1px dashed ${b.zone.border}`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: b.labelTop,
              left: 4,
              padding: '1px 6px',
              borderRadius: 3,
              background: 'rgba(19,23,34,0.85)',
              border: `1px solid ${b.zone.border}`,
              color: b.zone.labelColor,
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {b.zone.label} -{b.zone.pct.toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  )
}

function MergedEquityPane({
  equity,
  balance,
  summary,
  rangeStart,
  rangeEnd,
  chartHeight,
}: {
  equity: EquityPoint[]
  balance: EquityPoint[]
  summary?: EquitySummary | null
  rangeStart?: string
  rangeEnd?: string
  chartHeight: number | string
}) {
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const equitySeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const balanceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)
  const equityMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const balanceMarkersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

  const chartBalance = useMemo(() => expandBalanceSteps(balance, equity), [balance, equity])
  const ddZones = useMemo(() => buildDrawdownZones(summary), [summary])

  const initialCapital = summary?.initial_capital ?? equity[0]?.equity ?? balance[0]?.equity ?? DEFAULT_INITIAL_CAPITAL
  const rangeSource = equity.length > 0 ? equity : balance
  const visibleRange = useMemo(
    () => resolveTimeVisibleRange(rangeSource, rangeStart, rangeEnd, summary),
    [rangeSource, rangeStart, rangeEnd, summary],
  )

  const applyRange = useCallback(() => {
    const chart = chartRef.current
    if (!chart) return
    try {
      if (visibleRange) {
        chart.timeScale().setVisibleRange({ from: visibleRange.from as Time, to: visibleRange.to as Time })
      } else {
        chart.timeScale().fitContent()
      }
      chart.priceScale('right').applyOptions({ autoScale: true })
    } catch {
      chart.timeScale().fitContent()
    }
  }, [visibleRange])

  const rangeRef = useRef(applyRange)
  rangeRef.current = applyRange

  useEffect(() => {
    const el = chartAreaRef.current
    if (!el) return
    const w = el.clientWidth || 800
    const h = typeof chartHeight === 'number' ? chartHeight : el.clientHeight || 120

    const chart = createChart(el, {
      ...CHART_OPTS,
      width: Math.max(w, 1),
      height: Math.max(h, 1),
      timeScale: {
        borderColor: '#363a45',
        timeVisible: true,
        rightOffset: 2,
        barSpacing: 6,
        minBarSpacing: 0.2,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
    })
    chartRef.current = chart

    // 先画权益（底层），再画资金（顶层），避免被盖住
    equitySeriesRef.current = chart.addSeries(LineSeries, {
      color: 'rgba(0,212,255,0.9)',
      lineWidth: 2,
      lineType: LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '权益',
    })

    balanceSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#00E676',
      lineWidth: 3,
      lineType: LineType.WithSteps,
      crosshairMarkerVisible: true,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '资金',
    })

    equityMarkersRef.current = createSeriesMarkers(equitySeriesRef.current, [])
    balanceMarkersRef.current = createSeriesMarkers(balanceSeriesRef.current, [])

    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height: rh } = entry.contentRect
      if (width > 0 && rh > 0) chart.applyOptions({ width, height: rh })
      rangeRef.current()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      equitySeriesRef.current = null
      balanceSeriesRef.current = null
      equityMarkersRef.current = null
      balanceMarkersRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!chartRef.current) return

    if (balanceSeriesRef.current && chartBalance.length > 0) {
      balanceSeriesRef.current.setData(toChartData(chartBalance))
    }

    if (equitySeriesRef.current && equity.length > 0) {
      equitySeriesRef.current.setData(toChartData(equity))
    }

    applyRange()
  }, [equity, chartBalance, applyRange])

  useEffect(() => {
    const eqMarkers: Array<{ time: Time; position: 'aboveBar' | 'belowBar'; color: string; shape: 'circle' | 'arrowDown'; text: string }> = []
    const balMarkers: Array<{ time: Time; position: 'aboveBar' | 'belowBar'; color: string; shape: 'circle' | 'arrowDown'; text: string }> = []

    if (summary?.max_dd_peak_ts && summary.max_dd_trough_ts) {
      const pct = Math.abs(summary.max_drawdown_pct ?? 0)
      eqMarkers.push(
        { time: normalizeUnixSec(summary.max_dd_peak_ts) as Time, position: 'aboveBar', color: '#f7931a', shape: 'circle', text: '权益峰' },
        { time: normalizeUnixSec(summary.max_dd_trough_ts) as Time, position: 'belowBar', color: '#f7931a', shape: 'arrowDown', text: pct > 0 ? `-${pct.toFixed(1)}%` : '谷底' },
      )
    }
    if (summary?.closed_max_dd_peak_ts && summary.closed_max_dd_trough_ts) {
      const pct = Math.abs(summary.closed_max_drawdown_pct ?? 0)
      balMarkers.push(
        { time: normalizeUnixSec(summary.closed_max_dd_peak_ts) as Time, position: 'aboveBar', color: '#00E676', shape: 'circle', text: '资金峰' },
        { time: normalizeUnixSec(summary.closed_max_dd_trough_ts) as Time, position: 'belowBar', color: '#00E676', shape: 'arrowDown', text: pct > 0 ? `-${pct.toFixed(1)}%` : '谷底' },
      )
    }

    equityMarkersRef.current?.setMarkers(eqMarkers)
    balanceMarkersRef.current?.setMarkers(balMarkers)
  }, [summary])

  const wrapStyle: React.CSSProperties = {
    position: 'relative',
    flex: 1,
    minHeight: 80,
    height: chartHeight === '100%' ? '100%' : chartHeight,
    display: 'flex',
    flexDirection: 'column',
  }

  return (
    <div ref={wrapRef} style={wrapStyle}>
      <div ref={chartAreaRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />
      <DrawdownZoneOverlay chartRef={chartRef} wrapRef={wrapRef} zones={ddZones} />
    </div>
  )
}

export default function EquityChart({
  trades = [],
  equity = [],
  balance: balanceProp = [],
  summary,
  rangeStart,
  rangeEnd,
  height = 172,
  fillHeight = false,
  showHeader = true,
}: EquityChartProps) {
  const initialCapital = summary?.initial_capital ?? DEFAULT_INITIAL_CAPITAL

  const balance = useMemo(() => {
    if (balanceProp.length > 0) return balanceProp
    // 不从 trades 重建：strategy 多腿 PnL 与 VBT equity 口径不一致
    return []
  }, [balanceProp])

  const hasEquity = equity.length > 0
  const hasBalance = balance.length > 0

  const timeRange = useMemo(
    () => resolveTimeVisibleRange(hasEquity ? equity : balance, rangeStart, rangeEnd, summary),
    [equity, balance, rangeStart, rangeEnd, summary, hasEquity],
  )

  const endBalance = hasBalance ? balance[balance.length - 1].equity : initialCapital
  const endEquity = hasEquity ? equity[equity.length - 1].equity : endBalance

  const balanceMaxDd = summary?.closed_max_drawdown_pct != null
    ? Math.abs(summary.closed_max_drawdown_pct)
    : null
  const equityMaxDd = summary?.max_drawdown_pct != null ? Math.abs(summary.max_drawdown_pct) : null
  const equityDdDays = summary?.max_drawdown_duration_days
  const ddZones = useMemo(() => buildDrawdownZones(summary), [summary])

  const outerStyle: React.CSSProperties = fillHeight
    ? { display: 'flex', flexDirection: 'column', height: '100%', background: '#131722', borderTop: showHeader ? '1px solid #363a45' : undefined }
    : { display: 'flex', flexDirection: 'column', height, background: '#131722', borderTop: '1px solid #363a45', flexShrink: 0 }

  const chartBodyHeight = fillHeight ? '100%' : Math.max(80, height - (showHeader ? 32 : 0))

  if (!hasEquity && !hasBalance) {
    return (
      <div style={{ ...outerStyle, alignItems: 'center', justifyContent: 'center', color: '#787b86', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
        运行回测后显示资金 / 权益曲线
      </div>
    )
  }

  return (
    <div style={outerStyle}>
      {showHeader && (
        <div
          style={{
            height: 32,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 12px',
            fontSize: 12,
            fontFamily: "'JetBrains Mono', monospace",
            color: '#787b86',
            flexShrink: 0,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            overflow: 'hidden',
          }}
        >
          <LegendDot color="#00E676" label="资金" />
          {balanceMaxDd != null && balanceMaxDd > 0 && (
            <span style={{ fontSize: 11 }}>
              资金回撤 <b style={{ color: '#ef5350' }}>-{balanceMaxDd.toFixed(2)}%</b>
            </span>
          )}
          <LegendDot color="#00d4ff" label="权益" />
          {equityMaxDd != null && equityMaxDd > 0 && (
            <span style={{ fontSize: 11 }}>
              权益回撤 <b style={{ color: '#f7931a' }}>-{equityMaxDd.toFixed(2)}%</b>
              {equityDdDays != null ? ` · ${equityDdDays} 天` : ''}
            </span>
          )}
          {timeRange && (
            <span style={{ color: '#5d606b', fontSize: 10, marginLeft: 2 }}>
              {formatDateLabel(timeRange.from)} ~ {formatDateLabel(timeRange.to)}
            </span>
          )}
          {(ddZones.length > 0) && (
            <span style={{ color: '#5d606b', fontSize: 10 }} title="峰值→谷底区间">
              色带=回撤段
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10 }}>
            初始 <b style={{ color: '#d1d4dc' }}>${initialCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>
          </span>
          {hasBalance && (
            <span style={{ fontSize: 10 }}>
              资金 <b style={{ color: endBalance >= initialCapital ? '#26a69a' : '#ef5350' }}>
                ${endBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </b>
            </span>
          )}
          {hasEquity && (
            <span style={{ fontSize: 10 }}>
              权益 <b style={{ color: endEquity >= initialCapital ? '#00d4ff' : '#ef5350' }}>
                ${endEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </b>
            </span>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 80, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <MergedEquityPane
          equity={equity}
          balance={balance}
          summary={summary}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          chartHeight={chartBodyHeight}
        />
        {hasEquity && !hasBalance && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 12,
              right: 12,
              padding: '6px 10px',
              borderRadius: 4,
              background: 'rgba(245,158,11,0.12)',
              border: '1px solid rgba(245,158,11,0.35)',
              color: '#f59e0b',
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
              pointerEvents: 'none',
            }}
          >
            仅显示权益曲线（青色）。请重新运行回测以加载资金曲线（绿色阶梯线）。
          </div>
        )}
      </div>
    </div>
  )
}
