import re

file_path = 'btc-station/app/chart/page.tsx'

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# I want to rewrite the ChartPanel component.
# I will find the start of ChartPanel and the end of ChartPanel.
start_idx = content.find('function ChartPanel({')
end_idx = content.find('// IndicatorSidebar removed')

if start_idx == -1 or end_idx == -1:
    print("Could not find ChartPanel")
    exit(1)

new_chart_panel = """function ChartPanel({
  candles, tf, market, indicatorParams, drawings, activeTool,
  onDrawingComplete, onDeleteDrawing, hasMore, loadMoreCandles, isMain = true, ticker,
  markers = [],
  strategyLines = [],
  rangePreset = null,
}: ChartPanelProps) {
  const mainContainerRef = useRef<HTMLDivElement>(null)
  const volumeContainerRef = useRef<HTMLDivElement>(null)
  const rsiContainerRef = useRef<HTMLDivElement>(null)
  const macdContainerRef = useRef<HTMLDivElement>(null)
  const stochContainerRef = useRef<HTMLDivElement>(null)
  const atrContainerRef = useRef<HTMLDivElement>(null)
  const obvContainerRef = useRef<HTMLDivElement>(null)
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null)

  const chartsRef = useRef<{
    main: IChartApi | null;
    vol: IChartApi | null;
    rsi: IChartApi | null;
    macd: IChartApi | null;
    stoch: IChartApi | null;
    atr: IChartApi | null;
    obv: IChartApi | null;
  }>({ main: null, vol: null, rsi: null, macd: null, stoch: null, atr: null, obv: null })

  const seriesRefs = useRef<{
    candle: ISeriesApi<'Candlestick'> | null;
    vol: ISeriesApi<'Histogram'> | null;
    volMa: ISeriesApi<'Line'> | null;
    rsi: ISeriesApi<'Line'> | null;
    rsiOb: ISeriesApi<'Line'> | null;
    rsiOs: ISeriesApi<'Line'> | null;
    macdDif: ISeriesApi<'Line'> | null;
    macdDea: ISeriesApi<'Line'> | null;
    macdHist: ISeriesApi<'Histogram'> | null;
    stochK: ISeriesApi<'Line'> | null;
    stochD: ISeriesApi<'Line'> | null;
    stochOb: ISeriesApi<'Line'> | null;
    stochOs: ISeriesApi<'Line'> | null;
    atr: ISeriesApi<'Line'> | null;
    obv: ISeriesApi<'Line'> | null;
    obvMa: ISeriesApi<'Line'> | null;
  }>({
    candle: null, vol: null, volMa: null, rsi: null, rsiOb: null, rsiOs: null,
    macdDif: null, macdDea: null, macdHist: null,
    stochK: null, stochD: null, stochOb: null, stochOs: null,
    atr: null, obv: null, obvMa: null
  })

  const customMainSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const strategyLineSeriesRef = useRef<ISeriesApi<'Line'>[]>([])
  const markersInstanceRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)

  const [crosshairData, setCrosshairData] = useState<{
    time: string; open: string; high: string; low: string; close: string; vol: string; change: string; isUp: boolean
  } | null>(null)

  const [pendingPoint, setPendingPoint] = useState<{ time: number; price: number } | null>(null)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null)
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [textInputState, setTextInputState] = useState<{ pos: { time: number; price: number }; x: number; y: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const prevCandleCountRef = useRef(0)

  // 1. Initialize charts ONCE
  useEffect(() => {
    if (!mainContainerRef.current) return

    const cMain = createChart(mainContainerRef.current, { ...chartOptions(380), width: mainContainerRef.current.clientWidth })
    chartsRef.current.main = cMain
    seriesRefs.current.candle = cMain.addSeries(CandlestickSeries, {
      upColor: CHART_COLORS.up, downColor: CHART_COLORS.down,
      borderUpColor: CHART_COLORS.up, borderDownColor: CHART_COLORS.down,
      wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down,
    })

    cMain.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData || !seriesRefs.current.candle) { setCrosshairData(null); return }
      const cd = param.seriesData.get(seriesRefs.current.candle) as CandlestickData | undefined
      if (!cd) { setCrosshairData(null); return }
      const change = cd.open > 0 ? (cd.close - cd.open) / cd.open * 100 : 0
      setCrosshairData({
        time: fmtTime(param.time as number),
        open: fmtNum(cd.open), high: fmtNum(cd.high), low: fmtNum(cd.low), close: fmtNum(cd.close),
        vol: '—', // updated in main effect
        change: (change >= 0 ? '+' : '') + fmtNum(change) + '%',
        isUp: cd.close >= cd.open,
      })
    })

    if (volumeContainerRef.current) {
      const cVol = createChart(volumeContainerRef.current, { ...chartOptions(80), width: volumeContainerRef.current.clientWidth, timeScale: { visible: false } })
      chartsRef.current.vol = cVol
      seriesRefs.current.vol = cVol.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false })
      seriesRefs.current.volMa = cVol.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    }
    if (rsiContainerRef.current) {
      const c = createChart(rsiContainerRef.current, { ...chartOptions(110), width: rsiContainerRef.current.clientWidth, timeScale: { visible: false } })
      chartsRef.current.rsi = c
      seriesRefs.current.rsi = c.addSeries(LineSeries, { color: '#F7931A', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
      seriesRefs.current.rsiOb = c.addSeries(LineSeries, { color: 'rgba(255,255,255,0.2)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      seriesRefs.current.rsiOs = c.addSeries(LineSeries, { color: 'rgba(255,255,255,0.2)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    }
    if (macdContainerRef.current) {
      const c = createChart(macdContainerRef.current, { ...chartOptions(110), width: macdContainerRef.current.clientWidth, timeScale: { visible: false } })
      chartsRef.current.macd = c
      seriesRefs.current.macdDif = c.addSeries(LineSeries, { color: CHART_COLORS.up, lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
      seriesRefs.current.macdDea = c.addSeries(LineSeries, { color: CHART_COLORS.down, lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
      seriesRefs.current.macdHist = c.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false })
    }
    if (stochContainerRef.current) {
      const c = createChart(stochContainerRef.current, { ...chartOptions(110), width: stochContainerRef.current.clientWidth, timeScale: { visible: false } })
      chartsRef.current.stoch = c
      seriesRefs.current.stochK = c.addSeries(LineSeries, { color: '#2196F3', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
      seriesRefs.current.stochD = c.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
      seriesRefs.current.stochOb = c.addSeries(LineSeries, { color: 'rgba(255,255,255,0.2)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      seriesRefs.current.stochOs = c.addSeries(LineSeries, { color: 'rgba(255,255,255,0.2)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    }
    if (atrContainerRef.current) {
      const c = createChart(atrContainerRef.current, { ...chartOptions(100), width: atrContainerRef.current.clientWidth, timeScale: { visible: false } })
      chartsRef.current.atr = c
      seriesRefs.current.atr = c.addSeries(LineSeries, { color: '#9C27B0', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
    }
    if (obvContainerRef.current) {
      const c = createChart(obvContainerRef.current, { ...chartOptions(100), width: obvContainerRef.current.clientWidth, timeScale: { visible: false } })
      chartsRef.current.obv = c
      seriesRefs.current.obv = c.addSeries(LineSeries, { color: '#00BCD4', lineWidth: 1, priceLineVisible: false, lastValueVisible: true })
      seriesRefs.current.obvMa = c.addSeries(LineSeries, { color: '#FF9800', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
    }

    const handleResize = () => {
      if (mainContainerRef.current && chartsRef.current.main) chartsRef.current.main.applyOptions({ width: mainContainerRef.current.clientWidth })
      if (volumeContainerRef.current && chartsRef.current.vol) chartsRef.current.vol.applyOptions({ width: volumeContainerRef.current.clientWidth })
      if (rsiContainerRef.current && chartsRef.current.rsi) chartsRef.current.rsi.applyOptions({ width: rsiContainerRef.current.clientWidth })
      if (macdContainerRef.current && chartsRef.current.macd) chartsRef.current.macd.applyOptions({ width: macdContainerRef.current.clientWidth })
      if (stochContainerRef.current && chartsRef.current.stoch) chartsRef.current.stoch.applyOptions({ width: stochContainerRef.current.clientWidth })
      if (atrContainerRef.current && chartsRef.current.atr) chartsRef.current.atr.applyOptions({ width: atrContainerRef.current.clientWidth })
      if (obvContainerRef.current && chartsRef.current.obv) chartsRef.current.obv.applyOptions({ width: obvContainerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    // Sync time scales
    const charts = Object.values(chartsRef.current).filter(Boolean) as IChartApi[]
    let syncing = false
    charts.forEach((chart, idx) => {
      chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (syncing || !range) return
        syncing = true
        charts.forEach((other, otherIdx) => {
          if (idx !== otherIdx) {
            try { other.timeScale().setVisibleLogicalRange(range) } catch {}
          }
        })
        syncing = false
      })
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      Object.values(chartsRef.current).forEach(c => {
        if (c) {
          try { c.remove() } catch {}
        }
      })
      chartsRef.current = { main: null, vol: null, rsi: null, macd: null, stoch: null, atr: null, obv: null }
    }
  }, []) // Initialize only once

  // 2. Update Data seamlessly
  useEffect(() => {
    if (candles.length === 0 || !seriesRefs.current.candle) return

    const sorted = [...candles].sort((a, b) => a.time - b.time).filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time)
    const closes = sorted.map(c => c.close)
    const times  = sorted.map(c => c.time as Time)

    // Set Main K-line
    seriesRefs.current.candle.setData(sorted.map(c => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })))

    // Handle Zoom/Range Preset
    const isHistoricalLoad = candles.length > prevCandleCountRef.current * 1.5 && candles.length - prevCandleCountRef.current > 500
    prevCandleCountRef.current = candles.length
    
    if (chartsRef.current.main) {
      if (rangePreset !== null) {
        const TF_SEC: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800 }
        const bars = Math.ceil(rangePreset * 86400 / (TF_SEC[tf] ?? 3600))
        chartsRef.current.main.timeScale().setVisibleLogicalRange({ from: candles.length - bars - 1, to: candles.length })
      } else if (isHistoricalLoad) {
        chartsRef.current.main.timeScale().fitContent()
      }
    }

    // Update Custom Main Series (MA, EMA, BB)
    if (chartsRef.current.main) {
      customMainSeriesRef.current.forEach(s => {
        try { chartsRef.current.main!.removeSeries(s) } catch {}
      })
      customMainSeriesRef.current = []

      if (indicatorParams.ma.enabled) {
        indicatorParams.ma.periods.forEach((period, idx) => {
          if (!period) return
          const color = indicatorParams.ma.colors[idx] ?? '#888'
          const s = chartsRef.current.main!.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
          s.setData(calcMA(closes, period).map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
          customMainSeriesRef.current.push(s)
        })
      }
      if (indicatorParams.ema.enabled) {
        indicatorParams.ema.periods.forEach((period, idx) => {
          if (!period) return
          const color = indicatorParams.ema.colors[idx] ?? '#888'
          const s = chartsRef.current.main!.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
          s.setData(calcEMA(closes, period).map((v, i) => ({ time: times[i], value: v })))
          customMainSeriesRef.current.push(s)
        })
      }
      if (indicatorParams.bollinger.enabled) {
        const bbData = calcBB(closes, indicatorParams.bollinger.period, indicatorParams.bollinger.stdDev)
        const colors = ['rgba(100,181,246,0.8)', 'rgba(100,181,246,0.5)', 'rgba(100,181,246,0.8)']
        const keys: ('upper' | 'middle' | 'lower')[] = ['upper', 'middle', 'lower']
        colors.forEach((color, i) => {
          const s = chartsRef.current.main!.addSeries(LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
          s.setData(bbData.map((v, j) => v ? { time: times[j], value: v[keys[i]] } : null).filter((v): v is LineData => v !== null))
          customMainSeriesRef.current.push(s)
        })
      }
    }

    // Update Sub Charts
    if (indicatorParams.volume_ma.enabled || true) { // Vol is always visible
      if (seriesRefs.current.vol) {
        seriesRefs.current.vol.setData(sorted.map(c => ({
          time: c.time as Time, value: c.volume, color: c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)',
        })))
      }
      if (indicatorParams.volume_ma.enabled && seriesRefs.current.volMa) {
        const maVals = calcMA(sorted.map(c => c.volume), indicatorParams.volume_ma.period)
        seriesRefs.current.volMa.setData(maVals.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
      } else if (seriesRefs.current.volMa) {
        seriesRefs.current.volMa.setData([])
      }
    }

    if (indicatorParams.rsi.enabled && seriesRefs.current.rsi) {
      const { period, overbought, oversold } = indicatorParams.rsi
      const rsiValues = calcRSI(closes, period)
      seriesRefs.current.rsi.setData(rsiValues.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
      seriesRefs.current.rsiOb?.setData(sorted.map(c => ({ time: c.time as Time, value: overbought })))
      seriesRefs.current.rsiOs?.setData(sorted.map(c => ({ time: c.time as Time, value: oversold })))
    }

    if (indicatorParams.macd.enabled && seriesRefs.current.macdDif) {
      const { fast, slow, signal } = indicatorParams.macd
      const { dif, dea, hist } = calcMACD(closes, fast, slow, signal)
      seriesRefs.current.macdDif.setData(dif.map((v, i) => ({ time: times[i], value: v })))
      seriesRefs.current.macdDea?.setData(dea.map((v, i) => ({ time: times[i], value: v })))
      seriesRefs.current.macdHist?.setData(hist.map((v, i) => ({ time: times[i], value: v, color: v >= 0 ? 'rgba(38,166,154,0.6)' : 'rgba(239,83,80,0.6)' })))
    }

    if (indicatorParams.stochastic.enabled && seriesRefs.current.stochK) {
      const { k_period, k_smooth, d_period } = indicatorParams.stochastic
      const { k, d } = calcStochastic(sorted.map(c => c.high), sorted.map(c => c.low), closes, k_period, k_smooth, d_period)
      seriesRefs.current.stochK.setData(k.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
      seriesRefs.current.stochD?.setData(d.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
      seriesRefs.current.stochOb?.setData(sorted.map(c => ({ time: c.time as Time, value: 80 })))
      seriesRefs.current.stochOs?.setData(sorted.map(c => ({ time: c.time as Time, value: 20 })))
    }

    if (indicatorParams.atr.enabled && seriesRefs.current.atr) {
      const atrVals = calcATR(sorted.map(c => c.high), sorted.map(c => c.low), closes, indicatorParams.atr.period)
      seriesRefs.current.atr.setData(atrVals.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
    }

    if (indicatorParams.obv.enabled && seriesRefs.current.obv) {
      const obvVals = calcOBV(closes, sorted.map(c => c.volume))
      seriesRefs.current.obv.setData(obvVals.map((v, i) => ({ time: times[i], value: v })))
      if (indicatorParams.obv.ma_period > 0 && seriesRefs.current.obvMa) {
        const maVals = calcMA(obvVals, indicatorParams.obv.ma_period)
        seriesRefs.current.obvMa.setData(maVals.map((v, i) => v !== null ? { time: times[i], value: v } : null).filter((v): v is LineData => v !== null))
      } else if (seriesRefs.current.obvMa) {
        seriesRefs.current.obvMa.setData([])
      }
    }
  }, [candles, indicatorParams, rangePreset, tf])

  // 3. Markers Updates
  useEffect(() => {
    if (!seriesRefs.current.candle || candles.length === 0) return
    if (markersInstanceRef.current) {
      try { markersInstanceRef.current.detach() } catch {}
      markersInstanceRef.current = null
    }
    if (markers.length === 0) return

    const sortedTimes = candles.map(c => c.time).sort((a, b) => a - b)
    const validTimes = new Set(sortedTimes)
    const snapToCandle = (ts: number) => {
      if (validTimes.has(ts)) return ts
      let lo = 0, hi = sortedTimes.length - 1, best = sortedTimes[0]
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (Math.abs(sortedTimes[mid] - ts) < Math.abs(best - ts)) best = sortedTimes[mid]
        if (sortedTimes[mid] < ts) lo = mid + 1; else hi = mid - 1
      }
      return best
    }

    const lwtMarkers = markers.slice().sort((a, b) => a.time - b.time).map(m => ({
      time: snapToCandle(m.time) as Time, position: m.position, color: m.color, shape: m.shape, size: 2 as const, text: m.text ?? '',
    }))

    const seen = new Set<string>()
    const dedup = lwtMarkers.filter(m => {
      const key = `${m.time}_${m.position}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    try {
      markersInstanceRef.current = createSeriesMarkers(seriesRefs.current.candle, dedup)
    } catch {}
  }, [markers, candles])

  // 4. Strategy Lines Updates
  useEffect(() => {
    if (!chartsRef.current.main) return
    strategyLineSeriesRef.current.forEach(s => { try { chartsRef.current.main!.removeSeries(s) } catch {} })
    strategyLineSeriesRef.current = []

    strategyLines.forEach(line => {
      try {
        const s = chartsRef.current.main!.addSeries(LineSeries, { color: line.color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: line.label })
        s.setData(line.points.map(p => ({ time: p.time as Time, value: p.value })))
        strategyLineSeriesRef.current.push(s)
      } catch {}
    })
  }, [strategyLines])

  // Canvas Drawing
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
    return Math.max(...prices) - (y / rect.height) * (Math.max(...prices) - Math.min(...prices))
  }, [candles])

  const getTimeAtX = useCallback((x: number): number => {
    const chart = chartsRef.current.main
    const canvas = drawingCanvasRef.current
    if (!chart || !canvas) return Date.now() / 1000
    const time = chart.timeScale().coordinateToTime(x)
    if (time !== null) return time as number
    if (candles.length === 0) return Date.now() / 1000
    const ratio = x / canvas.getBoundingClientRect().width
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

    if (activeTool === 'cursor') { setSelectedDrawingId(null); return }
    if (activeTool === 'delete') { if (selectedDrawingId) onDeleteDrawing(selectedDrawingId); setSelectedDrawingId(null); return }
    if (activeTool === 'horizontal') { onDrawingComplete({ id: `h_${Date.now()}`, type: 'horizontal', price, color: '#FFD700', width: 1 }); return }
    if (activeTool === 'text') { setTextInputState({ pos: { time, price }, x: e.clientX - (canvas.parentElement?.getBoundingClientRect().left ?? 0), y: e.clientY - (canvas.parentElement?.getBoundingClientRect().top ?? 0) }); return }

    if (activeTool === 'trendline' || activeTool === 'rectangle' || activeTool === 'fibonacci') {
      if (!pendingPoint) setPendingPoint({ time, price })
      else {
        const id = `${activeTool}_${Date.now()}`
        if (activeTool === 'trendline') onDrawingComplete({ id, type: 'trendline', p1: pendingPoint, p2: { time, price }, color: '#FFD700', width: 1 })
        else if (activeTool === 'rectangle') onDrawingComplete({ id, type: 'rectangle', p1: pendingPoint, p2: { time, price }, color: 'rgba(100,181,246,0.3)', width: 1, fillAlpha: 0.15 })
        else if (activeTool === 'fibonacci') onDrawingComplete({ id, type: 'fibonacci', p1: pendingPoint, p2: { time, price }, color: '#fff', width: 1 })
        setPendingPoint(null)
      }
    }
  }, [activeTool, pendingPoint, selectedDrawingId, getPriceAtY, getTimeAtX, onDrawingComplete, onDeleteDrawing])

  const handleContextMenu = useCallback((e: React.MouseEvent) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }) }, [])
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const cursorStyle: React.CSSProperties['cursor'] = activeTool === 'cursor' ? 'default' : activeTool === 'delete' ? 'not-allowed' : activeTool === 'text' ? 'text' : 'crosshair'
  const isUp = ticker.change24h >= 0

  return (
    <div style={{ position: 'relative' }}>
      {crosshairData && (
        <div style={{
          position: 'absolute', top: 8, left: 12, zIndex: 20, display: 'flex', gap: 16, fontSize: 12, fontFamily: 'var(--font-mono, monospace)',
          color: 'var(--text-mute)', pointerEvents: 'none', background: 'rgba(13,17,23,0.85)', borderRadius: 6, padding: '6px 12px', backdropFilter: 'blur(8px)',
        }}>
          <span style={{ color: 'var(--text-dim)' }}>{crosshairData.time}</span>
          <span>开 <b style={{ color: 'var(--text)' }}>{crosshairData.open}</b></span>
          <span>高 <b style={{ color: 'var(--text)' }}>{crosshairData.high}</b></span>
          <span>低 <b style={{ color: 'var(--text)' }}>{crosshairData.low}</b></span>
          <span>收 <b style={{ color: 'var(--text)' }}>{crosshairData.close}</b></span>
          <span style={{ color: crosshairData.isUp ? 'var(--up)' : 'var(--down)', fontWeight: 600 }}>{crosshairData.change}</span>
        </div>
      )}

      <div style={{ position: 'relative' }} onContextMenu={handleContextMenu}>
        <div ref={mainContainerRef} style={{ height: 380, width: '100%' }} />
        <canvas
          ref={drawingCanvasRef}
          style={{ position: 'absolute', top: 0, left: 0, zIndex: 10, cursor: cursorStyle, pointerEvents: activeTool !== 'cursor' ? 'auto' : 'none' }}
          onClick={handleCanvasClick} onMouseMove={handleCanvasMouseMove} onMouseLeave={() => setMousePos(null)}
        />
        <DrawingLayer
          canvasRef={drawingCanvasRef} chartRef={{ current: chartsRef.current.main }} candles={candles} drawings={drawings} activeTool={activeTool} pendingPoint={pendingPoint} mousePos={mousePos}
          onDrawingComplete={onDrawingComplete} onDeleteDrawing={onDeleteDrawing} selectedId={selectedDrawingId} onSelectDrawing={setSelectedDrawingId}
        />
        {textInputState && (
          <div style={{ position: 'absolute', left: textInputState.x, top: textInputState.y, zIndex: 30 }}>
            <input autoFocus style={{ background: '#1a2232', border: '1px solid #F7931A', color: '#fff', borderRadius: 4, padding: '4px 8px', fontSize: 13 }} placeholder="输入文字..."
              onKeyDown={e => { if (e.key === 'Enter') { const val = (e.target as HTMLInputElement).value.trim(); if (val) onDrawingComplete({ id: `text_${Date.now()}`, type: 'text', pos: textInputState.pos, content: val, color: '#FFD700', width: 1 }); setTextInputState(null) } else if (e.key === 'Escape') setTextInputState(null) }}
              onBlur={() => setTextInputState(null)} />
          </div>
        )}
        {contextMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={closeContextMenu} />
            <div style={{ position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 50, background: '#1a2232', border: '1px solid #2a3550', borderRadius: 6, minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
              {[
                { label: '重置视图', action: () => { chartsRef.current.main?.timeScale().resetTimeScale(); closeContextMenu() } },
                { label: '最新K线', action: () => { chartsRef.current.main?.timeScale().scrollToRealTime(); closeContextMenu() } },
                { label: '清空画线', action: () => { if (confirm('确认清空所有画线？')) { onDeleteDrawing('__all__'); closeContextMenu() } } },
                { label: '取消画线模式', action: () => { setPendingPoint(null); closeContextMenu() }, dimmed: !pendingPoint },
              ].map(item => (
                <button key={item.label} onClick={item.action} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 16px', background: 'none', border: 'none', color: item.dimmed ? 'var(--text-dim)' : 'var(--text)', cursor: 'pointer', fontSize: 13 }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')} onMouseLeave={e => (e.currentTarget.style.background = 'none')}>{item.label}</button>
              ))}
            </div>
          </>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border)', display: indicatorParams.volume_ma.enabled || true ? 'block' : 'none' }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>成交量{indicatorParams.volume_ma.enabled ? ` · MA(${indicatorParams.volume_ma.period})` : ''}</div>
        <div ref={volumeContainerRef} style={{ height: 80, width: '100%' }} />
      </div>
      <div style={{ borderTop: '1px solid var(--border)', display: indicatorParams.rsi.enabled ? 'block' : 'none' }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>RSI ({indicatorParams.rsi.period})</div>
        <div ref={rsiContainerRef} style={{ height: 110, width: '100%' }} />
      </div>
      <div style={{ borderTop: '1px solid var(--border)', display: indicatorParams.macd.enabled ? 'block' : 'none' }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>MACD ({indicatorParams.macd.fast},{indicatorParams.macd.slow},{indicatorParams.macd.signal})</div>
        <div ref={macdContainerRef} style={{ height: 110, width: '100%' }} />
      </div>
      <div style={{ borderTop: '1px solid var(--border)', display: indicatorParams.stochastic.enabled ? 'block' : 'none' }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>Stochastic ({indicatorParams.stochastic.k_period},{indicatorParams.stochastic.k_smooth},{indicatorParams.stochastic.d_period})</div>
        <div ref={stochContainerRef} style={{ height: 110, width: '100%' }} />
      </div>
      <div style={{ borderTop: '1px solid var(--border)', display: indicatorParams.atr.enabled ? 'block' : 'none' }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>ATR ({indicatorParams.atr.period})</div>
        <div ref={atrContainerRef} style={{ height: 100, width: '100%' }} />
      </div>
      <div style={{ borderTop: '1px solid var(--border)', display: indicatorParams.obv.enabled ? 'block' : 'none' }}>
        <div style={{ padding: '4px 12px', fontSize: 10, color: 'var(--text-dim)' }}>OBV</div>
        <div ref={obvContainerRef} style={{ height: 100, width: '100%' }} />
      </div>

      {isMain && <div style={{ padding: '4px 12px 8px', fontSize: 11, color: 'var(--text-dim)', textAlign: 'right' }}>数据来源：OKX 公共 API · {market === 'swap' ? 'BTC/USDT 永续' : 'BTC/USDT 现货'} · {TF_LABELS[tf] ?? tf} · 每 10 秒更新</div>}
      {!isMain && <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-dim)' }}>{TF_LABELS[tf] ?? tf} &nbsp;<span style={{ color: isUp ? 'var(--up)' : 'var(--down)' }}>{formatUsd(ticker.lastPrice)}</span></div>}
    </div>
  )
}
"""

content = content[:start_idx] + new_chart_panel + content[end_idx:]

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Successfully refactored ChartPanel.")
