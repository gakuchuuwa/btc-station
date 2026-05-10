'use client'

import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, LineSeries, Time, createSeriesMarkers } from 'lightweight-charts'

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface ChartMarker {
  time: number
  position: 'aboveBar' | 'belowBar' | 'inBar'
  color: string
  shape: string
  text?: string
}

export interface StrategyLine {
  label: string
  color: string
  points: { time: number; value: number }[]
}

interface Props {
  candles?: Candle[]
  markers?: ChartMarker[]
  strategyLines?: StrategyLine[]
  height?: number
}

export default function MiniChart({ candles, markers, strategyLines, height = 340 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current || !candles || candles.length === 0) return

    const container = containerRef.current
    const chart = createChart(container, {
      layout: { background: { color: 'transparent' }, textColor: '#787B86' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      rightPriceScale: { borderColor: '#222A35' },
      timeScale: { borderColor: '#222A35', timeVisible: true },
      width: container.clientWidth,
      height,
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26A69A', downColor: '#EF5350',
      borderUpColor: '#26A69A', borderDownColor: '#EF5350',
      wickUpColor: '#26A69A', wickDownColor: '#EF5350',
    })
    
    // Sort and dedup candles
    const sorted = [...candles]
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)

    candleSeries.setData(sorted.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })))

    // Markers
    if (markers && markers.length > 0) {
      const validTimes = new Set(sorted.map(c => c.time))
      const lwtMarkers = markers
        .filter(m => validTimes.has(m.time))
        .sort((a, b) => a.time - b.time)
        .map(m => ({
          time: m.time as Time,
          position: m.position,
          color: m.color,
          shape: m.shape,
          text: m.text ?? '',
        }))
      try {
        // v5 syntax
        ;(createSeriesMarkers as any)(candleSeries, lwtMarkers)
      } catch {
        // fallback
      }
    }

    // Strategy Lines (Indicators)
    if (strategyLines) {
      strategyLines.forEach(line => {
        const s = chart.addSeries(LineSeries, { color: line.color, lineWidth: 2, priceLineVisible: false })
        const validPoints = line.points
          .filter(p => !isNaN(p.value) && p.value !== null)
          .sort((a, b) => a.time - b.time)
          .filter((p, i, arr) => i === 0 || p.time !== arr[i - 1].time)
        s.setData(validPoints.map(p => ({ time: p.time as Time, value: p.value })))
      })
    }

    chart.timeScale().fitContent()

    const handleResize = () => chart.applyOptions({ width: container.clientWidth })
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [candles, markers, strategyLines, height])

  return <div ref={containerRef} style={{ width: '100%', height: height ?? '100%', display: 'block' }} />
}
