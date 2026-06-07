import { useEffect, useRef, useState } from 'react'
import { createChart, createSeriesMarkers, CandlestickSeries, LineSeries, type IChartApi, type Time, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarkerBarPosition, type SeriesMarkerShape } from 'lightweight-charts'

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume?: number }
export interface ChartMarker { time: number; position: string; color: string; shape: string; text?: string }
export interface StrategyLine { label: string; color: string; points: { time: number; value: number }[] }

const isValidNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

export default function MiniChart({ candles, markers, strategyLines, height }: { candles: Candle[], markers?: ChartMarker[], strategyLines?: StrategyLine[], height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartInstanceRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null)
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const linesRef = useRef<ISeriesApi<"Line">[]>([])
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleResetChart = () => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.applyOptions({ timeScale: { barSpacing: 8, rightOffset: 5 } })
      chartInstanceRef.current.timeScale().scrollToRealTime()
      chartInstanceRef.current.priceScale('right').applyOptions({ autoScale: true })
    }
    setContextMenu(null)
  }

  // 1. 初始化图表（只执行一次）
  useEffect(() => {
    if (!containerRef.current) return
    const container = containerRef.current
    const initWidth = container.clientWidth || container.getBoundingClientRect().width || 800
    const initHeight = height ?? (container.clientHeight || container.getBoundingClientRect().height || 400)

    const chart = createChart(container, {
      layout: { background: { color: '#131722' }, textColor: '#787b86', fontFamily: "'JetBrains Mono', monospace", fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: 'rgba(255,255,255,0.03)' }, horzLines: { color: 'rgba(255,255,255,0.03)' } },
      rightPriceScale: { borderColor: '#363a45' },
      timeScale: { borderColor: '#363a45', timeVisible: true, rightOffset: 5, barSpacing: 8, minBarSpacing: 0.2 },
      crosshair: { vertLine: { color: 'rgba(0,212,255,0.3)', labelBackgroundColor: '#363a45' }, horzLine: { color: 'rgba(0,212,255,0.3)', labelBackgroundColor: '#363a45' } },
      width: Math.max(initWidth, 1),
      height: Math.max(initHeight, 1),
    })
    chartInstanceRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26A69A', downColor: '#EF5350',
      borderUpColor: '#26A69A', borderDownColor: '#EF5350',
      wickUpColor: '#26A69A', wickDownColor: '#EF5350',
    })
    candleSeriesRef.current = candleSeries
    markerPluginRef.current = createSeriesMarkers(candleSeries, [])

    const ro = new ResizeObserver(entries => {
      const entry = entries[0]
      if (!entry) return
      const { width, height: h } = entry.contentRect
      const opts: { width?: number; height?: number } = {}
      if (width > 0) opts.width = width
      if (h > 0) opts.height = h
      if (Object.keys(opts).length) chart.applyOptions(opts)
    })
    ro.observe(container)

    return () => {
      ro.disconnect()
      chart.remove()
      chartInstanceRef.current = null
      candleSeriesRef.current = null
      markerPluginRef.current = null
    }
  }, [])

  // 2. 高度变化
  useEffect(() => {
    if (chartInstanceRef.current && height && height > 0) {
      const w = containerRef.current?.getBoundingClientRect().width || containerRef.current?.clientWidth || 800
      chartInstanceRef.current.applyOptions({ height, width: Math.max(w, 1) })
    }
  }, [height])

  // 3a. 【独立】K线数据更新
  useEffect(() => {
    if (!chartInstanceRef.current || !candleSeriesRef.current || !candles || candles.length === 0) return

    const sorted = candles
      .filter(c => isValidNum(c.time) && isValidNum(c.open) && isValidNum(c.high) && isValidNum(c.low) && isValidNum(c.close))
      .map(c => ({ time: (c.time > 1e12 ? Math.floor(c.time / 1000) : c.time) as Time, open: c.open, high: c.high, low: c.low, close: c.close }))
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)

    if (sorted.length === 0) return

    let isFirstLoad = false
    try { isFirstLoad = candleSeriesRef.current.data().length === 0 } catch {}

    try { candleSeriesRef.current.setData(sorted) } catch (e) { console.error('[MiniChart] K线加载错误:', e) }

    if (isFirstLoad) {
      chartInstanceRef.current.applyOptions({ timeScale: { barSpacing: 8, rightOffset: 5 } })
      chartInstanceRef.current.timeScale().scrollToRealTime()
      chartInstanceRef.current.priceScale('right').applyOptions({ autoScale: true })
    }
  }, [candles])

  // 3b. 【独立】策略指标线更新
  useEffect(() => {
    if (!chartInstanceRef.current) return
    linesRef.current.forEach(s => chartInstanceRef.current?.removeSeries(s))
    linesRef.current = []

    if (!strategyLines || strategyLines.length === 0) return

    strategyLines.forEach(line => {
      const s = chartInstanceRef.current!.addSeries(LineSeries, { color: line.color, lineWidth: 2, priceLineVisible: false })
      const validPoints = line.points
        .filter(p => isValidNum(p.time) && isValidNum(p.value))
        .map(p => ({ time: (p.time > 1e12 ? Math.floor(p.time / 1000) : p.time) as Time, value: p.value }))
        .sort((a, b) => (a.time as number) - (b.time as number))
        .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time)

      if (validPoints.length > 0) {
        try { s.setData(validPoints) } catch (e) { console.error('[MiniChart] 指标加载错误:', line.label, e) }
      }
      linesRef.current.push(s)
    })
  }, [strategyLines])

  // 3c. 【独立】交易标记更新
  useEffect(() => {
    if (!markerPluginRef.current) return

    if (!markers || markers.length === 0) {
      markerPluginRef.current.setMarkers([])
      return
    }

    const validTimes = new Set(
      (candles ?? []).map(c => c.time > 1e12 ? Math.floor(c.time / 1000) : c.time)
    )

    // 按 (时间, 位置, 形状) 去重——同一根 K 线上多笔加仓只保留一个箭头，禁止拼接文字
    const uniqueMap = new Map<string, { time: Time; position: SeriesMarkerBarPosition; color: string; shape: SeriesMarkerShape; text: string; size: number; count: number }>()
    markers.forEach(m => {
      const t = m.time > 1e12 ? Math.floor(m.time / 1000) : m.time
      if (!validTimes.has(t)) return
      const key = `${t}|${m.position}|${m.shape}`
      const existing = uniqueMap.get(key)
      if (existing) {
        existing.count += 1
        existing.text = '' // 多笔同向信号不堆文字，避免「做多/平仓/做多…」铺满图表
      } else {
        uniqueMap.set(key, {
          time: t as Time,
          position: m.position as SeriesMarkerBarPosition,
          color: m.color,
          shape: m.shape as SeriesMarkerShape,
          text: m.text ?? '',
          size: 1.2,
          count: 1,
        })
      }
    })

    const lwtMarkers = Array.from(uniqueMap.values())
      .map(({ count, ...m }) => ({
        ...m,
        text: count > 1 ? '' : m.text,
        size: count > 1 ? 1.4 : m.size,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))
    try { markerPluginRef.current.setMarkers(lwtMarkers) } catch (e) { console.error('[MiniChart] Marker加载错误:', e) }
  }, [markers, candles])

  // 全局点击关闭右键菜单
  useEffect(() => {
    const handleClickOutside = () => setContextMenu(null)
    window.addEventListener('click', handleClickOutside)
    return () => window.removeEventListener('click', handleClickOutside)
  }, [])

  return (
    <div
      style={{ width: '100%', height: height ?? '100%', display: 'block', position: 'relative', overflow: 'hidden' }}
      onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }) }}
    >
      <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />
      {contextMenu && (
        <div style={{
          position: 'fixed', top: contextMenu.y, left: contextMenu.x,
          background: '#1e222d', border: '1px solid #363a45', boxShadow: '0 2px 5px rgba(0,0,0,0.5)',
          zIndex: 9999, padding: '4px 0', borderRadius: 4
        }}>
          <div
            onClick={handleResetChart}
            style={{ padding: '8px 16px', color: '#d1d4dc', fontSize: 12, cursor: 'pointer', fontFamily: "'JetBrains Mono', monospace" }}
            onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            重置图表
          </div>
        </div>
      )}
    </div>
  )
}
