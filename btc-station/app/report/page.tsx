'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import {
  parseCSV, processRawData, applyFilters, scoreRows, computePareto, computeRobustness, epochsToRawRows,
  DEFAULT_FILTERS, DEFAULT_WEIGHTS,
  type RawRow, type Filters, type ScoreWeights,
} from '@/lib/robustness'

function fmt(n: number | null | undefined, d = 2) { return n == null || isNaN(n) ? '—' : n.toFixed(d) }

// ── Robustness bar ──
function RobBar({ score, total, stable }: { score: number; total: number; stable: number }) {
  const pct = Math.round(score * 100)
  const color = pct >= 70 ? 'var(--up)' : pct >= 40 ? 'var(--gold)' : 'var(--down)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color, minWidth: 28 }}>{pct}%</span>
      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{stable}/{total}</span>
    </div>
  )
}

// ── StatCard ──
function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={{ padding: '12px 16px', borderRight: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 4, letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace', color: color || 'var(--text)' }}>{value}</div>
    </div>
  )
}

// Filter out internal markers from strategy params
function userParams(params: Record<string, number | boolean | string>) {
  const skip = new Set(['from_grid_search'])
  const out: Record<string, number | boolean | string> = {}
  for (const [k, v] of Object.entries(params)) { if (!skip.has(k)) out[k] = v }
  return out
}

// ── Scatter Plot (Return vs Drawdown) ──
function ScatterPlot({ data, ranked }: { data: { returnPct: number; ddPct: number; passed: boolean; originalIndex: number }[]; ranked: { originalIndex: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const rankedSet = useMemo(() => new Set(ranked.slice(0, 3).map(r => r.originalIndex)), [ranked])

  const draw = useCallback((canvas: HTMLCanvasElement, width: number) => {
    if (data.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const H = 260
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = H * dpr
    canvas.style.width = width + 'px'
    canvas.style.height = H + 'px'
    ctx.scale(dpr, dpr)
    const W = width
    const pad = { top: 20, right: 20, bottom: 32, left: 50 }
    const pw = W - pad.left - pad.right, ph = H - pad.top - pad.bottom

    // Ranges
    const rets = data.map(d => d.returnPct), dds = data.map(d => d.ddPct)
    const minR = Math.min(0, ...rets), maxR = Math.max(...rets) * 1.1
    const minD = 0, maxD = Math.max(...dds) * 1.1
    const scaleX = (v: number) => pad.left + ((v - minD) / (maxD - minD || 1)) * pw
    const scaleY = (v: number) => pad.top + ph - ((v - minR) / (maxR - minR || 1)) * ph

    ctx.clearRect(0, 0, W, H)

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (ph / 4) * i; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
      const x = pad.left + (pw / 4) * i; ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ph); ctx.stroke()
    }

    // Axis labels
    ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '10px monospace'; ctx.textAlign = 'center'
    ctx.fillText('回撤 %', pad.left + pw / 2, H - 4)
    ctx.save(); ctx.translate(12, pad.top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('收益 %', 0, 0); ctx.restore()

    // Ticks
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    for (let i = 0; i <= 4; i++) {
      const v = minR + ((maxR - minR) / 4) * (4 - i)
      ctx.fillText(v.toFixed(0), pad.left - 6, pad.top + (ph / 4) * i)
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    for (let i = 0; i <= 4; i++) {
      const v = minD + ((maxD - minD) / 4) * i
      ctx.fillText(v.toFixed(0), pad.left + (pw / 4) * i, pad.top + ph + 4)
    }

    // Points
    data.forEach(d => {
      const x = scaleX(d.ddPct), y = scaleY(d.returnPct)
      const isTop3 = rankedSet.has(d.originalIndex)
      ctx.beginPath(); ctx.arc(x, y, isTop3 ? 6 : 4, 0, Math.PI * 2)
      if (isTop3) { ctx.fillStyle = '#FFD700'; ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 2; ctx.fill(); ctx.stroke() }
      else if (d.passed) { ctx.fillStyle = 'rgba(38,166,154,0.7)'; ctx.fill() }
      else { ctx.fillStyle = 'rgba(239,83,80,0.4)'; ctx.fill() }
    })

    // Legend
    const lg = [['通过', 'rgba(38,166,154,0.7)'], ['未通过', 'rgba(239,83,80,0.4)'], ['Top 3', '#FFD700']] as const
    lg.forEach(([label, color], i) => {
      const lx = W - pad.right - 140 + i * 50
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(lx, pad.top + 6, 4, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.font = '9px sans-serif'; ctx.fillText(label, lx + 7, pad.top + 6)
    })
  }, [data, rankedSet])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width
      if (w > 0) draw(canvas, w)
    })
    ro.observe(container)
    draw(canvas, container.offsetWidth || 560)
    return () => ro.disconnect()
  }, [draw])

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 6 }} />
    </div>
  )
}

