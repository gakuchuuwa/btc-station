'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BaselineSeries, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts'
import { DEFAULT_INITIAL_CAPITAL } from '@/lib/backtest/constants'

export type EquityChartMode = 'trades' | 'time'

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
  summary?: EquitySummary | null
  rangeStart?: string
  rangeEnd?: string
  height?: number
  fillHeight?: boolean
  showHeader?: boolean
  /** 默认视图：有交易时默认按笔 */
  defaultMode?: EquityChartMode
}

const TRADE_AXIS_BASE = 1_704_067_200
const TRADE_AXIS_STEP = 86_400

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

export interface TradeEquityPoint {
  tradeIndex: number
  equity: number
  time: number
}

export function buildTradeEquitySeries(trades: TradeEquityInput[], initialCapital: number): TradeEquityPoint[] {
  const closed = [...trades]
    .filter(t => t.exit_time && isValidNum(t.pnl_abs))
    .sort((a, b) => (a.exit_time ?? 0) - (b.exit_time ?? 0))

  const points: TradeEquityPoint[] = [{ tradeIndex: 0, equity: initialCapital, time: TRADE_AXIS_BASE }]
  let cum = initialCapital
  closed.forEach((t, i) => {
    cum += t.pnl_abs
    points.push({ tradeIndex: i + 1, equity: cum, time: TRADE_AXIS_BASE + (i + 1) * TRADE_AXIS_STEP })
  })
  return points
}

function computeDrawdownFromValues(values: number[]) {
  if (values.length < 2) {
    return { maxDdPct: 0, durationTrades: 0 }
  }
  let maxDd = 0
  let peakIdx = 0
  let troughIdx = 0
  let curPeak = values[0]
  let curPeakIdx = 0

  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v > curPeak) {
      curPeak = v
      curPeakIdx = i
    }
    const dd = curPeak > 0 ? (curPeak - v) / curPeak : 0
    if (dd > maxDd) {
      maxDd = dd
      peakIdx = curPeakIdx
      troughIdx = i
    }
  }

  const peakVal = values[peakIdx]
  let recoveryIdx = values.length - 1
  for (let j = troughIdx + 1; j < values.length; j++) {
    if (values[j] >= peakVal) {
      recoveryIdx = j
      break
    }
  }

  return { maxDdPct: maxDd * 100, durationTrades: Math.max(0, recoveryIdx - peakIdx) }
}

function resolveTimeVisibleRange(
  equity: EquityPoint[],
  rangeStart?: string,
  rangeEnd?: string,
  summary?: EquitySummary | null,
): { from: number; to: number } | null {
  if (equity.length === 0) return null
  const start = rangeStart || summary?.backtest_start || undefined
  const end = rangeEnd || summary?.backtest_end || undefined
  const dataFrom = normalizeUnixSec(equity[0].time)
  const dataTo = normalizeUnixSec(equity[equity.length - 1].time)
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

const BASELINE_OPTS = {
  topLineColor: '#26A69A',
  bottomLineColor: '#EF5350',
  topFillColor1: 'rgba(38,166,154,0.35)',
  topFillColor2: 'rgba(38,166,154,0.05)',
  bottomFillColor1: 'rgba(239,83,80,0.25)',
  bottomFillColor2: 'rgba(239,83,80,0.05)',
  lineWidth: 2,
  priceLineVisible: false,
  lastValueVisible: true,
} as const

function ModeToggle({
  mode,
  onChange,
  hasTrades,
  hasTime,
}: {
  mode: EquityChartMode
  onChange: (m: EquityChartMode) => void
  hasTrades: boolean
  hasTime: boolean
}) {
  const btn = (m: EquityChartMode, label: string, enabled: boolean) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => enabled && onChange(m)}
      style={{
        padding: '2px 8px',
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
        border: '1px solid #363a45',
        borderRadius: 3,
        cursor: enabled ? 'pointer' : 'not-allowed',
        color: mode === m ? '#00d4ff' : '#787b86',
        background: mode === m ? 'rgba(0,212,255,0.1)' : 'transparent',
        opacity: enabled ? 1 : 0.4,
      }}
    >
      {label}
    </button>
  )
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      {btn('trades', '按笔', hasTrades)}
      {btn('time', '按时间', hasTime)}
    </span>
  )
}

