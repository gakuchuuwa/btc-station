'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import dynamic from 'next/dynamic'
import MiniChart, { type Candle, type ChartMarker, type StrategyLine } from '@/components/MiniChart'
import StrategyTesterPanel, { type BacktestSummary, type TradeRecord, type EpochRecord, type ParamRow } from '@/components/StrategyTesterPanel'
import { saveStrategy, listMyStrategies, deleteStrategy, type StrategyMeta } from '@/lib/freqtrade-api'

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)' }}>编辑器加载中…</div> })

const TF_LABELS: Record<string, string> = { '1m': '1分', '5m': '5分', '15m': '15分', '1h': '1时', '4h': '4时', '1d': '日', '1w': '周' }

const DEFAULT_CODE = `"""
自定义策略模板 — VectorBT 格式

规则：
1. 必须定义 execute(df, parameters) 函数
2. df 包含列: open, high, low, close, volume
3. 返回 (portfolio, indicators_dict)
4. indicators_dict 的值为 pd.Series，将叠加到图表上

可用库: vectorbt (vbt), pandas (pd), numpy (np), pandas_ta (ta)
"""
import vectorbt as vbt


def execute(df, parameters):
    fast = int(parameters.get("fast_period", 10))
    slow = int(parameters.get("slow_period", 30))

    fast_ma = vbt.MA.run(df["close"], fast)
    slow_ma = vbt.MA.run(df["close"], slow)

    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=parameters.get("initial_capital", 10000),
        fees=0.0005,
    )

    return pf, {"快线": fast_ma.ma, "慢线": slow_ma.ma}
`

const LS_CODE_KEY = 'custom_strategy_code'
const LS_NAME_KEY = 'custom_strategy_name'
const INDICATOR_COLORS = ['#26a69a', '#ef5350', '#FFD700', '#7B68EE', '#FF8C00', '#00CED1']