export default function ReportPage() {
  const [rawData, setRawData] = useState<RawRow[]>([])
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [weights, setWeights] = useState<ScoreWeights>(DEFAULT_WEIGHTS)
  const [robustnessWeight, setRobustnessWeight] = useState(0.40)
  const [robustness, setRobustness] = useState<Record<number, { robustnessScore: number; totalNeighbors: number; stableNeighbors: number; passedNeighbors: number }>>({})
  const [robProg, setRobProg] = useState(0)
  const [source, setSource] = useState<'none' | 'localStorage' | 'csv'>('none')
  const [stratName, setStratName] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const abortRef = useRef<(() => void) | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-load from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('optimize_epochs')
      if (saved) {
        const epochs = JSON.parse(saved)
        if (Array.isArray(epochs) && epochs.length > 0) {
          setRawData(epochsToRawRows(epochs))
          setSource('localStorage')
          setStratName(localStorage.getItem('optimize_strategy_name') || '策略')
        }
      }
    } catch {}
  }, [])

  // Process pipeline
  const processed = useMemo(() => processRawData(rawData), [rawData])
  const deduplicated = useMemo(() => {
    const seen = new Set<string>()
    return processed.filter(row => {
      const key = [row.netProfit?.toFixed(2), row.ddPct?.toFixed(2), row.totalTrades, row.profitFactor?.toFixed(3)].join('|')
      if (seen.has(key)) return false; seen.add(key); return true
    })
  }, [processed])
  const filtered = useMemo(() => applyFilters(deduplicated, filters), [deduplicated, filters])
  const scored = useMemo(() => scoreRows(filtered, weights), [filtered, weights])
  const passedRows = useMemo(() => scored.filter(r => r.passed), [scored])
  const paretoSet = useMemo(() => computePareto(passedRows), [passedRows])

  // Run robustness
  useEffect(() => {
    if (abortRef.current) abortRef.current()
    if (deduplicated.length < 2) { setRobustness({}); setRobProg(0); return }
    setRobProg(1)
    const passedIndices = new Set(filtered.filter(r => r.passed).map(r => r.originalIndex))
    abortRef.current = computeRobustness(deduplicated, passedIndices, setRobProg, setRobustness)
    return () => { if (abortRef.current) abortRef.current() }
  }, [deduplicated, filtered])

  // Auto robustness weight
  const paramDims = useMemo(() => {
    const params = userParams(deduplicated[0]?.strategyParams || {})
    return Object.keys(params).length
  }, [deduplicated])

  useEffect(() => {
    setRobustnessWeight(paramDims <= 1 ? 0 : paramDims === 2 ? 0.15 : paramDims <= 4 ? 0.25 : 0.40)
  }, [paramDims])

  // Final ranking
  const ranked = useMemo(() => {
    return scored.filter(r => r.passed).map((row, i) => {
      const rb = robustness[row.originalIndex] || { robustnessScore: 0, totalNeighbors: 0, stableNeighbors: 0, passedNeighbors: 0 }
      const mult = (1 - robustnessWeight) + robustnessWeight * rb.robustnessScore
      const combined = row.utilityScore > 0 ? row.utilityScore * mult : row.utilityScore
      return { ...row, ...rb, combinedScore: combined, isPareto: paretoSet.has(i) }
    }).sort((a, b) => b.combinedScore - a.combinedScore)
  }, [scored, robustness, robustnessWeight, paretoSet])

  const top10 = ranked.slice(0, 10)
  const stats = {
    total: rawData.length,
    dedup: deduplicated.length,
    passed: passedRows.length,
    pareto: paretoSet.size,
    maxReturn: passedRows.length > 0 ? Math.max(...passedRows.map(r => r.returnPct)) : 0,
  }

  const handleCSV = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target?.result as string)
      if (parsed.length > 0) { setRawData(parsed); setSource('csv'); setStratName(file.name.replace('.csv', '')) }
    }
    reader.readAsText(file)
  }

  const thS: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: 'var(--text-mute)', borderBottom: '1px solid var(--border)', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', background: 'var(--bg)', position: 'sticky', top: 0 }

  const filterInputs = [
    { key: 'minTrades' as const, label: '最小交易次数', step: 1 },
    { key: 'minProfitFactor' as const, label: '最小盈利因子', step: 0.1 },
    { key: 'maxSingleLossPct' as const, label: '最大单笔亏损%', step: 1 },
    { key: 'maxDrawdown' as const, label: '最大回撤%', step: 1 },
    { key: 'minSharpe' as const, label: '最小夏普', step: 0.05 },
    { key: 'minSortino' as const, label: '最小索提诺', step: 0.1 },
    { key: 'minWinRate' as const, label: '最小胜率%', step: 1 },
    { key: 'minWinLossRatio' as const, label: '最小盈亏比', step: 0.1 },
  ]

  return (
    <div style={{ padding: '16px 0', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>📊 稳健性分析报告</h1>
          <p style={{ fontSize: 12, color: 'var(--text-mute)', marginTop: 4 }}>基于单步邻居法的参数稳健性评估 · 避开孤峰陷阱 · 锁定参数高原</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowFilters(!showFilters)} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: showFilters ? 'rgba(38,166,154,0.1)' : 'transparent', color: showFilters ? 'var(--up)' : 'var(--text-mute)', cursor: 'pointer' }}>
            ⚙ 过滤设置
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ padding: '6px 14px', borderRadius: 6, fontSize: 12, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-mute)', cursor: 'pointer' }}>
            📁 上传CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{ display: 'none' }} />
        </div>
      </div>

      {/* Data source info */}
      {source !== 'none' && (
        <div className="card" style={{ padding: '12px 20px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>
            数据来源: {source === 'localStorage' ? '策略页调参结果' : 'CSV 文件'} · <strong style={{ color: 'var(--text)' }}>{stratName}</strong> · {rawData.length} 个组合
          </span>
          {robProg > 0 && robProg < 100 && (
            <span style={{ fontSize: 11, color: 'var(--up)' }}>稳健性分析中… {robProg}%</span>
          )}
        </div>
      )}

      {/* Empty state */}
      {source === 'none' && (
        <div className="card" style={{ padding: '60px 40px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔬</div>
          <div className="section-title" style={{ fontSize: 16, marginBottom: 8 }}>暂无分析数据</div>
          <div style={{ fontSize: 13, color: 'var(--text-mute)', lineHeight: 1.8, marginBottom: 32 }}>
            完成以下步骤后，报告将自动加载：
          </div>
          <div className="step-flow">
            {[
              { step: '1', text: '策略页写代码' },
              { step: '2', text: '运行参数优化' },
              { step: '3', text: '返回此页查看报告' },
            ].map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                <div className="step-node">
                  <div className="step-circle">{s.step}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>{s.text}</div>
                </div>
                {i < 2 && <div className="step-line" />}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', margin: '24px 0 16px' }}>或者</div>
          <button onClick={() => fileRef.current?.click()} style={{ padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 700, border: 'none', background: 'var(--up)', color: '#fff', cursor: 'pointer', boxShadow: '0 2px 12px rgba(38,166,154,0.3)' }}>
            📁 上传 CSV 文件
          </button>
        </div>
      )}

      {/* Filter panel */}
      {showFilters && source !== 'none' && (
        <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 12 }}>过滤条件</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {filterInputs.map(f => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: 10, color: 'var(--text-mute)', marginBottom: 4 }}>{f.label}</label>
                <input type="number" step={f.step} value={filters[f.key]} onChange={e => setFilters(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                  style={{ width: '100%', padding: '5px 8px', borderRadius: 5, fontSize: 12, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', outline: 'none' }} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>评分权重</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(weights).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ fontSize: 10, color: 'var(--text-mute)', minWidth: 60 }}>{k}</label>
                <input type="range" min={0} max={1} step={0.05} value={v}
                  onChange={e => setWeights(p => ({ ...p, [k]: Number(e.target.value) }))}
                  style={{ width: 80 }} />
                <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text)', minWidth: 30 }}>{(v*100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ fontSize: 10, color: 'var(--text-mute)' }}>稳健性权重</label>
            <input type="range" min={0} max={1} step={0.05} value={robustnessWeight} onChange={e => setRobustnessWeight(Number(e.target.value))} style={{ width: 100 }} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--up)' }}>{(robustnessWeight*100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {source !== 'none' && rawData.length > 0 && (
        <>
          {/* Stats bar */}
          <div className="card stats-bar" style={{ display: 'flex', marginBottom: 16, overflow: 'hidden' }}>
            <Stat label="原始组合" value={stats.total} />
            <Stat label="去重后" value={stats.dedup} />
            <Stat label="通过过滤" value={stats.passed} color="var(--up)" />
            <Stat label="帕累托最优" value={stats.pareto} color="var(--gold)" />
            <Stat label="最高收益" value={`${fmt(stats.maxReturn, 1)}%`} color="var(--up)" />
            <Stat label="参数维度" value={`${paramDims}D`} />
            <Stat label="稳健性权重" value={`${(robustnessWeight*100).toFixed(0)}%`} />
          </div>

          {/* Scatter plot */}
          <div className="card" style={{ padding: '16px', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>📈 收益 vs 回撤 分布</span>
              <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>横轴: 回撤% · 纵轴: 收益% · 左上角为理想区域</span>
            </div>
            <ScatterPlot data={scored.map(r => ({ returnPct: r.returnPct, ddPct: r.ddPct, passed: r.passed, originalIndex: r.originalIndex }))} ranked={ranked} />
          </div>

          {/* 🏆 Top 10 */}
          {top10.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>🏆 推荐参数组合 Top 10</span>
                <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>综合分 = 效用分 × 稳健性</span>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                  <thead>
                    <tr>
                      {['#', '综合分', '效用分', '稳健性', '收益%', '回撤%', '胜率%', '盈亏比', '交易数'].map(h => (
                        <th key={h} style={thS}>{h}</th>
                      ))}
                      {top10[0] && Object.keys(userParams(top10[0].strategyParams || {})).map(k => (
                        <th key={k} style={{ ...thS, color: 'var(--up)' }}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {top10.map((row, i) => (
                      <tr key={row.originalIndex} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i === 0 ? 'rgba(38,166,154,0.04)' : 'transparent' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 700, color: i === 0 ? 'var(--up)' : 'var(--text-mute)' }}>
                          {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`}
                        </td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--up)' }}>{fmt(row.combinedScore, 3)}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: 'var(--text)' }}>{fmt(row.utilityScore, 3)}</td>
                        <td style={{ padding: '6px 10px' }}><RobBar score={row.robustnessScore} total={row.totalNeighbors} stable={row.stableNeighbors} /></td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600, color: row.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmt(row.returnPct)}%</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: row.ddPct > 20 ? 'var(--down)' : 'var(--text-mute)' }}>{fmt(row.ddPct)}%</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmt(row.winRate, 1)}%</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{fmt(row.winLossRatio)}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{row.totalTrades}</td>
                        {Object.values(userParams(row.strategyParams || {})).map((v, j) => (
                          <td key={j} style={{ padding: '6px 10px', fontFamily: 'monospace', color: 'var(--up)' }}>{String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* All data */}
          <div className="card">
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>📋 全量数据 ({deduplicated.length} 条)</span>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {['行号', '综合分', '稳健性', '收益%', '回撤%', '交易数', '状态'].map(h => (
                      <th key={h} style={thS}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {scored.map(row => {
                    const rb = robustness[row.originalIndex]
                    const enriched = ranked.find(r => r.originalIndex === row.originalIndex)
                    return (
                      <tr key={row.originalIndex} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '5px 10px', color: 'var(--text-mute)' }}>{row.originalIndex}</td>
                        <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: enriched ? 'var(--up)' : 'var(--text-dim)' }}>
                          {enriched ? fmt(enriched.combinedScore, 3) : '—'}
                        </td>
                        <td style={{ padding: '5px 10px' }}>
                          {rb ? <RobBar score={rb.robustnessScore} total={rb.totalNeighbors} stable={rb.stableNeighbors} /> : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                        </td>
                        <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: row.returnPct >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmt(row.returnPct)}%</td>
                        <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: 'var(--text-mute)' }}>{fmt(row.ddPct)}%</td>
                        <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{row.totalTrades}</td>
                        <td style={{ padding: '5px 10px' }}>
                          {row.passed
                            ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(38,166,154,0.1)', color: 'var(--up)' }}>通过</span>
                            : <span style={{ fontSize: 10, color: 'var(--down)' }}>{row.filterReasons.join(' · ')}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