function TradeEquityPane({
  trades,
  summary,
  chartHeight,
}: {
  trades: TradeEquityInput[]
  summary?: EquitySummary | null
  chartHeight: number | string
}) {
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null)

  const initialCapital = summary?.initial_capital ?? DEFAULT_INITIAL_CAPITAL
  const series = useMemo(() => buildTradeEquitySeries(trades, initialCapital), [trades, initialCapital])
  const closedCount = Math.max(0, series.length - 1)
  const values = series.map(p => p.equity)
  const ddStats = useMemo(() => computeDrawdownFromValues(values), [values])

  const fitView = useCallback(() => {
    chartRef.current?.timeScale().fitContent()
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true })
  }, [])

  const fitRef = useRef(fitView)
  fitRef.current = fitView

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
        barSpacing: 8,
        minBarSpacing: 2,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      localization: {
        timeFormatter: (time: Time) => {
          const idx = Math.round(((time as number) - TRADE_AXIS_BASE) / TRADE_AXIS_STEP)
          return idx <= 0 ? '初始本金' : `第 ${idx} 笔`
        },
      },
    })
    chartRef.current = chart
    seriesRef.current = chart.addSeries(BaselineSeries, {
      ...BASELINE_OPTS,
      baseValue: { type: 'price', price: initialCapital },
    })

    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height: rh } = entry.contentRect
      if (width > 0 && rh > 0) chart.applyOptions({ width, height: rh })
      fitRef.current()
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || series.length === 0) return
    const data = series.map(p => ({ time: p.time as Time, value: p.equity }))
    seriesRef.current.setData(data)
    seriesRef.current.applyOptions({ baseValue: { type: 'price', price: initialCapital } })
    fitView()
  }, [series, initialCapital, fitView])

  return <div ref={chartAreaRef} style={{ flex: 1, minHeight: 80, height: chartHeight === '100%' ? undefined : chartHeight }} />
}

function TimeEquityPane({
  equity,
  summary,
  rangeStart,
  rangeEnd,
  chartHeight,
}: {
  equity: EquityPoint[]
  summary?: EquitySummary | null
  rangeStart?: string
  rangeEnd?: string
  chartHeight: number | string
}) {
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null)

  const initialCapital = summary?.initial_capital ?? equity[0]?.equity ?? DEFAULT_INITIAL_CAPITAL
  const visibleRange = useMemo(
    () => resolveTimeVisibleRange(equity, rangeStart, rangeEnd, summary),
    [equity, rangeStart, rangeEnd, summary],
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
    seriesRef.current = chart.addSeries(BaselineSeries, {
      ...BASELINE_OPTS,
      baseValue: { type: 'price', price: initialCapital },
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
      seriesRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || equity.length === 0) return
    const data = equity
      .filter(p => isValidNum(p.time) && isValidNum(p.equity))
      .map(p => ({ time: normalizeUnixSec(p.time) as Time, value: p.equity }))
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time)

    seriesRef.current.setData(data)
    seriesRef.current.applyOptions({ baseValue: { type: 'price', price: initialCapital } })
    applyRange()
  }, [equity, initialCapital, applyRange])

  return <div ref={chartAreaRef} style={{ flex: 1, minHeight: 80, height: chartHeight === '100%' ? undefined : chartHeight }} />
}

