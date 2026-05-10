'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import MiniChart, { type Candle, type ChartMarker, type StrategyLine } from '@/components/MiniChart'
import StrategyTesterPanel, { type BacktestSummary, type TradeRecord, type EpochRecord, type ParamRow } from '@/components/StrategyTesterPanel'

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
  const [loading, setLoading] = useState(true)

  // Backtest state
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<string[]>([])
  const [summary, setSummary] = useState<BacktestSummary | null>(null)
  const [trades, setTrades] = useState<TradeRecord[]>([])
  const [equity, setEquity] = useState<{time:number;equity:number}[]>([])
  const [markers, setMarkers] = useState<ChartMarker[]>([])
  const [strategyLines, setStrategyLines] = useState<StrategyLine[]>([])
  const [csvToken, setCsvToken] = useState<string | null>(null)
  const [testerVisible, setTesterVisible] = useState(true)

  // Optimize state
  const [optimizeStatus, setOptimizeStatus] = useState<'idle'|'running'|'completed'|'failed'>('idle')
  const [optimizeEpochs, setOptimizeEpochs] = useState<EpochRecord[]>([])
  const [optimizeError, setOptimizeError] = useState('')

  // Load saved code
  useEffect(() => {
    const saved = localStorage.getItem(LS_CODE_KEY)
    setCode(saved || DEFAULT_CODE)
    const savedName = localStorage.getItem(LS_NAME_KEY)
    if (savedName) setStrategyName(savedName)
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

  // Load candles
  useEffect(() => {
    setLoading(true)
    fetch(`/api/chart/klines?interval=${tf}&limit=300&market=swap`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (d.candles?.length) setCandles(d.candles) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [tf])

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
    setCsvToken(result.csv_token ? `dynamic/${result.csv_token}` : null)

    const rawTrades = (result.trades ?? []) as Record<string, unknown>[]
    const parsedTrades: TradeRecord[] = rawTrades.map(t => ({
      entry_time: parseToSec(t['Entry Timestamp'] ?? t.open_timestamp ?? t.open_date),
      exit_time: parseToSec(t['Exit Timestamp'] ?? t.close_timestamp ?? t.close_date) || undefined,
      pair: 'BTC/USDT',
      direction: ((t['Direction'] === 'Short' || t.is_short) ? 'short' : 'long') as 'long' | 'short',
      entry_price: Number(t['Avg Entry Price'] ?? t['Entry Price'] ?? t.open_rate ?? 0),
      exit_price: Number(t['Avg Exit Price'] ?? t['Exit Price'] ?? t.close_rate ?? 0),
      pnl_pct: Number(t['Return'] ?? t.profit_ratio ?? 0),
      pnl_abs: Number(t['PnL'] ?? t.profit_abs ?? 0),
    }))
    setTrades(parsedTrades)
    setEquity((result.equity ?? []) as {time:number;equity:number}[])

    // Markers
    const sortedTimes = [...fullCandles].sort((a, b) => a.time - b.time).map(c => c.time)
    const mkrs: ChartMarker[] = []
    parsedTrades.forEach(t => {
      if (t.entry_time) mkrs.push({ time: snapToCandle(t.entry_time, sortedTimes), position: 'belowBar', color: '#26a69a', shape: 'arrowUp', text: 'B' })
      if (t.exit_time) mkrs.push({ time: snapToCandle(t.exit_time, sortedTimes), position: 'aboveBar', color: t.pnl_pct >= 0 ? '#26a69a' : '#ef5350', shape: 'arrowDown', text: 'S' })
    })
    setTimeout(() => setMarkers(mkrs), 100)

    // Indicator lines
    const indics = (result.indicators ?? {}) as Record<string, {time:number;value:number}[]>
    setStrategyLines(Object.entries(indics).filter(([, pts]) => Array.isArray(pts) && pts.length > 0).map(([name, pts], idx) => ({ label: name, color: INDICATOR_COLORS[idx % INDICATOR_COLORS.length], points: pts })))
  }, [snapToCandle])

  // Run backtest
  const handleRun = useCallback(async () => {
    if (!code.trim() || running) return
    setRunning(true); setLogs([]); setSummary(null); setTrades([]); setEquity([]); setMarkers([]); setStrategyLines([]); setTesterVisible(true)
    setLogs([`▶ ${strategyName} · ${tf} · 全量历史数据`])
    try {
      const btRes = await fetch('/py-api/api/backtest/dynamic', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, symbol: 'BTC/USDT', timeframe: tf, parameters: { initial_capital: 10000 } }),
      })
      if (!btRes.ok) { const err = await btRes.json().catch(() => ({ detail: btRes.statusText })); throw new Error(`回测失败 (${btRes.status}): ${err.detail ?? '未知错误'}`) }
      const result = await btRes.json()

      // Load full history candles
      setLogs(p => [...p, '📊 加载完整历史 K 线...'])
      let fullCandles = candles
      try {
        const histRes = await fetch(`/py-api/api/candles/${tf}`)
        if (histRes.ok) { const hd = await histRes.json(); if (hd.candles?.length > 0) { fullCandles = hd.candles; setCandles(fullCandles); setLogs(p => [...p, `✓ 已加载 ${fullCandles.length} 根历史 K 线`]) } }
      } catch {}

      processResult(result, fullCandles)
      const m = result.metrics as Record<string, number>
      const npct = m.total_return_pct ?? 0
      setLogs(p => [...p, `✓ ${strategyName} 回测完成`, `净收益 ${npct >= 0 ? '+' : ''}${npct.toFixed(2)}% | 回撤 ${(m.max_drawdown_pct ?? 0).toFixed(2)}% | 胜率 ${(m.win_rate_pct ?? 0).toFixed(1)}% | ${m.total_trades ?? 0} 笔`])
    } catch (e: unknown) {
      setLogs(p => [...p, `✗ ${(e as Error).message}`])
    } finally { setRunning(false) }
  }, [code, tf, strategyName, candles, running, processResult])

  // Optimize
  const handleOptimizeStart = useCallback(async (paramRows: ParamRow[], _timerange: string) => {
    if (!code.trim()) return
    setOptimizeStatus('running'); setOptimizeEpochs([]); setOptimizeError('')
    try {
      const grid: Record<string, { start: number; stop: number; step: number }> = {}
      for (const r of paramRows) { if (r.name.trim() && r.step > 0) grid[r.name.trim()] = { start: r.start, stop: r.stop, step: r.step } }
      if (!Object.keys(grid).length) throw new Error('请至少添加一个参数网格行')
      const apiUrl = window.location.hostname === 'localhost' ? 'http://localhost:8000/api/optimize' : '/py-api/api/optimize'
      const res = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, symbol: 'BTC/USDT', timeframe: tf, grid }) })
      if (!res.ok) { const err = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(err.detail ?? '调参失败') }
      const data = await res.json()
      const epochs = (data.results ?? []).filter((r: Record<string, unknown>) => r.status === 'ok').map((r: Record<string, unknown>, i: number) => ({
        epoch: i + 1, total_epochs: data.total_combinations, profit_pct: Number(r.net_profit_pct) ?? 0, drawdown_pct: Number(r.max_drawdown_pct) ?? 0, trades: Number(r.total_trades) ?? 0, win_rate_pct: Number(r.win_rate_pct) ?? 0, params: r.parameters as Record<string, string>,
      }))
      setOptimizeEpochs(epochs); setOptimizeStatus('completed')
      // Save to localStorage for report page
      try { localStorage.setItem('optimize_epochs', JSON.stringify(epochs)); localStorage.setItem('optimize_strategy_name', strategyName); localStorage.setItem('optimize_timeframe', tf) } catch {}
    } catch (e: unknown) { setOptimizeError((e as Error).message); setOptimizeStatus('failed') }
  }, [code, tf])

  const handleOptimizeCsvDownload = useCallback(async () => {
    try { const r = await fetch('/py-api/api/optimize/export-csv'); if (!r.ok) throw new Error('CSV 导出失败'); const blob = await r.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'optimization.csv'; a.click(); URL.revokeObjectURL(url) } catch (e) { alert((e as Error).message) }
  }, [])

  const handleApplyBestParams = useCallback((params: Record<string, string>) => {
    setLogs([`▶ 应用最优参数: ${Object.entries(params).map(([k,v]) => `${k}=${v}`).join(', ')}`])
    setRunning(true); setSummary(null); setTrades([]); setEquity([]); setMarkers([]); setStrategyLines([])
    ;(async () => {
      try {
        const parsedParams: Record<string, number|string> = {}
        for (const [k, v] of Object.entries(params)) { const n = Number(v); parsedParams[k] = isNaN(n) ? v : n }
        const btRes = await fetch('/py-api/api/backtest/dynamic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, symbol: 'BTC/USDT', timeframe: tf, parameters: { ...parsedParams, initial_capital: 10000 } }) })
        if (!btRes.ok) { const err = await btRes.json().catch(() => ({ detail: btRes.statusText })); throw new Error(err.detail) }
        const result = await btRes.json()
        let fullCandles = candles
        try { const histRes = await fetch(`/py-api/api/candles/${tf}`); if (histRes.ok) { const hd = await histRes.json(); if (hd.candles?.length > 0) { fullCandles = hd.candles; setCandles(fullCandles) } } } catch {}
        processResult(result, fullCandles)
        const m = result.metrics as Record<string, number>
        setLogs(p => [...p, `✓ 最优参数回测完成 | 收益 ${(m.total_return_pct ?? 0) >= 0 ? '+' : ''}${(m.total_return_pct ?? 0).toFixed(2)}% | 回撤 ${(m.max_drawdown_pct ?? 0).toFixed(2)}%`])
      } catch (e: unknown) { setLogs(p => [...p, `✗ ${(e as Error).message}`]) }
      finally { setRunning(false) }
    })()
  }, [code, tf, candles, processResult])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'var(--page-content-h)', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>✏️</span>
          <input
            value={strategyName}
            onChange={handleNameChange}
            onFocus={e => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 2px var(--accent-soft)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none' }}
            style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', color: 'var(--text)', fontSize: 14, fontWeight: 600, width: 160, outline: 'none', transition: 'border-color .15s, box-shadow .15s' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {['1h', '4h', '1d'].map(t => (
            <button key={t} className={`tf-btn${tf === t ? ' active' : ''}`} onClick={() => setTf(t)}>{TF_LABELS[t]}</button>
          ))}
        </div>
        <button onClick={handleRun} disabled={running} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 20px', borderRadius: 7, fontSize: 13, fontWeight: 700, border: 'none', cursor: running ? 'not-allowed' : 'pointer', background: running ? 'rgba(38,166,154,0.3)' : 'var(--up)', color: '#fff', opacity: running ? 0.8 : 1, boxShadow: '0 2px 12px rgba(38,166,154,0.3)', transition: 'all 0.15s' }}>
          {running ? <><span className="spinner" />运行中…</> : '▶ 运行回测'}
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>BTC/USDT · 永续 · {TF_LABELS[tf]} · VectorBT</span>
      </div>

      {/* Main area: editor + chart */}
      <div style={{ display: 'flex', flex: 1, gap: 0, overflow: 'hidden', border: '1px solid var(--border)', borderRadius: 8 }}>
        {/* Left: Monaco editor */}
        <div style={{ width: '50%', minWidth: 300, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', letterSpacing: '0.05em' }}>PYTHON · VECTORBT</span>
            <button onClick={() => { if (confirm('重置为默认模板？')) { setCode(DEFAULT_CODE); localStorage.setItem(LS_CODE_KEY, DEFAULT_CODE) } }} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', cursor: 'pointer' }}>重置模板</button>
          </div>
          <div style={{ flex: 1 }}>
            <MonacoEditor height="100%" language="python" theme="vs-dark" value={code} onChange={handleCodeChange} options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 12 }, renderLineHighlight: 'line' }} />
          </div>
        </div>

        {/* Right: chart */}
        <div style={{ flex: 1, minWidth: 300, overflow: 'hidden', background: 'var(--bg)' }}>
          {loading && candles.length === 0 ? (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)', fontSize: 13 }}>K线加载中...</div>
          ) : (
            <MiniChart candles={candles} markers={markers} strategyLines={strategyLines} height={340} />
          )}
        </div>
      </div>

      {/* Bottom: StrategyTesterPanel */}
      <StrategyTesterPanel
        visible={testerVisible}
        onClose={() => setTesterVisible(false)}
        summary={summary}
        trades={trades}
        equity={equity}
        csvDownloadUrl={csvToken ? `/py-api/api/backtest/${csvToken}/csv` : null}
        strategyName={strategyName}
        logs={logs}
        running={running}
        activeStrategyId="custom"
        onOptimizeStart={handleOptimizeStart}
        optimizeStatus={optimizeStatus}
        optimizeEpochs={optimizeEpochs}
        optimizeError={optimizeError}
        onOptimizeCsvDownload={handleOptimizeCsvDownload}
        onApplyBestParams={handleApplyBestParams}
      />
      {!testerVisible && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '6px 12px' }}>
          <button onClick={() => setTesterVisible(true)} style={{ fontSize: 11, padding: '3px 12px', borderRadius: 4, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-mute)', cursor: 'pointer' }}>▲ Strategy Tester</button>
        </div>
      )}
    </div>
  )
}