export default function StrategyPage() {
  const [code, setCode] = useState('')
  const [strategyName, setStrategyName] = useState('我的策略')
  const [tf, setTf] = useState('4h')
  const [candles, setCandles] = useState<Candle[]>([])

  // Save state
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState('')

  // My strategies
  const [myStrategies, setMyStrategies] = useState<StrategyMeta[]>([])
  const [loadingStrategies, setLoadingStrategies] = useState(false)

  // Resize state
  const [s1Height, setS1Height] = useState(500)
  const [s2Height, setS2Height] = useState(500)
  const [s3Height, setS3Height] = useState(500)
  const [s4Height, setS4Height] = useState(1000)

  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startHeightRef = useRef(0)

  const handleDragStart = useCallback((e: React.MouseEvent, setter: React.Dispatch<React.SetStateAction<number>>, currentHeight: number) => {
    isDraggingRef.current = true
    startYRef.current = e.clientY
    startHeightRef.current = currentHeight

    // 拖拽期间锁住鼠标样式 + 禁止文本选中,避免拖拽时网页文字被选中变蓝
    const prevCursor = document.body.style.cursor
    const prevSelect = document.body.style.userSelect
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = ev.clientY - startYRef.current
      setter(Math.max(100, startHeightRef.current + delta))
    }

    const handleMouseUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = prevCursor
      document.body.style.userSelect = prevSelect
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  // Backtest state
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [summary, setSummary] = useState<BacktestSummary | null>(null)
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [equity, setEquity] = useState<{time:number;equity:number}[]>([])
  const [markers, setMarkers] = useState<ChartMarker[]>([])
  const [strategyLines, setStrategyLines] = useState<StrategyLine[]>([])
  const [xlsxToken, setXlsxToken] = useState<string | null>(null)
  // S3 回测时间范围(空字符串=不限制)
  const [btStartDate, setBtStartDate] = useState('')
  const [btEndDate, setBtEndDate] = useState('')

  // Optimize state
  const [optimizeStatus, setOptimizeStatus] = useState<'idle'|'running'|'completed'|'failed'>('idle')
  const [optimizeEpochs, setOptimizeEpochs] = useState<EpochRecord[]>([])
  const [optimizeError, setOptimizeError] = useState('')
  const [optimizeProgress, setOptimizeProgress] = useState<{ iter: number; total: number }>({ iter: 0, total: 0 })

  // Load saved code
  useEffect(() => {
    const saved = localStorage.getItem(LS_CODE_KEY)
    setCode(saved || DEFAULT_CODE)
    const savedName = localStorage.getItem(LS_NAME_KEY)
    // 清除残留的日文名
    if (savedName && /[぀-ヿ]/.test(savedName)) {
      localStorage.removeItem(LS_NAME_KEY)
    } else if (savedName) {
      setStrategyName(savedName)
    }
  }, [])

  // Auto-save code
  const handleCodeChange = useCallback((val: string | undefined) => {
    const v = val ?? ''
    setCode(v)
    localStorage.setItem(LS_CODE_KEY, v)
  }, [])

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setStrategyName(e.target.value)
    localStorage.setItem(LS_NAME_KEY, e.target.value)
  }, [])

  // Cloud save handler
  const handleSave = useCallback(async () => {
    setSaving(true)
    setSaveMsg('')
    try {
      const result = await saveStrategy({ id: savedId ?? undefined, name: strategyName, code })
      setSavedId(result.id)
      setSaveMsg('✓ 已保存')
      setTimeout(() => setSaveMsg(''), 3000)
      // Refresh my strategies list
      listMyStrategies().then(setMyStrategies).catch(() => {})
    } catch (e: unknown) {
      setSaveMsg((e as Error).message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }, [savedId, strategyName, code])

  // Fetch my strategies on mount
  useEffect(() => {
    listMyStrategies().then(setMyStrategies).catch(() => {})
  }, [])

  // Load a saved strategy from cloud
  const handleLoadMyStrategy = useCallback(async (s: StrategyMeta) => {
    setLoadingStrategies(true)
    try {
      const res = await fetch(`/py-api/api/strategies/${s.id}`, { headers: { 'Content-Type': 'application/json' } })
      if (res.ok) {
        const d = await res.json()
        setCode(d.code)
        localStorage.setItem(LS_CODE_KEY, d.code)
      }
      setStrategyName(s.name)
      localStorage.setItem(LS_NAME_KEY, s.name)
      setSavedId(s.id)
      setActiveTemplateId(null)
    } catch { /* ignore */ }
    finally { setLoadingStrategies(false) }
  }, [])

  // New strategy
  const handleNewStrategy = useCallback(() => {
    setCode(DEFAULT_CODE)
    setStrategyName('新策略')
    setSavedId(null)
    setSaveMsg('')
    setActiveTemplateId(null)
    localStorage.setItem(LS_CODE_KEY, DEFAULT_CODE)
    localStorage.setItem(LS_NAME_KEY, '新策略')
  }, [])

  // Delete strategy
  const handleDeleteStrategy = useCallback(async (s: StrategyMeta, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`确认删除「${s.name}」？此操作不可撤销。`)) return
    try {
      await deleteStrategy(s.id)
      setMyStrategies(prev => prev.filter(x => x.id !== s.id))
      if (savedId === s.id) {
        setSavedId(null)
        setSaveMsg('')
      }
    } catch (err: unknown) {
      alert(`删除失败：${(err as Error).message}`)
    }
  }, [savedId])

  // 从后端全量历史数据缓存加载 K 线(唯一路径,符合 CLAUDE.md 铁律)
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch(`/py-api/api/candles/${tf}`)
        if (!res.ok || !active) return
        const d = await res.json()
        if (d.candles?.length > 0 && active) {
          setCandles(normalizeCandles(d.candles))
        }
      } catch { /* 后端未启动 */ }
    })()
    return () => { active = false }
  }, [tf])

  // K 线归一化:时间戳 ms→s + 去重 + 升序排
  const normalizeCandles = (raw: Candle[]): Candle[] =>
    raw.map(c => ({ ...c, time: c.time > 1e12 ? Math.floor(c.time / 1000) : c.time }))
       .sort((a, b) => a.time - b.time)
       .filter((c, i, arr) => i === 0 || c.time !== arr[i-1].time)

  // Parse timestamp helper
  const parseToSec = (v: unknown): number => {
    if (v == null || v === '') return 0
    if (typeof v === 'string') { const ms = Date.parse(v); if (isFinite(ms) && ms > 0) return Math.floor(ms / 1000); const n = Number(v); if (isFinite(n) && n > 0) return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n) }
    if (typeof v === 'number' && isFinite(v) && v > 0) return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v)
    return 0
  }

  // Snap to nearest candle time
  const snapToCandle = useCallback((ts: number, sortedTimes: number[]) => {
    if (!sortedTimes.length) return ts
    let lo = 0, hi = sortedTimes.length - 1, best = sortedTimes[0]
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (Math.abs(sortedTimes[mid] - ts) < Math.abs(best - ts)) best = sortedTimes[mid]; if (sortedTimes[mid] < ts) lo = mid + 1; else hi = mid - 1 }
    return best
  }, [])

  // Process backtest result into UI state
  const processResult = useCallback((result: Record<string, unknown>, fullCandles: Candle[]) => {
    const m = { ...(result.metrics as Record<string, number>), net_profit_pct: (result.metrics as Record<string, number>)?.total_return_pct ?? 0 }
    setSummary({ ...m, initial_capital: 10000 } as BacktestSummary)
    setXlsxToken((result.xlsx_token as string | null) ?? null)

    const rawTrades = (result.trades ?? []) as Record<string, unknown>[]
    const parsedTrades: TradeRecord[] = rawTrades.map(t => ({
      entry_time: parseToSec(t['Entry Timestamp'] ?? t.open_timestamp ?? t.open_date),
      exit_time: parseToSec(t['Exit Timestamp'] ?? t.close_timestamp ?? t.close_date) || undefined,
      pair: 'BTC/USDT',
      direction: ((t['Direction'] === 'Short' || t.is_short) ? 'short' : 'long') as 'long' | 'short',
      entry_price: Number(t['Avg Entry Price'] ?? t['Entry Price'] ?? t.open_rate ?? 0),
      exit_price: Number(t['Avg Exit Price'] ?? t['Exit Price'] ?? t.close_rate ?? 0),
      pnl_pct: Number(t['Return'] ?? t.profit_ratio ?? 0) * 100,
      pnl_abs: Number(t['PnL'] ?? t.profit_abs ?? 0),
      size: t['Size'] != null ? Number(t['Size']) : (t.amount != null ? Number(t.amount) : undefined),
      signal:      t['Signal'] != null ? String(t['Signal']) : undefined,
      exit_signal: t['ExitSignal'] != null ? String(t['ExitSignal']) : undefined,
    }))
    setTrades(parsedTrades)
    setEquity((result.equity ?? []) as {time:number;equity:number}[])

    // Markers（TV 风格：做多绿色、做空红色、平仓紫色）
    const sortedTimes = [...fullCandles].sort((a, b) => a.time - b.time).map(c => c.time)
    const mkrs: ChartMarker[] = []
    parsedTrades.forEach(t => {
      const isLong = t.direction === 'long'
      // 开仓
      if (t.entry_time) mkrs.push({
        time:     snapToCandle(t.entry_time, sortedTimes),
        position: isLong ? 'belowBar' : 'aboveBar',
        color:    isLong ? '#26a69a' : '#ef5350',
        shape:    isLong ? 'arrowUp' : 'arrowDown',
        text:     isLong ? '做多' : '做空',
      })
      // 平仓
      if (t.exit_time) mkrs.push({
        time:     snapToCandle(t.exit_time, sortedTimes),
        position: isLong ? 'aboveBar' : 'belowBar',
        color:    '#9c27b0',
        shape:    isLong ? 'arrowDown' : 'arrowUp',
        text:     '平仓',
      })
    })
    mkrs.sort((a, b) => a.time - b.time)
    setTimeout(() => setMarkers(mkrs), 100)

    // Indicator lines
    const indics = (result.indicators ?? {}) as Record<string, {time:number;value:number}[]>
    const lines = Object.entries(indics).filter(([, pts]) => Array.isArray(pts) && pts.length > 0).map(([name, pts], idx) => ({ label: name, color: INDICATOR_COLORS[idx % INDICATOR_COLORS.length], points: pts }))
    setStrategyLines(lines)
  }, [snapToCandle])

  // Run backtest
  const handleRun = useCallback(async () => {
    if (!code.trim() || running) return
    setRunning(true); setLogs([]); setSummary(null); setTrades([]); setEquity([]); setMarkers([]); setStrategyLines([]); setXlsxToken(null)
    const rangeLabel = btStartDate || btEndDate ? `${btStartDate || '最早'} → ${btEndDate || '至今'}` : '全量历史数据'
    setLogs([`▶ ${strategyName} · ${tf} · ${rangeLabel}`])
    try {
      const btParams: Record<string, unknown> = { initial_capital: 10000 }
      if (btStartDate) btParams.start_date = btStartDate
      if (btEndDate) btParams.end_date = btEndDate
      const btRes = await fetch('/py-api/api/backtest/dynamic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, symbol: 'BTC/USDT', timeframe: tf, parameters: btParams }),
      })
      if (!btRes.ok) { const err = await btRes.json().catch(() => ({ detail: btRes.statusText })); throw new Error(`回测失败 (${btRes.status}): ${err.detail ?? '未知错误'}`) }
      const result = await btRes.json()

      // K 线已在挂载/tf 变化时加载,这里只在缺失时补加
      let fullCandles = candles
      if (fullCandles.length === 0) {
        try {
          const histRes = await fetch(`/py-api/api/candles/${tf}`)
          if (histRes.ok) {
            const hd = await histRes.json()
            if (hd.candles?.length > 0) {
              fullCandles = normalizeCandles(hd.candles)
              setCandles(fullCandles)
            }
          }
        } catch {}
      }

      processResult(result, fullCandles)
      const m = result.metrics as Record<string, number>
      const npct = m.total_return_pct ?? 0
      setLogs(p => [...p, `✓ ${strategyName} 回测完成`, `净收益 ${npct >= 0 ? '+' : ''}${npct.toFixed(2)}% | 回撤 ${(m.max_drawdown_pct ?? 0).toFixed(2)}% | 胜率 ${(m.win_rate_pct ?? 0).toFixed(1)}% | ${m.total_trades ?? 0} 笔`])
    } catch (e: unknown) {
      setLogs(p => [...p, `✗ ${(e as Error).message}`])
    } finally { setRunning(false) }
  }, [code, tf, strategyName, candles, running, processResult, btStartDate, btEndDate])

  // Optimize
  const handleOptimizeStart = useCallback(async (paramRows: ParamRow[], startDate: string, method: 'grid' | 'annealing' = 'grid', target: string = 'calmar') => {
    if (!code.trim()) return
    setOptimizeStatus('running'); setOptimizeEpochs([]); setOptimizeError('')
    setOptimizeProgress({ iter: 0, total: 0 })
    try {
      const grid: Record<string, { start: number; stop: number; step: number }> = {}
      for (const r of paramRows) { if (r.name.trim() && r.step > 0) grid[r.name.trim()] = { start: r.start, stop: r.stop, step: r.step } }
      if (!Object.keys(grid).length) throw new Error('请至少添加一个参数网格行')

      // SSE 流式读取 — 走 Next.js 原生 API 路由,绕开 /py-api rewrite 的缓冲
      const res = await fetch('/api/optimize/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, symbol: 'BTC/USDT', timeframe: tf, grid, method, target, start_date: startDate, iterations: method === 'annealing' ? 100 : undefined }),
      })
      if (!res.ok || !res.body) { const err = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(err.detail ?? '调参失败') }

      const reader = res.body.getReader()
      const decoder = new TextDecoder('utf-8')
      let buf = ''
      const liveEpochs: EpochRecord[] = []

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        // 按 SSE 双换行切分事件
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.split('\n').find(l => l.startsWith('data: '))
          if (!line) continue
          const payload = JSON.parse(line.slice(6))

          if (payload.type === 'error') throw new Error(payload.detail || '调参失败')

          if (payload.type === 'progress') {
            setOptimizeProgress({ iter: payload.iter, total: payload.total })
            const r = payload.result
            if (r && r.status === 'ok') {
              liveEpochs.push({
                epoch: payload.iter,
                total_epochs: payload.total,
                profit_pct: Number(r.net_profit_pct) ?? 0,
                drawdown_pct: Number(r.max_drawdown_pct) ?? 0,
                trades: Number(r.total_trades) ?? 0,
                win_rate_pct: Number(r.win_rate_pct) ?? 0,
                params: r.parameters as Record<string, string>,
              })
              // 每 5 次更新一次 UI,避免重渲染过频
              if (payload.iter % 5 === 0 || payload.iter === payload.total) {
                setOptimizeEpochs([...liveEpochs])
              }
            }
          } else if (payload.type === 'done') {
            // 用后端排好序的完整结果替换
            const finalEpochs: EpochRecord[] = (payload.results ?? [])
              .filter((r: Record<string, unknown>) => r.status === 'ok')
              .map((r: Record<string, unknown>, i: number) => ({
                epoch: i + 1, total_epochs: payload.total_combinations,
                profit_pct: Number(r.net_profit_pct) ?? 0,
                drawdown_pct: Number(r.max_drawdown_pct) ?? 0,
                trades: Number(r.total_trades) ?? 0,
                win_rate_pct: Number(r.win_rate_pct) ?? 0,
                params: r.parameters as Record<string, string>,
              }))
            setOptimizeEpochs(finalEpochs); setOptimizeStatus('completed')
            try { localStorage.setItem('optimize_epochs', JSON.stringify(finalEpochs)); localStorage.setItem('optimize_strategy_name', strategyName); localStorage.setItem('optimize_timeframe', tf) } catch {}
          }
        }
      }
    } catch (e: unknown) { setOptimizeError((e as Error).message); setOptimizeStatus('failed') }
  }, [code, tf, strategyName])

  const handleOptimizeCsvDownload = useCallback(async () => {
    try { const r = await fetch('/py-api/api/optimize/export-csv'); if (!r.ok) throw new Error('CSV 导出失败'); const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'optimization.csv'; a.click(); URL.revokeObjectURL(url) } catch (e) { alert((e as Error).message) }
  }, [])

  const handleApplyBestParams = useCallback((params: Record<string, string>) => {
    setLogs([`▶ 应用最优参数: ${Object.entries(params).map(([k,v]) => `${k}=${v}`).join(', ')}`])
    setRunning(true); setSummary(null); setTrades([]); setEquity([]); setMarkers([]); setStrategyLines([]); setXlsxToken(null)
    ;(async () => {
      try {
        const parsedParams: Record<string, number|string> = {}
        for (const [k, v] of Object.entries(params)) { const n = Number(v); parsedParams[k] = isNaN(n) ? v : n }
        const applyParams: Record<string, unknown> = { ...parsedParams, initial_capital: 10000 }
        if (btStartDate) applyParams.start_date = btStartDate
        if (btEndDate) applyParams.end_date = btEndDate
        const btRes = await fetch('/py-api/api/backtest/dynamic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, symbol: 'BTC/USDT', timeframe: tf, parameters: applyParams }) })
        if (!btRes.ok) { const err = await btRes.json().catch(() => ({ detail: btRes.statusText })); throw new Error(err.detail) }
        const result = await btRes.json()
        let fullCandles = candles
        if (fullCandles.length === 0) {
          try {
            const histRes = await fetch(`/py-api/api/candles/${tf}`)
            if (histRes.ok) {
              const hd = await histRes.json()
              if (hd.candles?.length > 0) { fullCandles = normalizeCandles(hd.candles); setCandles(fullCandles) }
            }
          } catch {}
        }
        processResult(result, fullCandles)
        const m = result.metrics as Record<string, number>
        setLogs(p => [...p, `✓ 最优参数回测完成 | 收益 ${(m.total_return_pct ?? 0) >= 0 ? '+' : ''}${(m.total_return_pct ?? 0).toFixed(2)}% | 回撤 ${(m.max_drawdown_pct ?? 0).toFixed(2)}%`])
      } catch (e: unknown) { setLogs(p => [...p, `✗ ${(e as Error).message}`]) }
      finally { setRunning(false) }
    })()
  }, [code, tf, candles, processResult, btStartDate, btEndDate])

  // 模板列表
  const [templates, setTemplates] = useState<{id:string;name:string;category:string}[]>([])
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/py-api/api/templates').then(r => r.ok ? r.json() : []).then(setTemplates).catch(() => {})
  }, [])

  const handleLoadTemplate = useCallback(async (id: string, name: string) => {
    try {
      const r = await fetch(`/py-api/api/templates/${id}/code`)
      if (!r.ok) return
      const d = await r.json()
      setCode(d.code)
      localStorage.setItem(LS_CODE_KEY, d.code)
      setStrategyName(name)
      localStorage.setItem(LS_NAME_KEY, name)
      setActiveTemplateId(id)
    } catch {}
  }, [])

  // 最新一根K线的OHLC
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null

  const S = {
    page: { background:'#131722', color:'#d1d4dc', fontFamily:"'Space Grotesk',system-ui,sans-serif", fontSize:13, display:'flex', flexDirection:'column' as const, overflowY:'auto' as const },
    layerHead: { height:36, display:'flex', alignItems:'center', padding:'0 12px', background:'#1e222d', borderBottom:'1px solid #363a45', flexShrink:0 as const },
    layerTitle: { fontSize:11, fontWeight:600, color:'#787b86', fontFamily:"'JetBrains Mono',monospace", letterSpacing:'.06em', textTransform:'uppercase' as const },
    ohlcItem: { fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'#787b86', whiteSpace:'nowrap' as const },
    ohlcVal: { color:'#d1d4dc', fontWeight:500 },
    tfBtn: (active: boolean) => ({ padding:'3px 8px', borderRadius:3, fontFamily:"'JetBrains Mono',monospace", fontSize:11, border:'none', cursor:'pointer' as const, color: active ? '#00d4ff' : '#787b86', background: active ? 'rgba(0,212,255,.1)' : 'transparent', fontWeight: active ? 600 : 400 }),
  }

  return (
    <div style={S.page}>

      {/* ══ 第一层：图表 ══ */}
      <div style={{ borderBottom:'1px solid #363a45' }}>
        <div style={S.layerHead}>
          {/* 交易对 */}
          <span style={{ fontWeight:700, fontSize:13, color:'#f7931a', marginRight:12, fontFamily:"'JetBrains Mono',monospace" }}>BTC/USDT</span>
          {/* OHLC */}
          {lastCandle && (
            <div style={{ display:'flex', gap:12, marginRight:12, borderRight:'1px solid #363a45', paddingRight:12 }}>
              <span style={S.ohlcItem}>开 <b style={S.ohlcVal}>{lastCandle.open?.toFixed(0)}</b></span>
              <span style={S.ohlcItem}>高 <b style={{ color:'#26a69a', fontWeight:500 }}>{lastCandle.high?.toFixed(0)}</b></span>
              <span style={S.ohlcItem}>低 <b style={{ color:'#ef5350', fontWeight:500 }}>{lastCandle.low?.toFixed(0)}</b></span>
            </div>
          )}
          {/* 时间框架 */}
          <div style={{ display:'flex', gap:1 }}>
            {(['1h','4h','1d'] as const).map(t => (
              <button key={t} onClick={() => setTf(t)} style={S.tfBtn(tf===t)}>{TF_LABELS[t]}</button>
            ))}
          </div>
          {/* 回测状态 */}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:8 }}>
            {running && (
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#00d4ff', display:'flex', alignItems:'center', gap:4 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:'#00d4ff', display:'inline-block', animation:'pulse 2s ease-in-out infinite' }} />
                回测运行中
              </span>
            )}
            {!running && summary && (
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, padding:'2px 8px', borderRadius:3, background:'rgba(38,166,154,.1)', color:'#26a69a', border:'1px solid rgba(38,166,154,.25)' }}>✓ 回测完成</span>
            )}
          </div>
        </div>
        <div style={{ height: s1Height, background:'#131722', overflow:'hidden' }}>
          {candles.length === 0
            ? <div style={{ height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#787b86', fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>K 线加载中...</div>
            : <MiniChart candles={candles} markers={markers} strategyLines={strategyLines} height={s1Height} />
          }
        </div>
      </div>

      {/* 拖拽高度调节把手 */}
      <div 
        onMouseDown={(e) => handleDragStart(e, setS1Height, s1Height)}
        style={{ height: 6, background: '#1e222d', cursor: 'row-resize', borderBottom: '1px solid #363a45', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
        onMouseLeave={e => e.currentTarget.style.background = '#1e222d'}
      >
        <div style={{ width: 40, height: 2, background: '#454a59', borderRadius: 2 }} />
      </div>

      {/* ══ 第二层：编辑器（左右分栏）══ */}
      <div style={{ borderBottom:'1px solid #363a45', display:'flex', height: s2Height }}>
        {/* 左侧：Monaco 编辑器 */}
        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', background:'#0d1117' }}>
          {/* 编辑器头部 */}
          <div style={{ height:36, display:'flex', alignItems:'center', padding:'0 12px', background:'#161b22', borderBottom:'1px solid #363a45', flexShrink:0, gap:8 }}>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'#787b86' }}>strategy.py</span>
            <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#26a69a', marginLeft:4 }}>● Python 3.11 · VectorBT</span>
            <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
              <button onClick={() => { if (confirm('重置为默认模板？')) { setCode(DEFAULT_CODE); localStorage.setItem(LS_CODE_KEY, DEFAULT_CODE); setActiveTemplateId(null) } }} style={{ fontSize:10, padding:'2px 8px', borderRadius:3, background:'transparent', border:'1px solid #363a45', color:'#787b86', cursor:'pointer' }}>重置</button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ fontSize:10, padding:'2px 10px', borderRadius:3, background: saveMsg.startsWith('✓') ? 'rgba(38,166,154,.15)' : 'rgba(0,212,255,.08)', border: saveMsg.startsWith('✓') ? '1px solid rgba(38,166,154,.4)' : '1px solid rgba(0,212,255,.25)', color: saveMsg.startsWith('✓') ? '#26a69a' : '#00d4ff', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1, fontWeight:600, transition:'.2s' }}
              >
                {saving ? '保存中…' : saveMsg || '保存策略'}
              </button>
            </div>
          </div>
          <div style={{ flex:1, minHeight:0 }}>
            <MonacoEditor height="100%" language="python" theme="vs-dark" value={code} onChange={handleCodeChange}
              options={{ minimap:{enabled:false}, fontSize:12, lineNumbers:'on', scrollBeyondLastLine:false, wordWrap:'on', padding:{top:8}, renderLineHighlight:'line', overviewRulerBorder:false }} />
          </div>
        </div>

        {/* 右侧：参数面板 240px */}
        <div style={{ width:240, flexShrink:0, borderLeft:'1px solid #363a45', background:'#1e222d', display:'flex', flexDirection:'column', padding:'14px 12px' }}>
          {/* 策略名 */}
          <input
            value={strategyName}
            onChange={handleNameChange}
            style={{ background:'rgba(0,212,255,.06)', border:'1px solid rgba(0,212,255,.18)', borderRadius:4, padding:'5px 8px', color:'#00d4ff', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:600, outline:'none', marginBottom:4, width:'100%' }}
          />
          {/* 元数据 */}
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#787b86', marginBottom:14 }}>
            BTC/USDT · {TF_LABELS[tf] ?? tf}
          </div>

          {/* 模板列表 */}
          <div style={{ fontSize:10, color:'#787b86', textTransform:'uppercase', letterSpacing:'.06em', fontFamily:"'JetBrains Mono',monospace", marginBottom:6 }}>内置模板</div>
          <div style={{ display:'flex', flexDirection:'column', gap:2, overflowY:'auto', maxHeight: 120 }}>
            {templates.map(t => {
              const isOn = activeTemplateId === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => handleLoadTemplate(t.id, t.name)}
                  style={{
                    padding: isOn ? '5px 7px' : '5px 9px',
                    borderRadius:4, fontSize:11, color: isOn ? '#00d4ff' : '#787b86',
                    background: isOn ? 'rgba(0,212,255,.08)' : 'transparent',
                    borderLeft: isOn ? '2px solid #00d4ff' : '2px solid transparent',
                    border: isOn ? undefined : 'none',
                    cursor:'pointer', fontFamily:"'JetBrains Mono',monospace",
                    textAlign:'left', transition:'.12s',
                  }}
                  onMouseEnter={e => { if (!isOn) { e.currentTarget.style.background='#2a2e39'; e.currentTarget.style.color='#d1d4dc' } }}
                  onMouseLeave={e => { if (!isOn) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color='#787b86' } }}
                >
                  {t.name}
                </button>
              )
            })}
          </div>

          {/* 我的策略 */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize:10, color:'#787b86', textTransform:'uppercase', letterSpacing:'.06em', fontFamily:"'JetBrains Mono',monospace", marginBottom:6, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span>我的策略</span>
              <span style={{ fontSize:9, color:'#454a59' }}>{myStrategies.length} 个</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:2, overflowY:'auto', flex:1 }}>
              {myStrategies.length === 0 ? (
                <div style={{ fontSize:10, color:'#454a59', fontFamily:"'JetBrains Mono',monospace", padding:'8px 4px', textAlign:'center' }}>
                  暂无保存的策略
                </div>
              ) : (
                myStrategies.map(s => {
                  const isActive = savedId === s.id
                  return (
                    <div key={s.id} style={{ display:'flex', alignItems:'center', gap:2 }}>
                      <button
                        onClick={() => handleLoadMyStrategy(s)}
                        disabled={loadingStrategies}
                        style={{
                          flex:1, padding: isActive ? '5px 7px' : '5px 9px',
                          borderRadius:4, fontSize:11,
                          color: isActive ? '#26a69a' : '#787b86',
                          background: isActive ? 'rgba(38,166,154,.08)' : 'transparent',
                          borderLeft: isActive ? '2px solid #26a69a' : '2px solid transparent',
                          border: isActive ? undefined : 'none',
                          cursor: loadingStrategies ? 'wait' : 'pointer',
                          fontFamily:"'JetBrains Mono',monospace",
                          textAlign:'left', transition:'.12s', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
                        }}
                        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background='#2a2e39'; e.currentTarget.style.color='#d1d4dc' } }}
                        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color=isActive ? '#26a69a' : '#787b86' } }}
                      >
                        {s.name}
                      </button>
                      <button
                        onClick={e => handleDeleteStrategy(s, e)}
                        title="删除"
                        style={{ flexShrink:0, width:18, height:18, display:'flex', alignItems:'center', justifyContent:'center', background:'none', border:'none', cursor:'pointer', color:'#454a59', fontSize:13, lineHeight:1, borderRadius:3, transition:'.12s' }}
                        onMouseEnter={e => { e.currentTarget.style.color='#ef5350'; e.currentTarget.style.background='rgba(239,83,80,.12)' }}
                        onMouseLeave={e => { e.currentTarget.style.color='#454a59'; e.currentTarget.style.background='none' }}
                      >×</button>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* 底部按钮 */}
          <div style={{ marginTop:12, display:'flex', flexDirection:'column', gap:6 }}>
            {/* 新建策略 */}
            <button
              onClick={handleNewStrategy}
              style={{ width:'100%', padding:'8px', background:'transparent', border:'1px solid #363a45', borderRadius:6, color:'#787b86', fontFamily:"'JetBrains Mono',monospace", fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, transition:'.2s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor='#00d4ff'; e.currentTarget.style.color='#d1d4dc' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor='#363a45'; e.currentTarget.style.color='#787b86' }}
            >
              + 新建策略
            </button>
            {/* 运行回测 */}
            <button
              onClick={handleRun}
              disabled={running}
              style={{ width:'100%', padding:'9px', background:'linear-gradient(135deg,rgba(0,212,255,.12),rgba(0,212,255,.04))', border:'1px solid rgba(0,212,255,.3)', borderRadius:6, color:'#00d4ff', fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:600, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.6 : 1, display:'flex', alignItems:'center', justifyContent:'center', gap:7, letterSpacing:'.04em', transition:'.2s' }}
              onMouseEnter={e => { if (!running) { e.currentTarget.style.background='rgba(0,212,255,.2)'; e.currentTarget.style.boxShadow='0 0 16px rgba(0,212,255,.15)' } }}
              onMouseLeave={e => { e.currentTarget.style.background='linear-gradient(135deg,rgba(0,212,255,.12),rgba(0,212,255,.04))'; e.currentTarget.style.boxShadow='none' }}
            >
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9"/></svg>
              {running ? '运行中…' : '运行回测'}
            </button>
          </div>
        </div>
      </div>

      {/* S2 底部拖拽把手 */}
      <div 
        onMouseDown={(e) => handleDragStart(e, setS2Height, s2Height)}
        style={{ height: 6, background: '#1e222d', cursor: 'row-resize', borderBottom: '1px solid #363a45', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
        onMouseLeave={e => e.currentTarget.style.background = '#1e222d'}
      >
        <div style={{ width: 40, height: 2, background: '#454a59', borderRadius: 2 }} />
      </div>

      {/* ══ 第三层：回测结果 ══ */}
      <div style={{ borderBottom:'1px solid #363a45', height: s3Height }}>
        <div style={S.layerHead}>
          <span style={S.layerTitle}>03 · 回测结果</span>
          {summary && (
            <div style={{ marginLeft:12, display:'flex', gap:16, fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>
              <span style={{ color: (summary.net_profit_pct ?? 0) >= 0 ? '#26a69a' : '#ef5350', fontWeight:600 }}>
                {(summary.net_profit_pct ?? 0) >= 0 ? '+' : ''}{(summary.net_profit_pct ?? 0).toFixed(2)}%
              </span>
              <span style={{ color:'#787b86' }}>回撤 <b style={{ color:'#ef5350' }}>{(summary.max_drawdown_pct ?? 0).toFixed(2)}%</b></span>
              <span style={{ color:'#787b86' }}>胜率 <b style={{ color:'#00d4ff' }}>{(summary.win_rate_pct ?? 0).toFixed(1)}%</b></span>
              <span style={{ color:'#787b86' }}>{summary.total_trades ?? 0} 笔</span>
              <button 
                onClick={() => {
                  const mcTrades = trades.map((t, i) => ({ id: i + 1, profitUSDT: t.pnl_abs }))
                  sessionStorage.setItem('mc_trades_cache', JSON.stringify(mcTrades))
                  window.open('/monte-carlo', '_blank')
                }}
                style={{ marginLeft: 8, background: 'rgba(0,212,255,0.1)', color: '#00d4ff', border: '1px solid rgba(0,212,255,0.3)', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, transition: '.2s' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.2)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,212,255,0.1)' }}
                title="将当前回测的交易明细发送到蒙特卡洛分析页面进行压力测试"
              >
                前往蒙特卡洛验证 🎲
              </button>
            </div>
          )}
          {/* S3 时间范围:留空=全量 */}
          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:6, fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#787b86' }}>
            <span>回测范围</span>
            <input
              type="date"
              value={btStartDate}
              onChange={e => setBtStartDate(e.target.value)}
              title="留空 = 从最早 K 线开始"
              style={{ background:'#1a1a1a', border:'1px solid #333', color:'#eee', fontSize:10, padding:'2px 6px', borderRadius:3, colorScheme:'dark' }}
            />
            <span>~</span>
            <input
              type="date"
              value={btEndDate}
              onChange={e => setBtEndDate(e.target.value)}
              title="留空 = 到最新 K 线"
              style={{ background:'#1a1a1a', border:'1px solid #333', color:'#eee', fontSize:10, padding:'2px 6px', borderRadius:3, colorScheme:'dark' }}
            />
            {(btStartDate || btEndDate) && (
              <button
                onClick={() => { setBtStartDate(''); setBtEndDate(''); }}
                title="清空,恢复全量历史"
                style={{ background:'transparent', border:'1px solid #444', color:'#787b86', fontSize:10, padding:'2px 6px', borderRadius:3, cursor:'pointer' }}
              >清空</button>
            )}
          </div>
        </div>
        <StrategyTesterPanel
          visible fixedPanel
          defaultTab="回测控制台"
          allowedTabs={['回测控制台','资金曲线','交易明细','下载报告']}
          summary={summary} trades={trades} equity={equity}
          xlsxDownloadUrl={xlsxToken ?? null}
          strategyName={strategyName} logs={logs} running={running}
          onOptimizeStart={handleOptimizeStart}
          optimizeStatus={optimizeStatus} optimizeEpochs={optimizeEpochs} optimizeError={optimizeError}
          optimizeProgress={optimizeProgress}
          onOptimizeCsvDownload={handleOptimizeCsvDownload} onApplyBestParams={handleApplyBestParams}
        />
      </div>

      {/* S3 底部拖拽把手 */}
      <div 
        onMouseDown={(e) => handleDragStart(e, setS3Height, s3Height)}
        style={{ height: 6, background: '#1e222d', cursor: 'row-resize', borderBottom: '1px solid #363a45', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
        onMouseLeave={e => e.currentTarget.style.background = '#1e222d'}
      >
        <div style={{ width: 40, height: 2, background: '#454a59', borderRadius: 2 }} />
      </div>

      {/* ══ 第四层：参数优化 ══ */}
      <div style={{ height: s4Height, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={S.layerHead}>
          <span style={S.layerTitle}>04 · 参数优化</span>
          <span style={{ marginLeft: 12, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#787b86' }}>
            · 当前策略: <span style={{ color: '#00d4ff', fontWeight: 600 }}>{strategyName || '未命名'}</span>
          </span>
          <div style={{ marginLeft:'auto' }}>
            <a href="/report" style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'#787b86', textDecoration:'none', display:'flex', alignItems:'center', gap:4, transition:'.15s' }}
              onMouseEnter={e => (e.currentTarget.style.color='#00d4ff')}
              onMouseLeave={e => (e.currentTarget.style.color='#787b86')}
            >
              完成后查看优化报告 →
            </a>
          </div>
        </div>
        <StrategyTesterPanel
          visible fixedPanel
          defaultTab="参数优化"
          allowedTabs={['参数优化']}
          summary={null} trades={[]} equity={[]}
          xlsxDownloadUrl={null} strategyName={strategyName}
          logs={[]} running={false} strategyCode={code}
          onOptimizeStart={handleOptimizeStart}
          optimizeStatus={optimizeStatus} optimizeEpochs={optimizeEpochs} optimizeError={optimizeError}
          optimizeProgress={optimizeProgress}
          onOptimizeCsvDownload={handleOptimizeCsvDownload} onApplyBestParams={handleApplyBestParams}
        />
      </div>

      {/* S4 底部拖拽把手 */}
      <div 
        onMouseDown={(e) => handleDragStart(e, setS4Height, s4Height)}
        style={{ height: 6, background: '#1e222d', cursor: 'row-resize', borderBottom: '1px solid #363a45', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={e => e.currentTarget.style.background = '#2a2e39'}
        onMouseLeave={e => e.currentTarget.style.background = '#1e222d'}
      >
        <div style={{ width: 40, height: 2, background: '#454a59', borderRadius: 2 }} />
      </div>

    </div>
  )
}