export default function EquityChart({
  trades = [],
  equity = [],
  summary,
  rangeStart,
  rangeEnd,
  height = 172,
  fillHeight = false,
  showHeader = true,
  defaultMode = 'trades',
}: EquityChartProps) {
  const closedTrades = useMemo(
    () => trades.filter(t => t.exit_time && isValidNum(t.pnl_abs)),
    [trades],
  )
  const hasTrades = closedTrades.length > 0
  const hasTime = equity.length > 0

  const [mode, setMode] = useState<EquityChartMode>(() => {
    if (defaultMode === 'trades' && hasTrades) return 'trades'
    if (hasTime) return 'time'
    if (hasTrades) return 'trades'
    return 'time'
  })

  useEffect(() => {
    if (mode === 'trades' && !hasTrades && hasTime) setMode('time')
    if (mode === 'time' && !hasTime && hasTrades) setMode('trades')
  }, [mode, hasTrades, hasTime])

  const initialCapital = summary?.initial_capital ?? DEFAULT_INITIAL_CAPITAL
  const tradeSeries = useMemo(
    () => (hasTrades ? buildTradeEquitySeries(trades, initialCapital) : []),
    [trades, initialCapital, hasTrades],
  )
  const tradeValues = tradeSeries.map(p => p.equity)
  const tradeDd = useMemo(() => computeDrawdownFromValues(tradeValues), [tradeValues])
  const timeRange = useMemo(
    () => resolveTimeVisibleRange(equity, rangeStart, rangeEnd, summary),
    [equity, rangeStart, rangeEnd, summary],
  )

  const endEquity = mode === 'trades'
    ? (tradeSeries.length > 0 ? tradeSeries[tradeSeries.length - 1].equity : initialCapital)
    : (equity.length > 0 ? equity[equity.length - 1].equity : initialCapital)

  const outerStyle: React.CSSProperties = fillHeight
    ? { display: 'flex', flexDirection: 'column', height: '100%', background: '#131722', borderTop: showHeader ? '1px solid #363a45' : undefined }
    : { display: 'flex', flexDirection: 'column', height, background: '#131722', borderTop: '1px solid #363a45', flexShrink: 0 }

  const chartBodyHeight = fillHeight ? '100%' : Math.max(80, height - (showHeader ? 28 : 0))

  if (!hasTrades && !hasTime) {
    return (
      <div style={{ ...outerStyle, alignItems: 'center', justifyContent: 'center', color: '#787b86', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>
        运行回测后显示资金曲线
      </div>
    )
  }

  const tradeMaxDd = summary?.closed_max_drawdown_pct != null
    ? Math.abs(summary.closed_max_drawdown_pct)
    : tradeDd.maxDdPct
  const timeMaxDd = summary?.max_drawdown_pct != null ? Math.abs(summary.max_drawdown_pct) : null
  const timeDdDays = summary?.max_drawdown_duration_days

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
          }}
        >
          <span style={{ fontWeight: 600, color: '#26a69a' }}>资金曲线</span>
          <ModeToggle mode={mode} onChange={setMode} hasTrades={hasTrades} hasTime={hasTime} />
          {mode === 'trades' ? (
            <>
              <span style={{ color: '#5d606b', fontSize: 10 }}>{closedTrades.length} 笔 · 出场结算</span>
              {tradeMaxDd > 0 && (
                <span>
                  最大回撤 <b style={{ color: '#ef5350' }}>-{tradeMaxDd.toFixed(2)}%</b>
                  {tradeDd.durationTrades > 0 ? ` · ${tradeDd.durationTrades} 笔` : ''}
                </span>
              )}
            </>
          ) : (
            <>
              {timeRange && (
                <span style={{ color: '#5d606b', fontSize: 10 }}>
                  {formatDateLabel(timeRange.from)} ~ {formatDateLabel(timeRange.to)}
                </span>
              )}
              {timeMaxDd != null && timeMaxDd > 0 && (
                <span>
                  最大回撤 <b style={{ color: '#ef5350' }}>-{timeMaxDd.toFixed(2)}%</b>
                  {timeDdDays != null ? ` · ${timeDdDays} 天` : ''}
                </span>
              )}
            </>
          )}
          <span style={{ marginLeft: 'auto' }}>
            初始 <b style={{ color: '#d1d4dc' }}>${initialCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>
          </span>
          <span>
            当前 <b style={{ color: endEquity >= initialCapital ? '#26a69a' : '#ef5350' }}>
              ${endEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </b>
          </span>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 80, display: 'flex', flexDirection: 'column' }}>
        {mode === 'trades' && hasTrades ? (
          <TradeEquityPane trades={trades} summary={summary} chartHeight={chartBodyHeight} />
        ) : hasTime ? (
          <TimeEquityPane
            equity={equity}
            summary={summary}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            chartHeight={chartBodyHeight}
          />
        ) : null}
      </div>
    </div>
  )
}
