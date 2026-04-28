'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
} from 'lightweight-charts'
import { formatUsd, formatPercent } from '@/lib/format'
import type { Market } from '@/lib/okx'

// ============================
// 指标计算（客户端 JS）
// ============================
function calcMA(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) =>
    i < period - 1 ? null : closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  )
}

function calcEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = [closes[0]]
  for (let i = 1; i < closes.length; i++) {
    result.push(closes[i] * k + result[i - 1] * (1 - k))
  }
  return result
}

function calcBB(closes: number[], period: number, stdDevMult: number) {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const slice = closes.slice(i - period + 1, i + 1)
    const mean = slice.reduce((a, b) => a + b, 0) / period
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period
    const std = Math.sqrt(variance)
    return { upper: mean + stdDevMult * std, middle: mean, lower: mean - stdDevMult * std }
  })
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(period).fill(null)
  for (let i = period; i < closes.length; i++) {
    let gains = 0, losses = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1]
      if (d > 0) gains += d; else losses -= d
    }
    const rs = losses === 0 ? 100 : gains / losses
    result.push(100 - 100 / (1 + rs))
  }
  return result
}

function calcMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const ema = (data: number[], period: number) => {
    const k = 2 / (period + 1)
    const result: number[] = [data[0]]
    for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i - 1] * (1 - k))
    return result
  }
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)
  const dif = emaFast.map((v, i) => v - emaSlow[i])
  const dea = ema(dif, signal)
  const hist = dif.map((v, i) => v - dea[i])
  return { dif, dea, hist }
}

function calcStochastic(highs: number[], lows: number[], closes: number[], kPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const rawK: (number | null)[] = closes.map((_, i) => {
    if (i < kPeriod - 1) return null
    const sliceH = highs.slice(i - kPeriod + 1, i + 1)
    const sliceL = lows.slice(i - kPeriod + 1, i + 1)
    const hh = Math.max(...sliceH)
    const ll = Math.min(...sliceL)
    return hh === ll ? 0 : (closes[i] - ll) / (hh - ll) * 100
  })
  const smoothedK: (number | null)[] = rawK.map((_, i) => {
    const start = i - kSmooth + 1
    if (start < 0) return null
    const slice = rawK.slice(start, i + 1)
    if (slice.some(v => v === null)) return null
    return (slice as number[]).reduce((a, b) => a + b, 0) / kSmooth
  })
  const smoothedD: (number | null)[] = smoothedK.map((_, i) => {
    const start = i - dPeriod + 1
    if (start < 0) return null
    const slice = smoothedK.slice(start, i + 1)
    if (slice.some(v => v === null)) return null
    return (slice as number[]).reduce((a, b) => a + b, 0) / dPeriod
  })
  return { k: smoothedK, d: smoothedD }
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): (number | null)[] {
  const tr = highs.map((h, i) => {
    if (i === 0) return h - lows[i]
    return Math.max(h - lows[i], Math.abs(h - closes[i - 1]), Math.abs(lows[i] - closes[i - 1]))
  })
  return tr.map((_, i) => {
    if (i < period - 1) return null
    return tr.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
  })
}

function calcOBV(closes: number[], volumes: number[]): number[] {
  const result: number[] = [volumes[0]]
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) result.push(result[i - 1] + volumes[i])
    else if (closes[i] < closes[i - 1]) result.push(result[i - 1] - volumes[i])
    else result.push(result[i - 1])
  }
  return result
}

// ============================
// 型定義
// ============================
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d', '1w']
const TF_LABELS: Record<string, string> = {
  '1m': '1分', '5m': '5分', '15m': '15分',
  '1h': '1时', '4h': '4时', '1d': '日', '1w': '周',
}

interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

interface IndicatorParams {
  ma:         { enabled: boolean; periods: number[]; colors: string[] }
  ema:        { enabled: boolean; periods: number[]; colors: string[] }
  bollinger:  { enabled: boolean; period: number; stdDev: number }
  rsi:        { enabled: boolean; period: number; overbought: number; oversold: number }
  macd:       { enabled: boolean; fast: number; slow: number; signal: number }
  stochastic: { enabled: boolean; k_period: number; k_smooth: number; d_period: number }
  atr:        { enabled: boolean; period: number }
  obv:        { enabled: boolean; ma_period: number; color: string }
  volume_ma:  { enabled: boolean; period: number }
}

const DEFAULT_INDICATOR_PARAMS: IndicatorParams = {
  ma:         { enabled: true,  periods: [20, 50], colors: ['#F7931A', '#2962FF'] },
  ema:        { enabled: false, periods: [20, 50], colors: ['#00BCD4', '#E91E63'] },
  bollinger:  { enabled: false, period: 20, stdDev: 2.0 },
  rsi:        { enabled: false, period: 14, overbought: 70, oversold: 30 },
  macd:       { enabled: false, fast: 12, slow: 26, signal: 9 },
  stochastic: { enabled: false, k_period: 14, k_smooth: 3, d_period: 3 },
  atr:        { enabled: false, period: 14 },
  obv:        { enabled: false, ma_period: 0, color: '#00BCD4' },
  volume_ma:  { enabled: false, period: 20 },
}

// 画线类型
export type DrawingType = 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci' | 'text'
export type ActiveTool = 'cursor' | DrawingType | 'delete'

interface DrawingBase { id: string; color: string; width: number }
interface TrendlineDrawing extends DrawingBase { type: 'trendline'; p1: { time: number; price: number }; p2: { time: number; price: number } }
interface HorizontalDrawing extends DrawingBase { type: 'horizontal'; price: number }
interface RectangleDrawing extends DrawingBase { type: 'rectangle'; p1: { time: number; price: number }; p2: { time: number; price: number }; fillAlpha: number }
interface FibonacciDrawing extends DrawingBase { type: 'fibonacci'; p1: { time: number; price: number }; p2: { time: number; price: number } }
interface TextDrawing extends DrawingBase { type: 'text'; pos: { time: number; price: number }; content: string }

type Drawing = TrendlineDrawing | HorizontalDrawing | RectangleDrawing | FibonacciDrawing | TextDrawing

interface PerpInfo {
  fundingRate: { current: number; nextSettleAt: number }
  openInterest: { contracts: number; usdValue: number }
  longShortRatio: number
}

// ============================
// チャート共通設定
// ============================
const CHART_COLORS = {
  bg: 'transparent',
  text: '#787B86',
  grid: 'rgba(255,255,255,0.04)',
  border: '#222A35',
  up: '#26A69A',
  down: '#EF5350',
}

function chartOptions(height: number) {
  return {
    layout: { background: { color: CHART_COLORS.bg }, textColor: CHART_COLORS.text },
    grid: { vertLines: { color: CHART_COLORS.grid }, horzLines: { color: CHART_COLORS.grid } },
    rightPriceScale: { borderColor: CHART_COLORS.border },
    timeScale: { borderColor: CHART_COLORS.border, timeVisible: true },
    crosshair: { mode: 0 },
    height,
  }
}

