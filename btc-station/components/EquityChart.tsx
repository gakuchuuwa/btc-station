'use client'

import { useCallback, useEffect, useRef } from 'react'
import { BaselineSeries, createChart, type IChartApi, type ISeriesApi, type Time } from 'lightweight-charts'
import { DEFAULT_INITIAL_CAPITAL } from '@/lib/backtest/constants'

export interface EquityPoint {
  time: number
  equity: number
}

export interface EquitySummary {
  initial_capital?: number
  max_drawdown_pct?: number
  max_drawdown_duration_days?: number | null
  backtest_start?: string | null
  backtest_end?: string | null
}

interface EquityChartProps {
  equity: EquityPoint[]
  summary?: EquitySummary | null
  /** 回测区间起点（yyyy-mm-dd 或 ISO，优先于 summary.backtest_start） */
  rangeStart?: string
  /** 回测区间终点 */
  rangeEnd?: string
  /** 含标题栏的总高度；fillHeight 为 true 时忽略 */
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

function resolveVisibleRange(
  equity: EquityPoint[],
  rangeStart?: string,
  rangeEnd?: string,
): { from: number; to: number } | null {
  if (equity.length === 0) return null
  const dataFrom = normalizeUnixSec(equity[0].time)
  const dataTo = normalizeUnixSec(equity[equity.length - 1].time)

  let from = parseToUnixSec(rangeStart, false) ?? dataFrom
  let to = parseToUnixSec(rangeEnd, true) ?? dataTo
  from = Math.max(from, dataFrom)
  to = Math.min(to, dataTo)
  if (from >= to) return { from: dataFrom, to: dataTo }
  return { from, to }
}

function formatRangeLabel(from: number, to: number): string {
  const fmt = (sec: number) => {
    const d = new Date(sec * 1000)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return `${fmt(from)} ~ ${fmt(to)}`
}

export default function EquityChart({
  equity,
  summary,
  rangeStart,
  rangeEnd,
  height = 172,
  fillHeight = false,
  showHeader = true,
}: EquityChartProps) {
  const chartAreaRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Baseline'> | null>(null)

  const effectiveStart = rangeStart || summary?.backtest_start || undefined
  const effectiveEnd = rangeEnd || summary?.backtest_end || undefined
  const visibleRange = resolveVisibleRange(equity, effectiveStart, effectiveEnd)

  const initialCapital = summary?.initial_capital ?? equity[0]?.equity ?? DEFAULT_INITIAL_CAPITAL
  const endEquity = equity.length > 0 ? equity[equity.length - 1].equity : initialCapital
  const maxDd = summary?.max_drawdown_pct != null ? Math.abs(summary.max_drawdown_pct) : null
  const ddDays = summary?.max_drawdown_duration_days

  const applyFixedTimeRange = useCallback(() => {
    const chart = chartRef.current
    if (!chart || !visibleRange) return
    try {
      chart.timeScale().setVisibleRange({
        from: visibleRange.from as Time,
        to: visibleRange.to as Time,
      })
      chart.priceScale('right').applyOptions({ autoScale: true })
    } catch (e) {
      console.warn('[EquityChart] 设置可见区间失败，回退 fitContent:', e)
      chart.timeScale().fitContent()
    }
  }, [visibleRange])

  const applyRangeRef = useRef(applyFixedTimeRange)
  applyRangeRef.current = applyFixedTimeRange

  useEffect(() => {
    const chartArea = chartAreaRef.current
    if (!chartArea) return

    const w = chartArea.clientWidth || 800
    const h = chartArea.clientHeight || 120

    const chart = createChart(chartArea, {
      layout: { background: { color: '#131722' }, textColor: '#787b86', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
      rightPriceScale: { borderColor: '#363a45' },
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
      crosshair: { vertLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#363a45' }, horzLine: { color: 'rgba(0,212,255,0.25)', labelBackgroundColor: '#363a45' } },
      // 锁定时间轴：只允许十字线查看，禁止拖拽/缩放导致无法恢复
      handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: false, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: false, mouseWheel: false, pinch: false },
      width: Math.max(w, 1),
      height: Math.max(h, 1),
    })
    chartRef.current = chart

    const series = chart.addSeries(BaselineSeries, {
      baseValue: { type: 'price', price: initialCapital },
      topLineColor: '#26A69A',
      bottomLineColor: '#EF5350',
      topFillColor1: 'rgba(38,166,154,0.35)',
      topFillColor2: 'rgba(38,166,154,0.05)',
      bottomFillColor1: 'rgba(239,83,80,0.25)',
      bottomFillColor2: 'rgba(239,83,80,0.05)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    })
    seriesRef.current = series

    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height: rh } = entry.contentRect
      if (width > 0 && rh > 0) chart.applyOptions({ width, height: rh })
      applyRangeRef.current()
    })
    ro.observe(chartArea)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 图表实例只初始化一次
  }, [])

  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || equity.length === 0) return

    const sorted = equity
      .filter(p => isValidNum(p.time) && isValidNum(p.equity))
      .map(p => ({
        time: normalizeUnixSec(p.time) as Time,
        value: p.equity,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time)

    if (sorted.length === 0) return

    try {
      seriesRef.current.setData(sorted)
      seriesRef.current.applyOptions({
        baseValue: { type: 'price', price: initialCapital },
      })
    } catch (e) {
      console.error('[EquityChart] 权益数据加载错误:', e)
    }

    applyFixedTimeRange()
  }, [equity, initialCapital, applyFixedTimeRange])

  const outerStyle: React.CSSProperties = fillHeight
    ? { display: 'flex', flexDirection: 'column', height: '100%', background: '#131722', borderTop: showHeader ? '1px solid #363a45' : undefined }
    : { display: 'flex', flexDirection: 'column', height, background: '#131722', borderTop: '1px solid #363a45', flexShrink: 0 }

  return (
    <div style={outerStyle}>
      {showHeader && (
        <div
          style={{
            height: 28,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 12px',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            color: '#787b86',
            flexShrink: 0,
            borderBottom: '1px solid rgba(255,255,255,0.04)',
          }}
        >
          <span style={{ fontWeight: 600, color: '#26a69a' }}>资金曲线</span>
          {visibleRange && (
            <span style={{ color: '#5d606b', fontSize: 10 }} title="固定为回测时间区间">
              {formatRangeLabel(visibleRange.from, visibleRange.to)}
            </span>
          )}
          {maxDd != null && (
            <span>
              最大回撤 <b style={{ color: '#ef5350' }}>-{maxDd.toFixed(2)}%</b>
              {ddDays != null ? ` · ${ddDays} 天` : ''}
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>
            初始 <b style={{ color: '#d1d4dc' }}>${initialCapital.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b>
          </span>
          <span>
            当前 <b style={{ color: endEquity >= initialCapital ? '#26a69a' : '#ef5350' }}>
              ${endEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </b>
          </span>
          {visibleRange && (
            <button
              type="button"
              onClick={applyFixedTimeRange}
              title="重新对齐回测时间区间"
              style={{
                marginLeft: 4,
                padding: '1px 6px',
                fontSize: 10,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#787b86',
                background: 'transparent',
                border: '1px solid #363a45',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              重置区间
            </button>
          )}
        </div>
      )}
      <div ref={chartAreaRef} style={{ flex: 1, minHeight: 80, position: 'relative' }} />
    </div>
  )
}
