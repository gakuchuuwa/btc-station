'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  BaselineSeries,
  LineSeries,
  LineType,
  createChart,
  type IChartApi,
  type ISeriesApi,
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
  backtest_start?: string | null
  backtest_end?: string | null
  total_trades?: number
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
  const chartRef = useRef<IChartApi | null>(null)
  const equitySeriesRef = useRef<ISeriesApi<'Baseline'> | null>(null)
  const balanceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null)

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

    balanceSeriesRef.current = chart.addSeries(LineSeries, {
      color: '#26A69A',
      lineWidth: 2,
      lineType: LineType.WithSteps,
      priceLineVisible: false,
      lastValueVisible: true,
      title: '资金',
    })

    equitySeriesRef.current = chart.addSeries(BaselineSeries, {
      topLineColor: 'rgba(0,212,255,0.85)',
      bottomLineColor: 'rgba(0,212,255,0.55)',
      topFillColor1: 'rgba(0,212,255,0.12)',
      topFillColor2: 'rgba(0,212,255,0.02)',
      bottomFillColor1: 'rgba(0,212,255,0.08)',
      bottomFillColor2: 'rgba(0,212,255,0.01)',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      baseValue: { type: 'price', price: initialCapital },
      title: '权益',
    })

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
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!chartRef.current) return

    if (balanceSeriesRef.current && balance.length > 0) {
      balanceSeriesRef.current.setData(toChartData(balance))
    }

    if (equitySeriesRef.current && equity.length > 0) {
      equitySeriesRef.current.setData(toChartData(equity))
      equitySeriesRef.current.applyOptions({ baseValue: { type: 'price', price: initialCapital } })
    }

    applyRange()
  }, [equity, balance, initialCapital, applyRange])

  return <div ref={chartAreaRef} style={{ flex: 1, minHeight: 80, height: chartHeight === '100%' ? undefined : chartHeight }} />
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
    const startTime = equity.length > 0 ? normalizeUnixSec(equity[0].time) : undefined
    return buildBalanceFromTrades(trades, initialCapital, startTime)
  }, [balanceProp, trades, initialCapital, equity])

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

  const outerStyle: React.CSSProperties = fillHeight
    ? { display: 'flex', flexDirection: 'column', height: '100%', background: '#131722', borderTop: showHeader ? '1px solid #363a45' : undefined }
    : { display: 'flex', flexDirection: 'column', height, background: '#131722', borderTop: '1px solid #363a45', flexShrink: 0 }

  const chartBodyHeight = fillHeight ? '100%' : Math.max(80, height - (showHeader ? 28 : 0))

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
            height: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '0 12px',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            color: '#787b86',
            flexShrink: 0,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            overflow: 'hidden',
          }}
        >
          <LegendDot color="#26A69A" label="资金" />
          {balanceMaxDd != null && balanceMaxDd > 0 && (
            <span style={{ fontSize: 10 }}>
              回撤 <b style={{ color: '#ef5350' }}>-{balanceMaxDd.toFixed(2)}%</b>
            </span>
          )}
          <LegendDot color="#00d4ff" label="权益" />
          {equityMaxDd != null && equityMaxDd > 0 && (
            <span style={{ fontSize: 10 }}>
              回撤 <b style={{ color: '#ef5350' }}>-{equityMaxDd.toFixed(2)}%</b>
              {equityDdDays != null ? ` · ${equityDdDays} 天` : ''}
            </span>
          )}
          {timeRange && (
            <span style={{ color: '#5d606b', fontSize: 10, marginLeft: 2 }}>
              {formatDateLabel(timeRange.from)} ~ {formatDateLabel(timeRange.to)}
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
      <div style={{ flex: 1, minHeight: 80, display: 'flex', flexDirection: 'column' }}>
        <MergedEquityPane
          equity={equity}
          balance={balance}
          summary={summary}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          chartHeight={chartBodyHeight}
        />
      </div>
    </div>
  )
}