function fmtNum(n: number | null | undefined, digits = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtTime(ts: number) {
  const d = new Date(ts * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtUsdCompact(v: number) {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`
  return `$${v.toFixed(0)}`
}

function fmtCountdown(ms: number) {
  const diff = ms - Date.now()
  if (diff <= 0) return '00:00:00'
  const h = Math.floor(diff / 3600000)
  const m = Math.floor((diff % 3600000) / 60000)
  const s = Math.floor((diff % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// フィボナッチレベル
const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const FIB_COLORS = ['#EF5350', '#FF9800', '#FFEB3B', '#4CAF50', '#2196F3', '#9C27B0', '#EF5350']

// ============================
// 画線レイヤーコンポーネント
// ============================
interface DrawingLayerProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  chartRef: React.RefObject<IChartApi | null>
  candles: Candle[]
  drawings: Drawing[]
  activeTool: ActiveTool
  pendingPoint: { time: number; price: number } | null
  mousePos: { x: number; y: number } | null
  onDrawingComplete: (d: Drawing) => void
  onDeleteDrawing: (id: string) => void
  selectedId: string | null
  onSelectDrawing: (id: string | null) => void
}

function DrawingLayer({
  canvasRef, chartRef, candles, drawings, activeTool,
  pendingPoint, mousePos, onDrawingComplete, onDeleteDrawing,
  selectedId, onSelectDrawing,
}: DrawingLayerProps) {
  const getCoords = useCallback((time: number, price: number) => {
    const chart = chartRef.current
    if (!chart || !canvasRef.current) return null
    const ts = chart.timeScale()
    const x = ts.timeToCoordinate(time as Time)
    const mainSeries = (chart as unknown as { _private__seriesMap?: Map<unknown, { priceToCoordinate: (p: number) => number | null }> })
    // lightweight-charts v5: use the series price scale
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    if (x === null) return null
    // 近似: priceToCoordinate via series
    return { x: x as number, price, time, rect }
  }, [chartRef, canvasRef])

  useEffect(() => {
    const canvas = canvasRef.current
    const chart = chartRef.current
    if (!canvas || !chart || candles.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, rect.width, rect.height)

    const ts = chart.timeScale()

    // 時刻→X座標
    const timeToX = (time: number): number | null => ts.timeToCoordinate(time as Time) as number | null

    // 価格→Y座標（カンドル価格レンジから線形補間）
    const priceRange = chart.priceScale('right')
    const priceToY = (price: number): number => {
      // lightweight-chartsの内部 priceToCoordinate はシリーズ経由のみ
      // キャンバス高さと価格レンジで近似
      const h = rect.height
      if (candles.length === 0) return h / 2
      const prices = candles.flatMap(c => [c.high, c.low])
      const minP = Math.min(...prices)
      const maxP = Math.max(...prices)
      if (maxP === minP) return h / 2
      return h - ((price - minP) / (maxP - minP)) * h
    }

    void priceRange // suppress unused warning

    const drawLine = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, dashed = false) => {
      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = width
      if (dashed) ctx.setLineDash([5, 5])
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.restore()
    }

    for (const d of drawings) {
      const isSelected = d.id === selectedId
      const alpha = isSelected ? 1 : 0.85

      if (d.type === 'trendline') {
        const x1 = timeToX(d.p1.time)
        const x2 = timeToX(d.p2.time)
        if (x1 === null || x2 === null) continue
        const y1 = priceToY(d.p1.price)
        const y2 = priceToY(d.p2.price)
        ctx.globalAlpha = alpha
        drawLine(x1, y1, x2, y2, d.color, d.width)
        if (isSelected) {
          ctx.fillStyle = d.color
          ;[[x1, y1], [x2, y2]].forEach(([px, py]) => {
            ctx.beginPath()
            ctx.arc(px, py, 4, 0, Math.PI * 2)
            ctx.fill()
          })
        }
      } else if (d.type === 'horizontal') {
        const y = priceToY(d.price)
        ctx.globalAlpha = alpha
        drawLine(0, y, rect.width, y, d.color, d.width)
        ctx.font = '11px monospace'
        ctx.fillStyle = d.color
        ctx.fillText(fmtNum(d.price), rect.width - 80, y - 4)
      } else if (d.type === 'rectangle') {
        const x1 = timeToX(d.p1.time)
        const x2 = timeToX(d.p2.time)
        if (x1 === null || x2 === null) continue
        const y1 = priceToY(d.p1.price)
        const y2 = priceToY(d.p2.price)
        ctx.globalAlpha = alpha * d.fillAlpha
        ctx.fillStyle = d.color
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
        ctx.globalAlpha = alpha
        ctx.strokeStyle = d.color
        ctx.lineWidth = d.width
        ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
      } else if (d.type === 'fibonacci') {
        const x1 = timeToX(d.p1.time)
        const x2 = timeToX(d.p2.time)
        if (x1 === null || x2 === null) continue
        const y1 = priceToY(d.p1.price)
        const y2 = priceToY(d.p2.price)
        const priceDiff = d.p2.price - d.p1.price
        FIB_LEVELS.forEach((lvl, idx) => {
          const price = d.p1.price + priceDiff * lvl
          const y = priceToY(price)
          ctx.globalAlpha = 0.7
          drawLine(Math.min(x1, x2), y, Math.max(x1, x2), y, FIB_COLORS[idx], 1)
          ctx.globalAlpha = 1
          ctx.font = '10px monospace'
          ctx.fillStyle = FIB_COLORS[idx]
          ctx.fillText(`${(lvl * 100).toFixed(1)}% ${fmtNum(price)}`, Math.min(x1, x2) + 4, y - 3)
        })
      } else if (d.type === 'text') {
        const x = timeToX(d.pos.time)
        if (x === null) continue
        const y = priceToY(d.pos.price)
        ctx.globalAlpha = alpha
        ctx.font = `${12 * d.width}px sans-serif`
        ctx.fillStyle = d.color
        ctx.fillText(d.content, x, y)
      }
      ctx.globalAlpha = 1
    }

    // プレビュー（マウス追跡中の線）
    if (pendingPoint && mousePos && (activeTool === 'trendline' || activeTool === 'rectangle' || activeTool === 'fibonacci')) {
      const x1 = timeToX(pendingPoint.time)
      if (x1 !== null) {
        const y1 = priceToY(pendingPoint.price)
        ctx.globalAlpha = 0.5
        drawLine(x1, y1, mousePos.x, mousePos.y, '#fff', 1, true)
        ctx.globalAlpha = 1
      }
    }
  })

  return null
}

// ============================
// 単一チャートコンポーネント
// ============================
interface ChartPanelProps {
  candles: Candle[]
  tf: string
  market: Market
  indicatorParams: IndicatorParams
  drawings: Drawing[]
  activeTool: ActiveTool
  onDrawingComplete: (d: Drawing) => void
  onDeleteDrawing: (id: string) => void
  hasMore: boolean
  loadMoreCandles: () => void
  isMain?: boolean
  ticker: { lastPrice: number; change24h: number }
}

function ChartPanel({
  candles, tf, market, indicatorParams, drawings, activeTool,
  onDrawingComplete, onDeleteDrawing, hasMore, loadMoreCandles, isMain = true, ticker,
}: ChartPanelProps) {
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const volumeContainerRef = useRef<HTMLDivElement>(null)
  const rsiContainerRef = useRef<HTMLDivElement>(null)
  const macdContainerRef = useRef<HTMLDivElement>(null)
  const stochContainerRef = useRef<HTMLDivElement>(null)
  const atrContainerRef = useRef<HTMLDivElement>(null)
  const obvContainerRef = useRef<HTMLDivElement>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)

  const mainChartRef = useRef<IChartApi | null>(null)
  const volChartRef = useRef<IChartApi | null>(null)
  const rsiChartRef = useRef<IChartApi | null>(null)
  const macdChartRef = useRef<IChartApi | null>(null)
  const stochChartRef = useRef<IChartApi | null>(null)
  const atrChartRef = useRef<IChartApi | null>(null)
  const obvChartRef = useRef<IChartApi | null>(null)


  const [crosshairData, setCrosshairData] = useState<{
    time: string; open: string; high: string; low: string; close: string; vol: string; change: string; isUp: boolean
  } | null>(null)

  const [pendingPoint, setPendingPoint] = useState<{ time: number; price: number } | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [textInputState, setTextInputState] = useState<{ pos: { time: number; price: number }; x: number; y: number } | null>(null)

  const loadingMoreRef = useRef(false)

  const syncTimeScales = useCallback(() => {
    const charts = [mainChartRef.current, volChartRef.current, rsiChartRef.current, macdChartRef.current,
      stochChartRef.current, atrChartRef.current, obvChartRef.current].filter(Boolean) as IChartApi[]
    if (charts.length < 2) return
    let syncing = false
    charts.forEach((chart, idx) => {
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (syncing || !range) return
        syncing = true
        charts.forEach((other, otherIdx) => { if (idx !== otherIdx) other.timeScale().setVisibleLogicalRange(range) })
        syncing = false
      })
    })
  }, [])

  // 保存当前视图范围，重建图表后恢复（防止视角跳动）
  const savedRangeRef = useRef<{ from: number; to: number } | null>(null)

  // ── 主图：candles 或 indicatorParams 任一变化都重建（合并避免竞态）──
  useEffect(() => {
    if (!mainContainerRef.current || candles.length === 0) return

    // 保存当前视图范围
    if (mainChartRef.current) {
      const range = mainChartRef.current.timeScale().getVisibleLogicalRange()
      if (range) savedRangeRef.current = { from: range.from, to: range.to }
      mainChartRef.current.remove()
      mainChartRef.current = null
    }

    const sorted = [...candles]
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const closes = sorted.map(c => c.close)
    const times  = sorted.map(c => c.time as Time)

    const container = mainContainerRef.current
    const chart = createChart(container, { ...chartOptions(380), width: container.clientWidth })
    mainChartRef.current = chart

    // K线
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.up, downColor: CHART_COLORS.down,
      borderUpColor: CHART_COLORS.up, borderDownColor: CHART_COLORS.down,
      wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down,
    })
    candleSeries.setData(sorted.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })))

    // MA
    if (indicatorParams.ma.enabled) {
      indicatorParams.ma.periods.forEach((period, idx) => {
        if (!period) return
        const color = indicatorParams.ma.colors[idx] ?? '#888'
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        s.setData(calcMA(closes, period).map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
      })
    }

    // EMA
    if (indicatorParams.ema.enabled) {
      indicatorParams.ema.periods.forEach((period, idx) => {
        if (!period) return
        const color = indicatorParams.ema.colors[idx] ?? '#888'
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        s.setData(calcEMA(closes, period).map((v, i) => ({ time: times[i], value: v })))
      })
    }

    // Bollinger Bands
    if (indicatorParams.bollinger.enabled) {
      const bbData = calcBB(closes, indicatorParams.bollinger.period, indicatorParams.bollinger.stdDev)
      const colors = ['rgba(100,181,246,0.8)', 'rgba(100,181,246,0.5)', 'rgba(100,181,246,0.8)']
      const keys: ('upper' | 'middle' | 'lower')[] = ['upper', 'middle', 'lower']
      colors.forEach((color, i) => {
        const s = chart.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        s.setData(bbData.map((v, j) => v ? { time: times[j], value: v[keys[i]] } : null).filter((v): v is LineData => v !== null))
      })
    }

    // Crosshair
    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData) { setCrosshairData(null); return }
      const cd = param.seriesData.get(candleSeries) as CandlestickData | undefined
      if (!cd) { setCrosshairData(null); return }
      const c = sorted.find(k => k.time === (param.time as number))
      const change = cd.open > 0 ? (cd.close - cd.open) / cd.open * 100 : 0
      setCrosshairData({
        time: fmtTime(param.time as number),
        open: fmtNum(cd.open), high: fmtNum(cd.high), low: fmtNum(cd.low), close: fmtNum(cd.close),
        vol: c ? fmtNum(c.volume, 4) : '—',
        change: (change >= 0 ? '+' : '') + fmtNum(change) + '%',
        isUp: cd.close >= cd.open,
      })
    })

    // 视图范围恢复
    if (savedRangeRef.current) {
      chart.timeScale().setVisibleLogicalRange(savedRangeRef.current)
    }

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)
    requestAnimationFrame(syncTimeScales)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (mainChartRef.current) {
        mainChartRef.current.remove()
        mainChartRef.current = null
      }
    }
  }, [candles, indicatorParams, syncTimeScales])

  // 成交量（含 Volume MA）：统一重建
  useEffect(() => {
    if (!volumeContainerRef.current || candles.length === 0) return
    if (volChartRef.current) { volChartRef.current.remove(); volChartRef.current = null }

    const sorted = [...candles].sort((a, b) => a.time - b.time).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const container = volumeContainerRef.current
    const chart = createChart(container, {
      ...chartOptions(80), width: container.clientWidth,
      timeScale: { borderColor: CHART_COLORS.border, visible: false },
    })
    volChartRef.current = chart

    const volSeries = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false })
    volSeries.setData(sorted.map(c => ({
      time: c.time as Time, value: c.volume,
      color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
    })))

    if (indicatorParams.volume_ma.enabled) {
      const maVals = calcMA(sorted.map(c => c.volume), indicatorParams.volume_ma.period)
      const vmaS = chart.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      vmaS.setData(maVals.map((v, i) => v !== null ? { time: sorted[i].time as Time, value: v } : null).filter((v): v is LineData => v !== null))
    }

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)
    requestAnimationFrame(syncTimeScales)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (volChartRef.current) { volChartRef.current.remove(); volChartRef.current = null }
    }
  }, [candles, indicatorParams.volume_ma, syncTimeScales])

  // RSI
  useEffect(() => {
    if (!rsiContainerRef.current || !indicatorParams.rsi.enabled || candles.length === 0) return
    if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null }

    const sorted = [...candles].sort((a, b) => a.time - b.time).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const container = rsiContainerRef.current
    const chart = createChart(container, {
      ...chartOptions(110), width: container.clientWidth,
      timeScale: { borderColor: CHART_COLORS.border, visible: false },
    })
    rsiChartRef.current = chart

    const { period, overbought, oversold } = indicatorParams.rsi
    const rsiValues = calcRSI(sorted.map(c => c.close), period)
    const rsiS = chart.addSeries(LineSeries, { color: '#F7931A', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    rsiS.setData(rsiValues.map((v, i) => v !== null ? { time: sorted[i].time as Time, value: v } : null).filter((v): v is LineData => v !== null))
    ;[overbought, oversold].forEach(level => {
      const s = chart.addSeries(LineSeries, { color: 'rgba(255,255,255,0.2)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      s.setData(sorted.map(c => ({ time: c.time as Time, value: level })))
    })

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)
    requestAnimationFrame(syncTimeScales)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      rsiChartRef.current = null
    }
  }, [candles, indicatorParams.rsi, syncTimeScales])

  // MACD
  useEffect(() => {
    if (!macdContainerRef.current || !indicatorParams.macd.enabled || candles.length === 0) return
    if (macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null }

    const sorted = [...candles].sort((a, b) => a.time - b.time).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const container = macdContainerRef.current
    const chart = createChart(container, {
      ...chartOptions(110), width: container.clientWidth,
      timeScale: { borderColor: CHART_COLORS.border, visible: false },
    })
    macdChartRef.current = chart

    const { fast, slow, signal } = indicatorParams.macd
    const { dif, dea, hist } = calcMACD(sorted.map(c => c.close), fast, slow, signal)
    const times = sorted.map(c => c.time as Time)

    const difS = chart.addSeries(LineSeries, { color: CHART_COLORS.up, lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    difS.setData(dif.map((v, i) => ({ time: times[i], value: v })))
    const deaS = chart.addSeries(LineSeries, { color: CHART_COLORS.down, lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    deaS.setData(dea.map((v, i) => ({ time: times[i], value: v })))
    const histS = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false })
    histS.setData(hist.map((v, i) => ({ time: times[i], value: v, color: v >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' })))

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)
    requestAnimationFrame(syncTimeScales)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      macdChartRef.current = null
    }
  }, [candles, indicatorParams.macd, syncTimeScales])

  // Stochastic
  useEffect(() => {
    if (!stochContainerRef.current || !indicatorParams.stochastic.enabled || candles.length === 0) return
    if (stochChartRef.current) { stochChartRef.current.remove(); stochChartRef.current = null }

    const sorted = [...candles].sort((a, b) => a.time - b.time).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const container = stochContainerRef.current
    const chart = createChart(container, {
      ...chartOptions(110), width: container.clientWidth,
      timeScale: { borderColor: CHART_COLORS.border, visible: false },
    })
    stochChartRef.current = chart

    const { k_period, k_smooth, d_period } = indicatorParams.stochastic
    const { k, d } = calcStochastic(sorted.map(c => c.high), sorted.map(c => c.low), sorted.map(c => c.close), k_period, k_smooth, d_period)
    const times = sorted.map(c => c.time as Time)

    const kS = chart.addSeries(LineSeries, { color: '#2196F3', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    kS.setData(k.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
    const dS = chart.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    dS.setData(d.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
    ;[20, 80].forEach(lvl => {
      const s = chart.addSeries(LineSeries, { color: 'rgba(255,255,255,0.2)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      s.setData(sorted.map(c => ({ time: c.time as Time, value: lvl })))
    })

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)
    requestAnimationFrame(syncTimeScales)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      stochChartRef.current = null
    }
  }, [candles, indicatorParams.stochastic, syncTimeScales])

  // ATR
  useEffect(() => {
    if (!atrContainerRef.current || !indicatorParams.atr.enabled || candles.length === 0) return
    if (atrChartRef.current) { atrChartRef.current.remove(); atrChartRef.current = null }

    const container = atrContainerRef.current
    const chart = createChart(container, {
      ...chartOptions(100), width: container.clientWidth,
      timeScale: { borderColor: CHART_COLORS.border, visible: false },
    })
    atrChartRef.current = chart

    const sorted = [...candles].sort((a, b) => a.time - b.time).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const atrVals = calcATR(sorted.map(c => c.high), sorted.map(c => c.low), sorted.map(c => c.close), indicatorParams.atr.period)
    const atrS = chart.addSeries(LineSeries, { color: '#9C27B0', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    atrS.setData(atrVals.map((v, i) => v !== null ? { time: sorted[i].time as Time, value: v } : null).filter((v): v is LineData => v !== null))

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)
    requestAnimationFrame(syncTimeScales)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      atrChartRef.current = null
    }
  }, [candles, indicatorParams.atr, syncTimeScales])

  // OBV
  useEffect(() => {
    if (!obvContainerRef.current || !indicatorParams.obv.enabled || candles.length === 0) return
    if (obvChartRef.current) { obvChartRef.current.remove(); obvChartRef.current = null }

    const container = obvContainerRef.current
    const chart = createChart(container, {
      ...chartOptions(100), width: container.clientWidth,
      timeScale: { borderColor: CHART_COLORS.border, visible: false },
    })
    obvChartRef.current = chart

    const sorted = [...candles].sort((a, b) => a.time - b.time).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const obvVals = calcOBV(sorted.map(c => c.close), sorted.map(c => c.volume))
    const obvColor = indicatorParams.obv.color || '#00BCD4'
    const obvS = chart.addSeries(LineSeries, { color: obvColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    obvS.setData(obvVals.map((v, i) => ({ time: sorted[i].time as Time, value: v })))
    // OBV MA 平滑线
    if (indicatorParams.obv.ma_period > 0) {
      const maVals = calcMA(obvVals, indicatorParams.obv.ma_period)
      const maS = chart.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      maS.setData(maVals.map((v, i) => v !== null ? { time: sorted[i].time as Time, value: v } : null).filter((v): v is LineData => v !== null))
    }

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)
    requestAnimationFrame(syncTimeScales)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
      obvChartRef.current = null
    }
  }, [candles, indicatorParams.obv, syncTimeScales])

  // 指標終了時クリーンアップ
  useEffect(() => {
    if (!indicatorParams.rsi.enabled && rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null }
    if (!indicatorParams.macd.enabled && macdChartRef.current) { macdChartRef.current.remove(); macdChartRef.current = null }
    if (!indicatorParams.stochastic.enabled && stochChartRef.current) { stochChartRef.current.remove(); stochChartRef.current = null }
    if (!indicatorParams.atr.enabled && atrChartRef.current) { atrChartRef.current.remove(); atrChartRef.current = null }
    if (!indicatorParams.obv.enabled && obvChartRef.current) { obvChartRef.current.remove(); obvChartRef.current = null }
  }, [indicatorParams.rsi.enabled, indicatorParams.macd.enabled, indicatorParams.stochastic.enabled, indicatorParams.atr.enabled, indicatorParams.obv.enabled])

  // 画線キャンバスのリサイズ
  useEffect(() => {
    const canvas = drawingCanvasRef.current
    const container = mainContainerRef.current
    if (!canvas || !container) return

    const syncSize = () => {
      const rect = container.getBoundingClientRect()
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
    }
    syncSize()
    const observer = new ResizeObserver(syncSize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // キャンバスマウスイベント（画線）
  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top })
  }, [])

  const getPriceAtY = useCallback((y: number): number => {
    const canvas = drawingCanvasRef.current
    if (!canvas || candles.length === 0) return 0
    const rect = canvas.getBoundingClientRect()
    const prices = candles.flatMap(c => [c.high, c.low])
    const minP = Math.min(...prices)
    const maxP = Math.max(...prices)
    return maxP - (y / rect.height) * (maxP - minP)
  }, [candles])

  const getTimeAtX = useCallback((x: number): number => {
    const chart = mainChartRef.current
    const canvas = drawingCanvasRef.current
    if (!chart || !canvas) return Date.now() / 1000
    const ts = chart.timeScale()
    const time = ts.coordinateToTime(x)
    if (time !== null) return time as number
    // フォールバック：補間
    if (candles.length === 0) return Date.now() / 1000
    const rect = canvas.getBoundingClientRect()
    const ratio = x / rect.width
    const idx = Math.round(ratio * (candles.length - 1))
    return candles[Math.max(0, Math.min(idx, candles.length - 1))].time
  }, [candles])

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawingCanvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const time = getTimeAtX(x)
    const price = getPriceAtY(y)

    if (activeTool === 'cursor') {
      setSelectedDrawingId(null)
      return
    }

    if (activeTool === 'delete') {
      if (selectedDrawingId) onDeleteDrawing(selectedDrawingId)
      setSelectedDrawingId(null)
      return
    }

    if (activeTool === 'horizontal') {
      const id = `h_${Date.now()}`
      onDrawingComplete({ id, type: 'horizontal', price, color: '#FFD700', width: 1 })
      return
    }

    if (activeTool === 'text') {
      setTextInputState({ pos: { time, price }, x: e.clientX - (canvas.parentElement?.getBoundingClientRect().left ?? 0), y: e.clientY - (canvas.parentElement?.getBoundingClientRect().top ?? 0) })
      return
    }

    if (activeTool === 'trendline' || activeTool === 'rectangle' || activeTool === 'fibonacci') {
      if (!pendingPoint) {
        setPendingPoint({ time, price })
      } else {
        const id = `${activeTool}_${Date.now()}`
        if (activeTool === 'trendline') {
          onDrawingComplete({ id, type: 'trendline', p1: pendingPoint, p2: { time, price }, color: '#FFD700', width: 1 })
        } else if (activeTool === 'rectangle') {
          onDrawingComplete({ id, type: 'rectangle', p1: pendingPoint, p2: { time, price }, color: 'rgba(100,181,246,0.3)', width: 1, fillAlpha: 0.15 })
        } else if (activeTool === 'fibonacci') {
          onDrawingComplete({ id, type: 'fibonacci', p1: pendingPoint, p2: { time, price }, color: '#fff', width: 1 })
        }
        setPendingPoint(null)
      }
    }
  }, [activeTool, pendingPoint, selectedDrawingId, getPriceAtY, getTimeAtX, onDrawingComplete, onDeleteDrawing])

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const isDrawingMode = activeTool !== 'cursor'

  const cursorStyle: React.CSSProperties['cursor'] =
    activeTool === 'cursor' ? 'default' :
    activeTool === 'delete' ? 'not-allowed' :
    activeTool === 'text'   ? 'text' : 'crosshair'

  const isUp = ticker.change24h >= 0

  return (
    <div style={{ position: 'relative' }}>
      {/* OHLC浮窗 */}
      {crosshairData && (
        <div style={{
          position: 'absolute', top: 8, left: 12, zIndex: 20,
          display: 'flex', gap: 16, fontSize: 12, fontFamily: 'var(--font-mono, monospace)',
          color: 'var(--text-mute)', pointerEvents: 'none',
          background: 'rgba(13,17,23,0.85)', borderRadius: 6, padding: '6px 12px',
          backdropFilter: 'blur(8px)',
        }}>
          <span style={{ color: 'var(--text-dim)' }}>{crosshairData.time}</span>
          <span>开 <b style={{ color: 'var(--text)' }}>{crosshairData.open}</b></span>
          <span>高 <b style={{ color: 'var(--text)' }}>{crosshairData.high}</b></span>
          <span>低 <b style={{ color: 'var(--text)' }}>{crosshairData.low}</b></span>
          <span>收 <b style={{ color: 'var(--text)' }}>{crosshairData.close}</b></span>
          <span>量 <b style={{ color: 'var(--text)' }}>{crosshairData.vol}</b></span>
          <span style={{ color: crosshairData.isUp ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>{crosshairData.change}</span>
        </div>
      )}

      {/* 主K線図 */}
      <div style={{ position: 'relative' }} onContextMenu={handleContextMenu}>
        <div ref={mainContainerRef} style={{ height: 380, width: '100%' }} />
        {/* 画線キャンバス — cursor模式时pointer-events:none，让图表正常拖动 */}
        <canvas
          ref={drawingCanvasRef}
          style={{
            position: 'absolute', top: 0, left: 0, zIndex: 10,
            cursor: cursorStyle,
            pointerEvents: isDrawingMode ? 'auto' : 'none',
          }}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={() => setMousePos(null)}
        />
        <DrawingLayer
          canvasRef={drawingCanvasRef}
          chartRef={mainChartRef}
          candles={candles}
          drawings={drawings}
          activeTool={activeTool}
          pendingPoint={pendingPoint}
          mousePos={mousePos}
          onDrawingComplete={onDrawingComplete}
          onDeleteDrawing={onDeleteDrawing}
          selectedId={selectedDrawingId}
          onSelectDrawing={setSelectedDrawingId}
        />
        {/* テキスト入力オーバーレイ */}
        {textInputState && (
          <div style={{ position: 'absolute', left: textInputState.x, top: textInputState.y, zIndex: 30 }}>
            <input
              autoFocus
              style={{ background: '#1a2232', border: '1px solid #F7931A', color: '#fff', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
              placeholder="输入文字..."
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim()
                  if (val) {
                    onDrawingComplete({ id: `text_${Date.now()}`, type: 'text', pos: textInputState.pos, content: val, color: '#FFD700', width: 1 })
                  }
                  setTextInputState(null)
                } else if (e.key === 'Escape') {
                  setTextInputState(null)
                }
              }}
              onBlur={() => setTextInputState(null)}
            />
          </div>
        )}

        {/* 右键菜单 */}
        {contextMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={closeContextMenu} />
            <div style={{
              position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 50,
              background: '#1a2232', border: '1px solid #2a3550', borderRadius: 6,
              minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', overflow: 'hidden',
            }}>
              {[
                { label: '重置视图', action: () => { mainChartRef.current?.timeScale().resetTimeScale(); closeContextMenu() } },
                { label: '最新K线', action: () => { mainChartRef.current?.timeScale().scrollToRealTime(); closeContextMenu() } },
                { label: '清空画线', action: () => { if (confirm('确认清空所有画线？')) { onDeleteDrawing('__all__'); closeContextMenu() } } },
                { label: '取消画线模式', action: () => { setPendingPoint(null); closeContextMenu() }, dimmed: !pendingPoint },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '9px 16px', background: 'none', border: 'none',
                    color: item.dimmed ? 'var(--text-dim)' : 'var(--text)',
                    cursor: 'pointer', fontSize: 13,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 成交量 */}
      <div style={{ borderTop: '1px solid var(--border)' }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>
          成交量{indicatorParams.volume_ma.enabled ? ` · MA(${indicatorParams.volume_ma.period})` : ''}
        </div>
        <div ref={volumeContainerRef} style={{ height: 80, width: '100%' }} />
      </div>

      {/* RSI */}
      {indicatorParams.rsi.enabled && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>RSI ({indicatorParams.rsi.period})</div>
          <div ref={rsiContainerRef} style={{ height: 110, width: '100%' }} />
        </div>
      )}

      {/* MACD */}
      {indicatorParams.macd.enabled && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>MACD ({indicatorParams.macd.fast},{indicatorParams.macd.slow},{indicatorParams.macd.signal})</div>
          <div ref={macdContainerRef} style={{ height: 110, width: '100%' }} />
        </div>
      )}

      {/* Stochastic */}
      {indicatorParams.stochastic.enabled && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>Stochastic ({indicatorParams.stochastic.k_period},{indicatorParams.stochastic.k_smooth},{indicatorParams.stochastic.d_period})</div>
          <div ref={stochContainerRef} style={{ height: 110, width: '100%' }} />
        </div>
      )}

      {/* ATR */}
      {indicatorParams.atr.enabled && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>ATR ({indicatorParams.atr.period})</div>
          <div ref={atrContainerRef} style={{ height: 100, width: '100%' }} />
        </div>
      )}

      {/* OBV */}
      {indicatorParams.obv.enabled && (
        <div style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>OBV</div>
          <div ref={obvContainerRef} style={{ height: 100, width: '100%' }} />
        </div>
      )}

      {/* isMain でのみ注記表示 */}
      {isMain && (
        <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>
          数据来源：OKX 公共 API · {market === 'swap' ? 'BTC/USDT 永续' : 'BTC/USDT 现货'} · {TF_LABELS[tf] ?? tf} · 每 10 秒更新
        </div>
      )}

      {/* 価格表示（分割モード用サブ） */}
      {!isMain && (
        <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-dim)' }}>
          {TF_LABELS[tf] ?? tf} &nbsp;
          <span style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>{formatUsd(ticker.lastPrice)}</span>
        </div>
      )}
    </div>
  )
}

// ============================
// 右侧常驻指标面板
// ============================
interface IndicatorSidebarProps {
  params: IndicatorParams
  onChange: (params: IndicatorParams) => void
}

function IndicatorSidebar({ params, onChange }: IndicatorSidebarProps) {
  const [expanded, setExpanded] = useState<string | null>(null)

  // 即时更新：直接写入父级 params，不需要「应用」按钮
  const update = <K extends keyof IndicatorParams>(key: K, val: Partial<IndicatorParams[K]>) => {
    onChange({ ...params, [key]: { ...params[key], ...val } })
  }

  const toggle = (key: keyof IndicatorParams) => {
    update(key, { enabled: !(params[key] as { enabled: boolean }).enabled } as Partial<IndicatorParams[typeof key]>)
  }

  const numInput = (label: string, value: number, onVal: (v: number) => void, min = 1, max = 500) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <input
        type="number" value={value} min={min} max={max}
        style={{ background: '#0d1117', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '1px 4px', width: 56, fontSize: 11 }}
        onChange={e => onVal(parseInt(e.target.value) || min)}
      />
    </div>
  )

  const floatInput = (label: string, value: number, onVal: (v: number) => void, min = 0.5, max = 4, step = 0.5) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <input
        type="number" value={value} min={min} max={max} step={step}
        style={{ background: '#0d1117', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 3, padding: '1px 4px', width: 56, fontSize: 11 }}
        onChange={e => onVal(parseFloat(e.target.value) || min)}
      />
    </div>
  )

  const colorDot = (color: string, onVal: (v: string) => void) => (
    <label style={{ position: 'relative', cursor: 'pointer' }}>
      <div style={{ width: 14, height: 14, borderRadius: '50%', background: color, border: '1px solid rgba(255,255,255,0.2)' }} />
      <input type="color" value={color} onChange={e => onVal(e.target.value)}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
    </label>
  )

  const INDICATORS: { key: keyof IndicatorParams; label: string; shortLabel: string }[] = [
    { key: 'ma',         label: 'MA',         shortLabel: 'MA' },
    { key: 'ema',        label: 'EMA',         shortLabel: 'EMA' },
    { key: 'bollinger',  label: 'BB',          shortLabel: 'BB' },
    { key: 'rsi',        label: 'RSI',         shortLabel: 'RSI' },
    { key: 'macd',       label: 'MACD',        shortLabel: 'MACD' },
    { key: 'stochastic', label: 'STOCH',       shortLabel: 'KD' },
    { key: 'atr',        label: 'ATR',         shortLabel: 'ATR' },
    { key: 'obv',        label: 'OBV',         shortLabel: 'OBV' },
    { key: 'volume_ma',  label: 'VOL MA',      shortLabel: 'VMA' },
  ]

  return (
    <div style={{
      width: 180, flexShrink: 0,
      background: 'var(--card)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      fontSize: 12,
    }}>
      {/* 标题栏 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.05em' }}>
        指标
      </div>

      {/* 指标列表 */}
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {INDICATORS.map(({ key, label }) => {
          const enabled = (params[key] as { enabled: boolean }).enabled
          const isOpen = expanded === key && enabled
          return (
            <div key={key} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              {/* 指标行：checkbox + 名称 + 展开箭头 */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                cursor: 'pointer',
                background: enabled ? 'rgba(247,147,26,0.05)' : 'transparent',
              }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => toggle(key)}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: '#F7931A', width: 13, height: 13, cursor: 'pointer', flexShrink: 0 }}
                />
                <span
                  onClick={() => toggle(key)}
                  style={{ flex: 1, color: enabled ? 'var(--text)' : 'var(--text-mute)', fontWeight: enabled ? 600 : 400, userSelect: 'none' }}
                >
                  {label}
                </span>
                {/* 参数展开按钮（仅已启用时显示） */}
                {enabled && (
                  <button
                    onClick={e => { e.stopPropagation(); setExpanded(isOpen ? null : key) }}
                    style={{
                      background: 'none', border: 'none', color: 'var(--text-dim)',
                      cursor: 'pointer', fontSize: 10, padding: 0, lineHeight: 1,
                    }}
                  >
                    {isOpen ? '▲' : '▼'}
                  </button>
                )}
              </div>

              {/* 参数子面板（展开时显示） */}
              {isOpen && (
                <div style={{ padding: '6px 12px 8px 32px', background: 'rgba(0,0,0,0.2)' }}>
                  {key === 'ma' && <>
                    {numInput('周期1', params.ma.periods[0], v => update('ma', { periods: [v, params.ma.periods[1]] }))}
                    {numInput('周期2', params.ma.periods[1], v => update('ma', { periods: [params.ma.periods[0], v] }))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      {colorDot(params.ma.colors[0], v => update('ma', { colors: [v, params.ma.colors[1]] }))}
                      {colorDot(params.ma.colors[1], v => update('ma', { colors: [params.ma.colors[0], v] }))}
                    </div>
                  </>}
                  {key === 'ema' && <>
                    {numInput('周期1', params.ema.periods[0], v => update('ema', { periods: [v, params.ema.periods[1]] }))}
                    {numInput('周期2', params.ema.periods[1], v => update('ema', { periods: [params.ema.periods[0], v] }))}
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      {colorDot(params.ema.colors[0], v => update('ema', { colors: [v, params.ema.colors[1]] }))}
                      {colorDot(params.ema.colors[1], v => update('ema', { colors: [params.ema.colors[0], v] }))}
                    </div>
                  </>}
                  {key === 'bollinger' && <>
                    {numInput('周期', params.bollinger.period, v => update('bollinger', { period: v }))}
                    {floatInput('标准差', params.bollinger.stdDev, v => update('bollinger', { stdDev: v }))}
                  </>}
                  {key === 'rsi' && <>
                    {numInput('周期', params.rsi.period, v => update('rsi', { period: v }))}
                    {numInput('超买', params.rsi.overbought, v => update('rsi', { overbought: v }), 50, 100)}
                    {numInput('超卖', params.rsi.oversold, v => update('rsi', { oversold: v }), 1, 50)}
                  </>}
                  {key === 'macd' && <>
                    {numInput('快线', params.macd.fast, v => update('macd', { fast: v }))}
                    {numInput('慢线', params.macd.slow, v => update('macd', { slow: v }))}
                    {numInput('信号', params.macd.signal, v => update('macd', { signal: v }))}
                  </>}
                  {key === 'stochastic' && <>
                    {numInput('%K周期', params.stochastic.k_period, v => update('stochastic', { k_period: v }))}
                    {numInput('%K平滑', params.stochastic.k_smooth, v => update('stochastic', { k_smooth: v }))}
                    {numInput('%D周期', params.stochastic.d_period, v => update('stochastic', { d_period: v }))}
                  </>}
                  {key === 'atr' && numInput('周期', params.atr.period, v => update('atr', { period: v }))}
                  {key === 'obv' && <>
                    {numInput('MA周期', params.obv.ma_period, v => update('obv', { ma_period: v }), 0, 200)}
                    <div style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 4 }}>0 = 不显示MA</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11 }}>
                      <span style={{ color: 'var(--text-dim)' }}>颜色</span>
                      {colorDot(params.obv.color, v => update('obv', { color: v }))}
                    </div>
                  </>}
                  {key === 'volume_ma' && numInput('周期', params.volume_ma.period, v => update('volume_ma', { period: v }))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* 底部：恢复默认 */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
        <button
          onClick={() => onChange(JSON.parse(JSON.stringify(DEFAULT_INDICATOR_PARAMS)))}
          style={{
            width: '100%', background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-dim)', borderRadius: 4, padding: '4px 0', cursor: 'pointer', fontSize: 11,
          }}
        >
          恢复默认
        </button>
      </div>
    </div>
  )
}

// ============================
// 永続情報パネル
// ============================
function PerpInfoPanel({ info, lastPrice }: { info: PerpInfo; lastPrice: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const fr = info.fundingRate.current
  const frColor = fr >= 0 ? 'var(--up)' : 'var(--down)'
  const lsColor = info.longShortRatio >= 1 ? 'var(--up)' : 'var(--down)'
  const oiUsd = lastPrice > 0 ? info.openInterest.contracts * lastPrice : 0

  return (
    <div style={{
      display: 'flex', gap: 16, padding: '8px 12px',
      background: 'rgba(38,166,154,0.06)', border: '1px solid rgba(38,166,154,0.15)',
      borderRadius: 8, fontSize: 12, flexWrap: 'wrap',
    }}>
      <div>
        <span style={{ color: 'var(--text-dim)' }}>资金费率 </span>
        <span style={{ color: frColor, fontWeight: 600 }}>{(fr * 100).toFixed(4)}%</span>
        {info.fundingRate.nextSettleAt > 0 && (
          <span style={{ color: 'var(--text-dim)', marginLeft: 6 }}>
            (下次 {fmtCountdown(info.fundingRate.nextSettleAt)})
          </span>
        )}
      </div>
      <div>
        <span style={{ color: 'var(--text-dim)' }}>未平仓量 </span>
        <span style={{ color: 'var(--text)' }}>{fmtNum(info.openInterest.contracts, 0)} BTC</span>
        {oiUsd > 0 && <span style={{ color: 'var(--text-dim)' }}> ({fmtUsdCompact(oiUsd)})</span>}
      </div>
      <div>
        <span style={{ color: 'var(--text-dim)' }}>多空比 </span>
        <span style={{ color: lsColor, fontWeight: 600 }}>{fmtNum(info.longShortRatio, 2)}</span>
        <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>
          ({info.longShortRatio >= 1 ? '多头优势' : '空头优势'})
        </span>
      </div>
      <span style={{ color: 'var(--text-dim)', marginLeft: 'auto', alignSelf: 'center' }}>
        {new Date(now).toLocaleTimeString('zh-CN')}
      </span>
    </div>
  )
}

// ============================
// メインページ
// ============================
export default function ChartPage() {
  const [market, setMarket] = useState<Market>('swap')
  const [tf, setTf] = useState('4h')
  const [splitTf, setSplitTf] = useState('15m')
  const [isSplit, setIsSplit] = useState(false)

  const [candles, setCandles] = useState<Candle[]>([])
  const [splitCandles, setSplitCandles] = useState<Candle[]>([])
  const [ticker, setTicker] = useState({ lastPrice: 0, change24h: 0 })
  const [hasMore, setHasMore] = useState(false)
  const [splitHasMore, setSplitHasMore] = useState(false)
  const [loading, setLoading] = useState(true)

  const [indicatorParams, setIndicatorParams] = useState<IndicatorParams>(DEFAULT_INDICATOR_PARAMS)
  const [activeTool, setActiveTool] = useState<ActiveTool>('cursor')

  const [drawings, setDrawings] = useState<Drawing[]>([])
  const [splitDrawings, setSplitDrawings] = useState<Drawing[]>([])

  const [perpInfo, setPerpInfo] = useState<PerpInfo | null>(null)

  const mainChartContainerRef = useRef<HTMLDivElement>(null)

  // 单次请求（翻页用）
  const fetchPage = useCallback(async (interval: string, mkt: Market, before?: number) => {
    const params = new URLSearchParams({ interval, limit: '300', market: mkt })
    if (before) params.set('before', String(before))
    const res = await fetch(`/api/chart/klines?${params}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json() as Promise<{ candles: { time: number; open: number; high: number; low: number; close: number; volume: number }[]; hasMore: boolean }>
  }, [])

  // 全量加载：先渲染第一页，后台静默拉取全部历史，完成后一次性更新
  const loadAllCandles = useCallback(async (interval: string, mkt: Market, isSplitPanel = false) => {
    try {
      // 第一页：立即显示
      const first = await fetchPage(interval, mkt, undefined)
      if (first.candles.length === 0) return
      if (isSplitPanel) setSplitCandles(first.candles)
      else setCandles(first.candles)

      // 后台继续翻页到最早
      const MAX = 20000
      const allMap = new Map<number, Candle>()
      first.candles.forEach(c => allMap.set(c.time, c))

      // 用当前最小 time 作为 before，每次向更早翻
      let before = Math.min(...first.candles.map(c => c.time))
      let emptyCount = 0 // 连续空页计数，防止无限循环

      while (allMap.size < MAX) {
        const { candles: page } = await fetchPage(interval, mkt, before)
        if (page.length === 0) {
          emptyCount++
          if (emptyCount >= 3) break // 连续3次空页，认为到头了
          continue
        }
        emptyCount = 0
        page.forEach(c => allMap.set(c.time, c))
        const newMin = Math.min(...page.map(c => c.time))
        if (newMin >= before) break // 没有更早的数据了
        before = newMin
      }

      // 排序去重后一次性写入
      const sorted = Array.from(allMap.values()).sort((a, b) => a.time - b.time)
      if (isSplitPanel) { setSplitCandles(sorted); setSplitHasMore(false) }
      else { setCandles(sorted); setHasMore(false) }
    } catch {/* silent */}
  }, [fetchPage])

  // 手动翻页（向左滚超出时追加）—— 已全量加载后不会触发
  const loadCandles = useCallback(async (interval: string, mkt: Market, before?: number, isSplitPanel = false) => {
    if (before === undefined) {
      await loadAllCandles(interval, mkt, isSplitPanel)
      return
    }
    try {
      const { candles: newCandles, hasMore: more } = await fetchPage(interval, mkt, before)
      if (isSplitPanel) {
        setSplitCandles(prev => [...newCandles, ...prev])
        setSplitHasMore(more)
      } else {
        setCandles(prev => [...newCandles, ...prev])
        setHasMore(more)
      }
    } catch {/* silent */}
  }, [fetchPage, loadAllCandles])

  const loadTicker = useCallback(async (mkt: Market) => {
    try {
      const res = await fetch(`/api/chart/ticker?market=${mkt}`)
      if (!res.ok) return
      const d = await res.json()
      const change24h = d.open24h > 0 ? (d.lastPrice - d.open24h) / d.open24h * 100 : 0
      setTicker({ lastPrice: d.lastPrice, change24h })
    } catch {/* silent */}
  }, [])

  const loadPerpInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/chart/perpetual-info')
      if (!res.ok) return
      setPerpInfo(await res.json())
    } catch {/* silent */}
  }, [])

  // 初期ロード
  useEffect(() => {
    setLoading(true)
    Promise.all([
      loadCandles(tf, market),
      loadTicker(market),
      market === 'swap' ? loadPerpInfo() : Promise.resolve(),
    ]).finally(() => setLoading(false))
  }, [tf, market, loadCandles, loadTicker, loadPerpInfo])

  // 分割パネルのロード
  useEffect(() => {
    if (!isSplit) return
    loadCandles(splitTf, market, undefined, true)
  }, [isSplit, splitTf, market, loadCandles])

  // 10秒ごとに最新K線更新
  useEffect(() => {
    const id = setInterval(async () => {
      await loadTicker(market)
      if (market === 'swap') await loadPerpInfo()

      const res = await fetch(`/api/chart/klines?interval=${tf}&limit=2&market=${market}`)
      if (!res.ok) return
      const { candles: latest } = await res.json()
      if (latest?.length > 0) {
        setCandles(prev => {
          if (prev.length === 0) return prev
          const updated = [...prev]
          const last = latest[latest.length - 1]
          if (updated[updated.length - 1].time === last.time) updated[updated.length - 1] = last
          else updated.push(last)
          return updated
        })
      }
    }, 10_000)
    return () => clearInterval(id)
  }, [tf, market, loadTicker, loadPerpInfo])

  // ローカルストレージから画線読み込み
  useEffect(() => {
    const key = `drawings_${market}_${tf}`
    const saved = localStorage.getItem(key)
    if (saved) { try { setDrawings(JSON.parse(saved)) } catch {/* ignore */} }
    else setDrawings([])
  }, [market, tf])

  useEffect(() => {
    if (isSplit) {
      const key = `drawings_${market}_${splitTf}`
      const saved = localStorage.getItem(key)
      if (saved) { try { setSplitDrawings(JSON.parse(saved)) } catch {/* ignore */} }
      else setSplitDrawings([])
    }
  }, [isSplit, market, splitTf])

  // 画線を保存
  const saveDrawings = useCallback((newDrawings: Drawing[], isSplt = false) => {
    const key = `drawings_${market}_${isSplt ? splitTf : tf}`
    localStorage.setItem(key, JSON.stringify(newDrawings))
    if (isSplt) setSplitDrawings(newDrawings)
    else setDrawings(newDrawings)
  }, [market, tf, splitTf])

  const handleDrawingComplete = useCallback((d: Drawing, isSplt = false) => {
    const current = isSplt ? splitDrawings : drawings
    saveDrawings([...current, d], isSplt)
  }, [drawings, splitDrawings, saveDrawings])

  const handleDeleteDrawing = useCallback((id: string, isSplt = false) => {
    if (id === '__all__') { saveDrawings([], isSplt); return }
    const current = isSplt ? splitDrawings : drawings
    saveDrawings(current.filter(d => d.id !== id), isSplt)
  }, [drawings, splitDrawings, saveDrawings])

  const handleClearAll = useCallback(() => {
    if (!confirm('确认清空所有画线？')) return
    saveDrawings([])
  }, [saveDrawings])

  // スクリーンショット
  const handleScreenshot = useCallback(async () => {
    const container = mainChartContainerRef.current
    if (!container) return
    try {
      // lightweight-charts の takeScreenshot を使う
      const chartDiv = container.querySelector('canvas') as HTMLCanvasElement | null
      if (!chartDiv) return

      const offscreen = document.createElement('canvas')
      offscreen.width = chartDiv.width
      offscreen.height = chartDiv.height
      const ctx = offscreen.getContext('2d')!
      ctx.drawImage(chartDiv, 0, 0)

      // 透明背景を暗背景に
      ctx.globalCompositeOperation = 'destination-over'
      ctx.fillStyle = '#0d1117'
      ctx.fillRect(0, 0, offscreen.width, offscreen.height)
      ctx.globalCompositeOperation = 'source-over'

      // 水印
      const dpr = window.devicePixelRatio || 1
      ctx.font = `${11 * dpr}px sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.2)'
      ctx.fillText(`BTC Station — ${new Date().toLocaleDateString('zh-CN')}`, 8 * dpr, offscreen.height - 8 * dpr)

      const link = document.createElement('a')
      link.download = `BTC-USDT-${market === 'swap' ? 'SWAP' : 'SPOT'}_${tf}_${new Date().toISOString().slice(0, 10)}.png`
      link.href = offscreen.toDataURL('image/png')
      link.click()
    } catch (e) {
      console.error('截图失败', e)
    }
  }, [market, tf])

  const isUp = ticker.change24h >= 0

  // 描画ツールボタン設定
  const drawingTools: { tool: ActiveTool; label: string; title: string }[] = [
    { tool: 'cursor',     label: '↖', title: '选择' },
    { tool: 'trendline',  label: '╱', title: '趋势线' },
    { tool: 'horizontal', label: '—', title: '水平线' },
    { tool: 'rectangle',  label: '□', title: '矩形' },
    { tool: 'fibonacci',  label: 'φ', title: '斐波那契回调' },
    { tool: 'text',       label: 'T', title: '文字标注' },
    { tool: 'delete',     label: '✕', title: '删除选中' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {/* ====== 顶部工具栏 ====== */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 0', marginBottom: 8, flexWrap: 'wrap', gap: 10,
      }}>
        {/* 左：现货/永续切换 + 价格 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* 现货/永续切换器 */}
          <div style={{
            display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden',
          }}>
            {(['swap', 'spot'] as Market[]).map(m => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                style={{
                  padding: '4px 12px', fontSize: 12, border: 'none', cursor: 'pointer',
                  background: market === m ? 'var(--accent)' : 'transparent',
                  color: market === m ? '#000' : 'var(--text-mute)',
                  fontWeight: market === m ? 700 : 400,
                  transition: 'background 0.15s',
                }}
              >
                {m === 'swap' ? '永续' : '现货'}
              </button>
            ))}
          </div>

          {/* BTC icon + price */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 20, height: 20, borderRadius: '50%', background: '#F7931A',
              color: '#0D1117', fontWeight: 700, fontSize: 11,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>₿</div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>
              BTC/USDT{market === 'swap' ? '.P' : ''}
            </span>
            <span className="chip chip-neutral" style={{ fontSize: 10 }}>OKX</span>
          </div>

          {ticker.lastPrice > 0 && (
            <>
              <span className="num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>
                {formatUsd(ticker.lastPrice)}
              </span>
              <span className={`chip ${isUp ? 'chip-up' : 'chip-down'}`}>
                {formatPercent(ticker.change24h)}
              </span>
            </>
          )}
        </div>

        {/* 中：时间周期 */}
        <div className="tf-group">
          {TIMEFRAMES.map(t => (
            <button key={t} className={`tf-btn${tf === t ? ' active' : ''}`} onClick={() => setTf(t)}>
              {TF_LABELS[t]}
            </button>
          ))}
        </div>

        {/* 右：ツールボタン */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 分屏切换 */}
          <button
            className="btn btn-ghost"
            style={{ height: 28, fontSize: 12, opacity: isSplit ? 1 : 0.6 }}
            onClick={() => setIsSplit(p => !p)}
            title="分屏视图"
          >
            ⧉
          </button>

          {/* 截图 */}
          <button
            className="btn btn-ghost"
            style={{ height: 28, fontSize: 12 }}
            onClick={handleScreenshot}
            title="保存截图"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            截图
          </button>

          {/* 占位，指标面板已常驻右侧 */}
        </div>
      </div>

      {/* 永续信息面板 */}
      {market === 'swap' && perpInfo && (
        <div style={{ marginBottom: 10 }}>
          <PerpInfoPanel info={perpInfo} lastPrice={ticker.lastPrice} />
        </div>
      )}

      {/* ====== 图表区域 + 右侧指标栏 ====== */}
      <div style={{ display: 'flex', gap: 0, alignItems: 'stretch' }}>
        {/* 画线工具栏 */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 4px',
          background: 'var(--card)', borderRight: '1px solid var(--border)',
          alignItems: 'center', minWidth: 36,
        }}>
          {drawingTools.map(({ tool, label, title }) => (
            <button
              key={tool}
              title={title}
              onClick={() => setActiveTool(activeTool === tool ? 'cursor' : tool)}
              style={{
                width: 28, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
                background: activeTool === tool ? 'var(--accent)' : 'transparent',
                color: activeTool === tool ? '#000' : 'var(--text-mute)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <button
            title="清空所有画线"
            onClick={handleClearAll}
            style={{
              width: 28, height: 28, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
              background: 'transparent', color: 'var(--text-dim)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            ⌫
          </button>
        </div>

        {/* メインチャートエリア */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {isSplit ? (
            /* 分屏布局 */
            <div style={{ display: 'flex', gap: 0 }}>
              <div ref={mainChartContainerRef} className="card" style={{ flex: 1, minWidth: 0, overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
                {loading ? (
                  <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)', fontSize: 13 }}>图表加载中...</div>
                ) : (
                  <ChartPanel
                    candles={candles} tf={tf} market={market}
                    indicatorParams={indicatorParams}
                    drawings={drawings}
                    activeTool={activeTool}
                    onDrawingComplete={d => handleDrawingComplete(d, false)}
                    onDeleteDrawing={id => handleDeleteDrawing(id, false)}
                    hasMore={hasMore}
                    loadMoreCandles={() => loadCandles(tf, market, candles[0]?.time)}
                    isMain={true}
                    ticker={ticker}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }} className="card">
                {/* 分屏时间周期选择 */}
                <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 4 }}>
                  {['15m', '1h', '4h'].map(t => (
                    <button
                      key={t}
                      className={`tf-btn${splitTf === t ? ' active' : ''}`}
                      onClick={() => setSplitTf(t)}
                      style={{ fontSize: 11, padding: '2px 8px' }}
                    >
                      {TF_LABELS[t]}
                    </button>
                  ))}
                </div>
                {splitCandles.length === 0 ? (
                  <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)', fontSize: 13 }}>加载中...</div>
                ) : (
                  <ChartPanel
                    candles={splitCandles} tf={splitTf} market={market}
                    indicatorParams={{ ...indicatorParams, rsi: { ...indicatorParams.rsi, enabled: false }, macd: { ...indicatorParams.macd, enabled: false }, stochastic: { ...indicatorParams.stochastic, enabled: false }, atr: { ...indicatorParams.atr, enabled: false }, obv: { ...indicatorParams.obv, enabled: false } }}
                    drawings={splitDrawings}
                    activeTool={activeTool}
                    onDrawingComplete={d => handleDrawingComplete(d, true)}
                    onDeleteDrawing={id => handleDeleteDrawing(id, true)}
                    hasMore={splitHasMore}
                    loadMoreCandles={() => loadCandles(splitTf, market, splitCandles[0]?.time, true)}
                    isMain={false}
                    ticker={ticker}
                  />
                )}
              </div>
            </div>
          ) : (
            /* 单屏布局 */
            <div ref={mainChartContainerRef} className="card" style={{ overflow: 'hidden', position: 'relative' }}>
              {loading ? (
                <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)', fontSize: 13 }}>图表加载中...</div>
              ) : (
                <ChartPanel
                  candles={candles} tf={tf} market={market}
                  indicatorParams={indicatorParams}
                  drawings={drawings}
                  activeTool={activeTool}
                  onDrawingComplete={d => handleDrawingComplete(d, false)}
                  onDeleteDrawing={id => handleDeleteDrawing(id, false)}
                  hasMore={hasMore}
                  loadMoreCandles={() => loadCandles(tf, market, candles[0]?.time)}
                  isMain={true}
                  ticker={ticker}
                />
              )}
            </div>
          )}
        </div>

        {/* 右侧常驻指标面板 */}
        <IndicatorSidebar
          params={indicatorParams}
          onChange={setIndicatorParams}
        />
      </div>
    </div>
  )
}
