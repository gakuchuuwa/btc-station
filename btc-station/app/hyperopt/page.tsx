'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ensureHistoricalData, type HistoryProgress } from '@/lib/data/history'
import { runBacktest, type BacktestConfig, type BacktestResult } from '@/lib/backtest/engine'
import { runOptimizer, type OptimizerResultRow } from '@/lib/backtest/optimizer'
import { getStrategy, strategies } from '@/lib/strategies'
import type { StrategyParams } from '@/lib/strategies/types'

const INITIAL_CONFIG: BacktestConfig = {
  market: 'spot',
  leverage: 1,
  initial_capital: 10_000,
  position_sizing: 'all_in',
  position_value: 100,
  fee_pct: 0.1,
  slippage_pct: 0.05,
}

const inputStyle: React.CSSProperties = {
  width: '100%', height: 38, padding: '0 10px', borderRadius: 6,
  border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)',
  fontSize: 13,
}

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value)
}

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export default function HyperoptPage() {
  const [strategyId, setStrategyId] = useState(strategies[0]?.id ?? '')
  const [timeframe, setTimeframe] = useState('1d')
  const [lookbackYears, setLookbackYears] = useState(1)
  const [config, setConfig] = useState<BacktestConfig>(INITIAL_CONFIG)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<HistoryProgress>({ percent: 0, message: '等待运行' })
  const [rows, setRows] = useState<OptimizerResultRow[]>([])
  const [bestParams, setBestParams] = useState<StrategyParams | null>(null)
  const [bestResult, setBestResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState('')

  const strategy = useMemo(() => getStrategy(strategyId), [strategyId])
  const rankedRows = useMemo(
    () => [...rows].sort((a, b) => b.sharpe_ratio - a.sharpe_ratio || b.total_pnl_pct - a.total_pnl_pct),
    [rows],
  )

  async function runSearch() {
    if (!strategy) return
    setRunning(true)
    setError('')
    setRows([])
    setBestParams(null)
    setBestResult(null)
    setProgress({ percent: 0, message: '读取公开历史 K 线…' })

    try {
      const candles = await ensureHistoricalData('spot', timeframe, lookbackYears, setProgress)
      if (candles.length === 0) throw new Error('没有获取到历史 K 线，请稍后重试。')

      setProgress({ percent: 0, message: `在本地 Worker 中扫描 ${strategy.name} 参数…` })
      const completed = await runOptimizer(strategy.id, candles, config, update => {
        setProgress({ percent: update.progress, message: `本地回测参数组合 ${update.progress}%` })
      })
      const chosenParams = completed.bestParams
      const finalResult = await runBacktest(candles, strategy.generateSignals(candles, chosenParams), config)

      setRows(completed.results)
      setBestParams(chosenParams)
      setBestResult(finalResult)
      setProgress({ percent: 100, message: `完成：${completed.results.length} 组参数` })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '参数搜索失败，请稍后重试。')
      setProgress({ percent: 0, message: '搜索未完成' })
    } finally {
      setRunning(false)
    }
  }

  function exportCsv() {
    if (!rows.length || !strategy) return
    const paramKeys = Object.keys(strategy.paramSchema)
    const headers = [
      'Initial Capital', 'Net Profit', 'Net Profit %', 'Max Drawdown %',
      'Total Trades', 'Win Rate', 'Sharpe Ratio', 'Sortino Ratio', 'Profit Factor',
      '__from_grid_search', ...paramKeys.map(key => `__${key}`),
    ]
    const lines = [headers.map(csvCell).join(',')]
    for (const row of rows) {
      const values: unknown[] = [
        config.initial_capital, row.total_pnl, row.total_pnl_pct, row.max_drawdown_pct,
        row.total_trades, row.win_rate, row.sharpe_ratio, 0, row.profit_factor,
        1, ...paramKeys.map(key => row.params[key]),
      ]
      lines.push(values.map(csvCell).join(','))
    }
    const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${strategy.id}-${timeframe}-${lookbackYears}y-optimization.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const cardStyle: React.CSSProperties = {
    padding: 18, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)',
  }
  const paramText = (params: StrategyParams | null) => {
    if (!params || !strategy) return '—'
    return Object.entries(params)
      .map(([key, value]) => `${strategy.paramSchema[key]?.label ?? key}: ${value}`)
      .join(' · ')
  }

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 20px 60px' }}>
      <header style={{ marginBottom: 22 }}>
        <div style={{ color: 'var(--accent)', fontSize: 11, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          Browser-based parameter search
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' }}>本地参数搜索</h1>
        <p style={{ margin: 0, maxWidth: 780, color: 'var(--text-mute)', fontSize: 13, lineHeight: 1.8 }}>
          通过浏览器 Web Worker 遍历内置策略的参数组合，并调用本地 TypeScript 回测引擎评分。K 线由本站 API 从 OKX 公共接口获取；计算不经过 Python 服务。
        </p>
      </header>

      <div style={{ ...cardStyle, marginBottom: 16, color: 'var(--text-mute)', fontSize: 12, lineHeight: 1.7 }}>
        参数搜索使用同一段历史数据做筛选，存在样本内过拟合风险。结果仅供研究，不构成投资建议；当前仅模拟现货做多，不执行真实订单。
      </div>

      <section style={{ ...cardStyle, marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
          <label style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            策略
            <select value={strategyId} onChange={event => setStrategyId(event.target.value)} style={{ ...inputStyle, display: 'block', marginTop: 6 }} disabled={running}>
              {strategies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            K 线周期
            <select value={timeframe} onChange={event => setTimeframe(event.target.value)} style={{ ...inputStyle, display: 'block', marginTop: 6 }} disabled={running}>
              <option value="1d">日线</option><option value="4h">4 小时</option><option value="1h">1 小时</option>
            </select>
          </label>
          <label style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            历史区间
            <select value={lookbackYears} onChange={event => setLookbackYears(Number(event.target.value))} style={{ ...inputStyle, display: 'block', marginTop: 6 }} disabled={running}>
              <option value={1}>近 1 年</option><option value={3}>近 3 年</option><option value={5}>近 5 年</option>
            </select>
          </label>
          <label style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            初始资金 (USDT)
            <input type="number" min={1} value={config.initial_capital} onChange={event => setConfig(current => ({ ...current, initial_capital: Number(event.target.value) }))} style={{ ...inputStyle, display: 'block', marginTop: 6 }} disabled={running} />
          </label>
          <label style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            手续费 (%)
            <input type="number" min={0} max={99} step={0.01} value={config.fee_pct} onChange={event => setConfig(current => ({ ...current, fee_pct: Number(event.target.value) }))} style={{ ...inputStyle, display: 'block', marginTop: 6 }} disabled={running} />
          </label>
          <label style={{ color: 'var(--text-mute)', fontSize: 12 }}>
            滑点 (%)
            <input type="number" min={0} max={99} step={0.01} value={config.slippage_pct} onChange={event => setConfig(current => ({ ...current, slippage_pct: Number(event.target.value) }))} style={{ ...inputStyle, display: 'block', marginTop: 6 }} disabled={running} />
          </label>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 18 }}>
          <button onClick={runSearch} disabled={running || !strategy} className="btn btn-primary" style={{ minWidth: 150, height: 38, opacity: running ? .65 : 1 }}>
            {running ? '搜索中…' : '运行本地搜索'}
          </button>
          <span style={{ color: 'var(--text-mute)', fontSize: 12 }}>{progress.message}</span>
          {rows.length > 0 && <button onClick={exportCsv} className="btn btn-ghost" style={{ height: 36 }}>导出全部结果 CSV</button>}
        </div>
        {(running || progress.percent > 0) && (
          <div style={{ height: 5, borderRadius: 4, overflow: 'hidden', marginTop: 12, background: 'rgba(255,255,255,.06)' }}>
            <div style={{ width: `${Math.max(0, Math.min(progress.percent, 100))}%`, height: '100%', background: 'var(--accent)', transition: 'width .2s' }} />
          </div>
        )}
        {error && <p role="alert" style={{ margin: '12px 0 0', color: 'var(--down)', fontSize: 12 }}>{error}</p>}
      </section>

      {bestResult && (
        <section style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'end', marginBottom: 10 }}>
            <div>
              <h2 style={{ fontSize: 17, color: 'var(--text)', margin: '0 0 5px' }}>当前最优组合</h2>
              <p style={{ color: 'var(--text-mute)', fontSize: 12, margin: 0 }}>{paramText(bestParams)}</p>
            </div>
            <Link href="/report" className="btn btn-ghost" style={{ height: 34 }}>用 CSV 做稳健性分析 →</Link>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {[
              { label: '总收益', value: `${bestResult.metrics.total_pnl_pct >= 0 ? '+' : ''}${bestResult.metrics.total_pnl_pct.toFixed(2)}%`, good: bestResult.metrics.total_pnl_pct >= 0 },
              { label: '净盈亏', value: money(bestResult.metrics.total_pnl) },
              { label: '最大回撤', value: `${bestResult.metrics.max_drawdown_pct.toFixed(2)}%` },
              { label: '交易笔数', value: String(bestResult.metrics.total_trades) },
              { label: '胜率', value: `${bestResult.metrics.win_rate.toFixed(1)}%` },
              { label: '夏普', value: bestResult.metrics.sharpe_ratio.toFixed(2) },
            ].map(item => (
              <div key={item.label} style={{ ...cardStyle, padding: 14 }}>
                <div style={{ color: 'var(--text-mute)', fontSize: 11, marginBottom: 6 }}>{item.label}</div>
                <div style={{ color: 'good' in item ? (item.good ? 'var(--up)' : 'var(--down)') : 'var(--text)', fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{item.value}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {rankedRows.length > 0 && strategy && (
        <section style={cardStyle}>
          <h2 style={{ color: 'var(--text)', fontSize: 16, margin: '0 0 4px' }}>参数排名</h2>
          <p style={{ color: 'var(--text-mute)', fontSize: 11, margin: '0 0 12px' }}>按年化夏普排序，夏普相同时按净收益排序；表格显示前 20 组，CSV 可导出全部 {rows.length} 组。</p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760, fontSize: 12 }}>
              <thead>
                <tr style={{ color: 'var(--text-mute)', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '9px 8px', textAlign: 'left' }}># / 参数</th>
                  <th style={{ padding: '9px 8px' }}>净收益</th>
                  <th style={{ padding: '9px 8px' }}>最大回撤</th>
                  <th style={{ padding: '9px 8px' }}>交易数</th>
                  <th style={{ padding: '9px 8px' }}>胜率</th>
                  <th style={{ padding: '9px 8px' }}>夏普</th>
                  <th style={{ padding: '9px 8px' }}>盈利因子</th>
                </tr>
              </thead>
              <tbody>
                {rankedRows.slice(0, 20).map((row, index) => (
                  <tr key={`${index}-${JSON.stringify(row.params)}`} style={{ borderBottom: '1px solid var(--border)', textAlign: 'right' }}>
                    <td style={{ padding: '9px 8px', textAlign: 'left', color: 'var(--text)' }}>
                      <span style={{ color: 'var(--accent)', marginRight: 8 }}>{index + 1}.</span>
                      {Object.entries(row.params).map(([key, value]) => `${strategy.paramSchema[key]?.label ?? key} ${value}`).join(' · ')}
                    </td>
                    <td style={{ padding: '9px 8px', color: row.total_pnl_pct >= 0 ? 'var(--up)' : 'var(--down)' }}>{row.total_pnl_pct >= 0 ? '+' : ''}{row.total_pnl_pct.toFixed(2)}%</td>
                    <td style={{ padding: '9px 8px', color: 'var(--text)' }}>{row.max_drawdown_pct.toFixed(2)}%</td>
                    <td style={{ padding: '9px 8px', color: 'var(--text)' }}>{row.total_trades}</td>
                    <td style={{ padding: '9px 8px', color: 'var(--text)' }}>{row.win_rate.toFixed(1)}%</td>
                    <td style={{ padding: '9px 8px', color: 'var(--text)' }}>{row.sharpe_ratio.toFixed(2)}</td>
                    <td style={{ padding: '9px 8px', color: 'var(--text)' }}>{row.profit_factor.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
        <Link href="/strategies" className="btn btn-ghost">返回本地策略</Link>
        <Link href="/chart" className="btn btn-ghost">查看 K 线图表</Link>
      </div>
    </div>
  )
}
