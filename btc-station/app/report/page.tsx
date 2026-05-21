'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import {
  parseCSV, processRawData, applyFilters, scoreRows, computePareto, computeRobustness, epochsToRawRows,
  DEFAULT_FILTERS, DEFAULT_WEIGHTS,
  type RawRow, type Filters, type ScoreWeights,
} from '@/lib/robustness'
import Surface3DPlot from '@/components/Surface3DPlot'

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
// Pareto 前沿:不被任何其他点支配的方案(高收益 + 低回撤,左上角)
function computeScatterPareto(pts: { returnPct: number; ddPct: number; originalIndex: number }[]): Set<number> {
  const result = new Set<number>()
  pts.forEach((p, i) => {
    const dominated = pts.some((q, j) =>
      i !== j && q.returnPct >= p.returnPct && q.ddPct <= p.ddPct &&
      (q.returnPct > p.returnPct || q.ddPct < p.ddPct)
    )
    if (!dominated) result.add(p.originalIndex)
  })
  return result
}

// 规整刻度:根据 minV 和 maxV 计算合适的网格，不再强制从0开始
function niceTicks(minV: number, maxV: number, ticks = 5): { ticks: number[]; min: number; max: number } {
  let range = maxV - minV
  if (range <= 0) {
    const pad = maxV === 0 ? 1 : Math.abs(maxV) * 0.1
    minV -= pad; maxV += pad; range = maxV - minV
  }
  const rawStep = range / ticks
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const norm = rawStep / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  
  const tickMin = Math.floor(minV / step) * step
  const tickMax = Math.ceil(maxV / step) * step
  
  const result: number[] = []
  for (let v = tickMin; v <= tickMax + step * 0.001; v += step) {
    result.push(Number(v.toFixed(4))) // 避免浮点误差
  }
  return { ticks: result, min: tickMin, max: tickMax }
}

type ScatterPoint = { returnPct: number; ddPct: number; passed: boolean; originalIndex: number; combinedScore?: number }
function ScatterPlot({ data, ranked }: { data: ScatterPoint[]; ranked: { originalIndex: number; combinedScore?: number }[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; pt: ScatterPoint; rank?: number } | null>(null)
  const top3 = useMemo(() => ranked.slice(0, 3).map(r => r.originalIndex), [ranked])
  const top3Rank = useMemo(() => new Map(top3.map((idx, i) => [idx, i + 1])), [top3])

  // 只对"通过过滤"的点算 Pareto 前沿
  const paretoSet = useMemo(() => {
    const pts = data.filter(d => d.passed).map(d => ({ returnPct: d.returnPct, ddPct: d.ddPct, originalIndex: d.originalIndex }))
    return computeScatterPareto(pts)
  }, [data])

  // 用 ref 存 hit-test 用的数据,避免 draw 闭包过旧
  const pointPositions = useRef<{ x: number; y: number; pt: ScatterPoint }[]>([])
  const layoutRef = useRef<{ pad: {top:number;right:number;bottom:number;left:number}; W: number; H: number }>({
    pad: { top: 20, right: 20, bottom: 36, left: 56 }, W: 0, H: 0,
  })

  const draw = useCallback((canvas: HTMLCanvasElement, width: number, height: number) => {
    if (data.length === 0) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr; canvas.height = height * dpr
    canvas.style.width = width + 'px'; canvas.style.height = height + 'px'
    ctx.scale(dpr, dpr)
    const W = width, H = height
    const pad = layoutRef.current.pad
    layoutRef.current.W = W; layoutRef.current.H = H
    const pw = W - pad.left - pad.right, ph = H - pad.top - pad.bottom

    // 数据范围 + 规整刻度
    const rets = data.map(d => d.returnPct), dds = data.map(d => d.ddPct)
    const rawMinR = Math.min(...rets), rawMaxR = Math.max(...rets)
    const rawMinD = Math.min(...dds), rawMaxD = Math.max(...dds)
    const rSpan = rawMaxR - rawMinR || Math.abs(rawMaxR) * 0.1 || 1
    const dSpan = rawMaxD - rawMinD || Math.abs(rawMaxD) * 0.1 || 1
    
    const xAxis = niceTicks(rawMinD - dSpan * 0.05, rawMaxD + dSpan * 0.05, 6)
    const yAxis = niceTicks(rawMinR - rSpan * 0.05, rawMaxR + rSpan * 0.05, 6)
    
    const xTicks = xAxis.ticks, xMin = xAxis.min, xMax = xAxis.max
    const yTicks = yAxis.ticks, yMin = yAxis.min, yMax = yAxis.max
    
    const scaleX = (v: number) => pad.left + ((v - xMin) / (xMax - xMin || 1)) * pw
    const scaleY = (v: number) => pad.top + ph - ((v - yMin) / (yMax - yMin || 1)) * ph

    ctx.clearRect(0, 0, W, H)

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1
    xTicks.forEach(v => { const x = scaleX(v); ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ph); ctx.stroke() })
    yTicks.forEach(v => { const y = scaleY(v); ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke() })

    // 坐标轴
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'
    ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, pad.top + ph); ctx.lineTo(W - pad.right, pad.top + ph); ctx.stroke()

    // 刻度文字
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '10px monospace'
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    const fmtTick = (v: number) => Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '')
    yTicks.forEach(v => { ctx.fillText(fmtTick(v), pad.left - 6, scaleY(v)) })
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    xTicks.forEach(v => { ctx.fillText(fmtTick(v), scaleX(v), pad.top + ph + 6) })

    // 轴标签
    ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px sans-serif'
    ctx.textAlign = 'center'; ctx.fillText('回撤 %', pad.left + pw / 2, H - 4)
    ctx.save(); ctx.translate(14, pad.top + ph / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('收益 %', 0, 0); ctx.restore()

    // Pareto 折线(按回撤升序连)
    const paretoPts = data
      .filter(d => paretoSet.has(d.originalIndex))
      .sort((a, b) => a.ddPct - b.ddPct)
    if (paretoPts.length >= 2) {
      ctx.strokeStyle = 'rgba(255,215,0,0.35)'; ctx.lineWidth = 1.5
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      paretoPts.forEach((p, i) => {
        const x = scaleX(p.ddPct), y = scaleY(p.returnPct)
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      })
      ctx.stroke()
      ctx.setLineDash([])
    }

    // 数据点
    // 渲染顺序:① 先画所有 Pareto 橙色光环(垫底,不被 Top 3 遮挡)
    //           ② 再画普通点
    //           ③ 最后画 Top 3 金球(放最上面,但下面已有橙环)
    pointPositions.current = []

    // ① Pareto 橙色光环(包括 Top 3,所有 Pareto 都标)
    data.forEach(d => {
      if (!paretoSet.has(d.originalIndex)) return
      const x = scaleX(d.ddPct), y = scaleY(d.returnPct)
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,165,0,0.18)'; ctx.fill()  // 橙色辉光垫底
      ctx.strokeStyle = '#FFA500'; ctx.lineWidth = 2; ctx.stroke()
    })

    // ② 收集 hit-test 数据并画普通点
    data.forEach(d => {
      const x = scaleX(d.ddPct), y = scaleY(d.returnPct)
      pointPositions.current.push({ x, y, pt: d })
      const rank = top3Rank.get(d.originalIndex)
      if (rank) return  // Top 3 在第 ③ 步画
      const isPareto = paretoSet.has(d.originalIndex)
      if (isPareto) {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2)
        ctx.fillStyle = '#FFA500'; ctx.fill()  // 实心橙色
      } else if (d.passed) {
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(38,166,154,0.65)'; ctx.fill()
      } else {
        ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(239,83,80,0.35)'; ctx.fill()
      }
    })

    // ③ Top 3 金球(最上层,橙环已在第 ① 步垫底所以不会被遮)
    data.forEach(d => {
      const rank = top3Rank.get(d.originalIndex)
      if (!rank) return
      const x = scaleX(d.ddPct), y = scaleY(d.returnPct)
      const size = rank === 1 ? 8 : rank === 2 ? 6.5 : 5.5
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2)
      ctx.fillStyle = '#FFD700'; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.fillStyle = '#1e222d'; ctx.font = `bold ${rank === 1 ? 11 : 9}px sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText(String(rank), x, y)
    })

    // 图例(右上角)
    const lg: [string, string, string][] = [
      ['通过', 'rgba(38,166,154,0.65)', 'fill'],
      ['未通过', 'rgba(239,83,80,0.35)', 'fill'],
      ['Pareto 前沿', '#FFA500', 'halo'],
      ['Top 3', '#FFD700', 'fill'],
    ]
    ctx.font = '10px sans-serif'
    let lx = W - pad.right - 240
    lg.forEach(([label, color, mode]) => {
      const cy = pad.top + 8
      if (mode === 'halo') {
        // 跟图上一致:橙色光环+实心橙色
        ctx.beginPath(); ctx.arc(lx, cy, 6, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(255,165,0,0.25)'; ctx.fill()
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.stroke()
        ctx.beginPath(); ctx.arc(lx, cy, 3, 0, Math.PI * 2)
        ctx.fillStyle = color; ctx.fill()
      } else {
        ctx.beginPath(); ctx.arc(lx, cy, 4, 0, Math.PI * 2)
        ctx.fillStyle = color; ctx.fill()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
      ctx.fillText(label, lx + 10, cy)
      lx += ctx.measureText(label).width + 32
    })
  }, [data, paretoSet, top3Rank])

  // hit-test:鼠标移动找最近点
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || pointPositions.current.length === 0) return
    const rect = canvas.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    let best: { x: number; y: number; pt: ScatterPoint } | null = null
    let bestDist = 12 * 12  // 12px 半径内
    for (const p of pointPositions.current) {
      const dx = p.x - mx, dy = p.y - my
      const d = dx*dx + dy*dy
      if (d < bestDist) { bestDist = d; best = p }
    }
    if (best) {
      const rank = top3Rank.get(best.pt.originalIndex)
      setHover({ x: best.x, y: best.y, pt: best.pt, rank })
    } else {
      setHover(null)
    }
  }, [top3Rank])

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width
      const h = entries[0].contentRect.height
      if (w > 0 && h > 0) draw(canvas, w, h)
    })
    ro.observe(container)
    const w = container.offsetWidth || 600
    const h = container.offsetHeight || 560
    draw(canvas, w, h)
    return () => ro.disconnect()
  }, [draw])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', minHeight: 560, position: 'relative' }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', borderRadius: 6, cursor: hover ? 'pointer' : 'default' }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div style={{
          position: 'absolute',
          left: Math.min(hover.x + 14, (containerRef.current?.offsetWidth ?? 600) - 200),
          top:  Math.max(hover.y - 80, 8),
          padding: '8px 10px',
          background: 'rgba(30,34,45,0.96)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 4,
          fontSize: 11,
          color: '#d1d4dc',
          pointerEvents: 'none',
          minWidth: 180,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          fontFamily: "'JetBrains Mono',monospace",
        }}>
          <div style={{ marginBottom: 4, color: hover.rank ? '#FFD700' : '#00d4ff', fontWeight: 600 }}>
            {hover.rank ? `🏆 Top ${hover.rank} · 行号 ${hover.pt.originalIndex}` : `行号 ${hover.pt.originalIndex}`}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#787b86' }}>收益</span>
            <span style={{ color: hover.pt.returnPct >= 0 ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
              {hover.pt.returnPct >= 0 ? '+' : ''}{hover.pt.returnPct.toFixed(2)}%
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: '#787b86' }}>回撤</span>
            <span style={{ color: '#ef5350' }}>{hover.pt.ddPct.toFixed(2)}%</span>
          </div>
          {hover.pt.combinedScore != null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#787b86' }}>综合分</span>
              <span style={{ color: '#26a69a', fontWeight: 600 }}>{hover.pt.combinedScore.toFixed(3)}</span>
            </div>
          )}
          <div style={{ marginTop: 4, fontSize: 10, color: '#787b86' }}>
            {hover.pt.passed ? '✓ 通过过滤' : '✗ 未通过过滤'}
          </div>
        </div>
      )}
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
  const [showFilters, setShowFilters] = useState(true)  // 默认展开,用户能直接看到/调过滤+权重
  const [activeTab, setActiveTab] = useState<'top10' | 'scatter' | 'all' | 'surface'>('top10')
  const [plotX, setPlotX] = useState<string>('')
  const [plotY, setPlotY] = useState<string>('')
  const [plotZ, setPlotZ] = useState<string>('combinedScore')
  // Top10 排序状态:null = 按默认 combinedScore 降序,其他 = 用户点击切换
  const [top10Sort, setTop10Sort] = useState<{ key: string | null; dir: 'asc' | 'desc' }>({ key: null, dir: 'desc' })
  const abortRef = useRef<(() => void) | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Auto-load from storage
  useEffect(() => {
    // Priority 1: New data from Python Hyperopt via localStorage
    try {
      const saved = localStorage.getItem('optimize_epochs')
      if (saved) {
        const epochs = JSON.parse(saved)
        if (Array.isArray(epochs) && epochs.length > 0) {
          setRawData(epochsToRawRows(epochs))
          setSource('localStorage')
          setStratName(localStorage.getItem('optimize_strategy_name') || '策略')
          
          localStorage.removeItem('optimize_epochs')
          localStorage.removeItem('optimize_strategy_name')
          return
        }
      }
    } catch {}

    // Priority 2: Session storage from this page (filters, csv uploads, etc.)
    const session = sessionStorage.getItem('report_page_state')
    if (session) {
      try {
        const st = JSON.parse(session)
        if (st.rawData && st.rawData.length > 0) {
          setRawData(st.rawData)
          if (st.source) setSource(st.source)
          if (st.stratName) setStratName(st.stratName)
          if (st.filters) setFilters(st.filters)
          if (st.weights) setWeights(st.weights)
          if (st.robustnessWeight) setRobustnessWeight(st.robustnessWeight)
          if (st.robustness) setRobustness(st.robustness)
          if (st.showFilters !== undefined) setShowFilters(st.showFilters)
          if (st.activeTab) setActiveTab(st.activeTab)
          if (st.top10Sort) setTop10Sort(st.top10Sort)
        }
      } catch (e) {}
    }
  }, [])

  // Save session state
  useEffect(() => {
    if (rawData.length > 0) {
      sessionStorage.setItem('report_page_state', JSON.stringify({
        rawData, source, stratName, filters, weights, robustnessWeight, robustness, showFilters, activeTab, top10Sort
      }))
    }
  }, [rawData, source, stratName, filters, weights, robustnessWeight, robustness, showFilters, activeTab, top10Sort])

  // Process pipeline
  const processed = useMemo(() => processRawData(rawData), [rawData])
  const deduplicated = processed // 移除去重，保留所有参数组合以保证稳健性计算的准确性
  const filtered = useMemo(() => applyFilters(deduplicated, filters), [deduplicated, filters])
  const scored = useMemo(() => scoreRows(filtered, weights, filters), [filtered, weights, filters])
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

  // 默认按 combinedScore 降序取前 10;用户点表头则按选中列重排(基于已 Top10 内部排序)
  const top10 = useMemo(() => {
    const base = ranked.slice(0, 20)
    if (!top10Sort.key) return base
    return [...base].sort((a, b) => {
      const va = (a as unknown as Record<string, number>)[top10Sort.key!] ?? -1e9
      const vb = (b as unknown as Record<string, number>)[top10Sort.key!] ?? -1e9
      if (va < vb) return top10Sort.dir === 'asc' ? -1 : 1
      if (va > vb) return top10Sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [ranked, top10Sort])

  // 排序点击 handler:同列再点切升降序;新列默认降序(originalIndex 例外用升序)
  const handleTop10Sort = (key: string) => {
    setTop10Sort(prev => {
      if (prev.key === key) return { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
      return { key, dir: key === 'originalIndex' ? 'asc' : 'desc' }
    })
  }
  const stats = useMemo(() => {
    const passed = passedRows.length
    let maxReturn = 0, avgReturn = 0, medianReturn = 0, avgDrawdown = 0, avgTrades = 0
    let top20AvgReturn = 0
    
    if (passed > 0) {
      const returns = passedRows.map(r => r.returnPct).sort((a, b) => a - b)
      maxReturn = returns[returns.length - 1]
      avgReturn = returns.reduce((a, b) => a + b, 0) / passed
      medianReturn = returns[Math.floor(passed / 2)]
      avgDrawdown = passedRows.reduce((a, r) => a + r.ddPct, 0) / passed
      avgTrades = passedRows.reduce((a, r) => a + r.trades, 0) / passed
    }
    
    if (top10 && top10.length > 0) {
      top20AvgReturn = top10.reduce((a, r) => a + r.returnPct, 0) / top10.length
    }

    return {
      total: rawData.length,
      passed,
      pareto: paretoSet.size,
      maxReturn,
      avgReturn,
      medianReturn,
      avgDrawdown,
      avgTrades,
      top20AvgReturn
    }
  }, [rawData.length, passedRows, paretoSet.size, top10])

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

  // 平均稳健性分
  const avgRobustness = useMemo(() => {
    if (ranked.length === 0) return 0
    const sum = ranked.reduce((acc, r) => acc + (r.robustnessScore ?? 0), 0)
    return sum / ranked.length
  }, [ranked])

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '10px 24px', 
    fontSize: 15, 
    fontWeight: active ? 700 : 500, 
    color: '#d1d4dc', // 统一使用明亮的文字颜色，不再变灰
    cursor: 'pointer', 
    fontFamily: "'JetBrains Mono',monospace", 
    background: active ? 'rgba(38,166,154,0.1)' : 'transparent',
    border: 'none', 
    borderBottom: active ? '3px solid #26a69a' : '3px solid transparent',
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    transition: 'all 0.2s', 
    whiteSpace: 'nowrap' as const,
  })

  // --- 3D Surface Data Preparation ---
  const paramKeys = useMemo(() => Object.keys(userParams(deduplicated[0]?.strategyParams || {})), [deduplicated])
  
  // 智能寻找在回测中真正被变动的参数（即拥有超过1个唯一值的参数）
  const varyingParams = useMemo(() => {
    if (deduplicated.length < 2) return paramKeys
    const uniqueCount: Record<string, Set<any>> = {}
    paramKeys.forEach(k => uniqueCount[k] = new Set())
    
    for (const row of deduplicated) {
      const p = userParams(row.strategyParams || {})
      for (const k of paramKeys) {
        uniqueCount[k].add(p[k])
      }
    }
    
    // 按唯一值的数量降序排序
    return paramKeys.sort((a, b) => uniqueCount[b].size - uniqueCount[a].size)
  }, [deduplicated, paramKeys])

  const px = plotX || varyingParams[0] || paramKeys[0] || ''
  const py = plotY || (varyingParams.length > 1 ? varyingParams[1] : varyingParams[0]) || paramKeys[1] || ''
  const pz = plotZ || 'combinedScore'
  
  const surfaceData = useMemo(() => {
    if (!px || !py || ranked.length === 0) return []
    // 找到全局最优的参数(作为切片锚点)
    const bestParams = userParams(ranked[0].strategyParams || {})
    
    // 从所有结果中(用 scored 以包含未通过过滤的点，或者只用 ranked，但地形图最好能看到全貌，所以用 scored)
    return scored
      .filter(row => {
        const p = userParams(row.strategyParams || {})
        // 除了 px 和 py 外，其他参数必须等于 bestParams 的值
        for (const k of paramKeys) {
          if (k !== px && k !== py && p[k] !== bestParams[k]) return false
        }
        return true
      })
      .map(row => {
        const p = userParams(row.strategyParams || {})
        const x = Number(p[px] || 0)
        const y = Number(p[py] || 0)
        
        // Z 轴取值
        let z = 0
        if (pz === 'combinedScore') {
          // 由于 combinedScore 只有 ranked 里算好了，未通过的我们就给 0 或者重新算一下
          const rk = ranked.find(r => r.originalIndex === row.originalIndex)
          z = rk ? rk.combinedScore : (row.utilityScore > 0 ? row.utilityScore * (1 - robustnessWeight) : row.utilityScore)
        } else {
          z = Number((row as any)[pz]) || 0
        }
        
        return { 
          x, 
          y, 
          z,
          text: `行号: ${row.originalIndex}<br>${px}: ${x}<br>${py}: ${y}<br>${pz}: ${z.toFixed(2)}`
        }
      })
  }, [scored, ranked, px, py, pz, paramKeys, robustnessWeight])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#131722', color: '#d1d4dc', fontFamily: "'Space Grotesk',system-ui,sans-serif", fontSize: 13 }}>

      {/* ── TV 风格 Topbar ── */}
      <div style={{ flexShrink: 0, height: 50, display: 'flex', alignItems: 'center', padding: '0 20px', background: '#1e222d', borderBottom: '1px solid #363a45', gap: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#d1d4dc' }}>优化报告</span>
        <span
          title="评分逻辑:Calmar 35% + Sortino 30% + Profit Factor 25% + NetReturn 10% + Sharpe 0%。过滤:盈亏比 ≥1.5、Sortino ≥1.0、PF ≥1.5、回撤 ≤40%。点击「过滤设置」可调整。"
          style={{
            padding: '4px 10px', borderRadius: 4, fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
            background: 'rgba(247,147,26,.12)', color: '#f7931a',
            border: '1px solid rgba(247,147,26,.3)', cursor: 'help',
          }}
        >🎯 BTC 趋势策略模式</span>
        {source !== 'none' && (
          <>
            {/* 显眼数据源徽章 */}
            <span style={{
              padding: '4px 10px', borderRadius: 4, fontSize: 11, fontFamily: "'JetBrains Mono',monospace",
              background: source === 'localStorage' ? 'rgba(0,212,255,.12)' : 'rgba(240,185,11,.12)',
              color: source === 'localStorage' ? '#00d4ff' : '#f0b90b',
              border: `1px solid ${source === 'localStorage' ? 'rgba(0,212,255,.3)' : 'rgba(240,185,11,.3)'}`,
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />
              {source === 'localStorage' ? '数据源:站内上次优化结果' : '数据源:上传的 CSV 文件'}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: '#787b86', display: 'flex', alignItems: 'center' }}>
              {stratName} <span style={{ margin: '0 6px' }}>·</span> {rawData.length} 个组合
            </span>
            {/* 清除按钮:既清屏也清 localStorage,防止下次刷新又自动加载 */}
            <button
              onClick={() => {
                if (!confirm('清除当前分析数据?如果是站内优化结果,会同时清除浏览器缓存,下次刷新不再自动加载。')) return;
                try { localStorage.removeItem('optimize_epochs') } catch {}
                setRawData([]); setSource('none'); setStratName(''); setRobustness({}); setRobProg(0);
              }}
              title="清空当前数据,可上传新 CSV"
              style={{ padding: '4px 10px', borderRadius: 4, fontSize: 11, border: '1px solid #363a45', background: 'transparent', color: '#787b86', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}
            >
              ✕ 清除
            </button>
            {robProg > 0 && robProg < 100 && (
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#00d4ff', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d4ff', display: 'inline-block' }} />
                分析中 {robProg}%
              </span>
            )}
          </>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={() => setShowFilters(!showFilters)} style={{ padding: '6px 14px', borderRadius: 4, fontSize: 12, border: `1px solid ${showFilters ? 'rgba(38,166,154,.4)' : '#363a45'}`, background: showFilters ? 'rgba(38,166,154,.08)' : 'transparent', color: showFilters ? '#26a69a' : '#787b86', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace" }}>
            过滤设置
          </button>
          <button onClick={() => fileRef.current?.click()} style={{ padding: '6px 14px', borderRadius: 4, fontSize: 12, border: '1px solid rgba(38,166,154,.4)', background: 'rgba(38,166,154,.08)', color: '#26a69a', cursor: 'pointer', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
            ↑ 上传 CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleCSV} style={{ display: 'none' }} />
        </div>
      </div>

      {/* ── 过滤面板（折叠）── */}
      {showFilters && source !== 'none' && (
        <div style={{ flexShrink: 0, padding: '20px 24px', background: '#1e222d', borderBottom: '1px solid #363a45' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, marginBottom: 20 }}>
            {filterInputs.map(f => (
              <div key={f.key}>
                <label style={{ display: 'block', fontSize: 11, color: '#787b86', marginBottom: 6, fontFamily: "'JetBrains Mono',monospace", textTransform: 'uppercase', letterSpacing: '.04em' }}>{f.label}</label>
                <input type="number" step={f.step} value={filters[f.key]} onChange={e => setFilters(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 4, fontSize: 13, border: '1px solid #363a45', background: '#131722', color: '#d1d4dc', outline: 'none', fontFamily: "'JetBrains Mono',monospace" }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center', paddingTop: 10, borderTop: '1px dashed #363a45' }}>
            <span style={{ fontSize: 11, color: '#787b86', fontFamily: "'JetBrains Mono',monospace", textTransform: 'uppercase', letterSpacing: '.04em' }}>评分权重</span>
            {Object.entries(weights).map(([k, v]) => {
              // 给每个权重一个工具提示,解释为什么是这个默认值
              const tip: Record<string, string> = {
                calmar:       '年化收益÷最大回撤,BTC 趋势策略最核心指标(默认 35%)',
                sortino:      '只惩罚下行波动的改进版夏普,对趋势爆发友好(默认 30%)',
                profitFactor: '总盈利÷总亏损,趋势策略低胜率高盈亏比的灵魂(默认 25%)',
                sharpe:       '会把"趋势爆拉"当波动扣分,对 BTC 趋势策略不友好。默认 0%。如果你测的是均值回归/网格策略,可手动拉到 10%',
                netReturn:    '总净收益%。权重高容易被"高收益+高回撤"的极端方案带歪,默认 10%',
              }
              return (
                <div key={k} title={tip[k] || ''} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'help' }}>
                  <span style={{ fontSize: 11, color: '#787b86', minWidth: 50, fontFamily: "'JetBrains Mono',monospace" }}>{k}</span>
                  <input type="range" min={0} max={1} step={0.05} value={v} onChange={e => setWeights(p => ({ ...p, [k]: Number(e.target.value) }))} style={{ width: 90 }} />
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: v === 0 ? '#787b86' : '#d1d4dc', minWidth: 32 }}>{(v*100).toFixed(0)}%</span>
                </div>
              )
            })}
            <div title="稳健性=参数邻域稳定性,值越高代表此方案在参数微调下仍表现稳定" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'help', marginLeft: 'auto' }}>
              <span style={{ fontSize: 11, color: '#787b86', fontFamily: "'JetBrains Mono',monospace" }}>稳健性权重</span>
              <input type="range" min={0} max={1} step={0.05} value={robustnessWeight} onChange={e => setRobustnessWeight(Number(e.target.value))} style={{ width: 100 }} />
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#26a69a' }}>{(robustnessWeight*100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      )}

      {/* ── 空状态 ── */}
      {source === 'none' && (
        <div style={{ padding: '80px 40px', textAlign: 'center', maxWidth: 600, margin: '0 auto' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🔬</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#d1d4dc', marginBottom: 8 }}>暂无分析数据</div>
          <div style={{ fontSize: 13, color: '#787b86', lineHeight: 1.8, marginBottom: 32 }}>完成以下步骤后，报告将自动加载：</div>
          <div className="step-flow">
            {[{ step: '1', text: '策略页写代码' }, { step: '2', text: '运行参数优化' }, { step: '3', text: '返回此页查看报告' }].map((s, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                <div className="step-node">
                  <div className="step-circle">{s.step}</div>
                  <div style={{ fontSize: 12, color: '#787b86' }}>{s.text}</div>
                </div>
                {i < 2 && <div className="step-line" />}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#363a45', margin: '24px 0 16px' }}>或者</div>
          <button onClick={() => fileRef.current?.click()} style={{ padding: '10px 28px', borderRadius: 8, fontSize: 14, fontWeight: 700, border: 'none', background: '#26a69a', color: '#fff', cursor: 'pointer', boxShadow: '0 2px 12px rgba(38,166,154,0.3)' }}>
            上传 CSV 文件
          </button>
        </div>
      )}

      {/* ── 有数据时：左右分栏布局 ── */}
      {source !== 'none' && rawData.length > 0 && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>

          {/* 左侧：ScoreCard 仪表盘 320px */}
          <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #363a45', background: '#1e222d', padding: 20, display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto' }}>

            {/* 圆形仪表 */}
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              {(() => {
                const pct = Math.round(avgRobustness * 100)
                const r = 54, circ = 2 * Math.PI * r
                const fill = circ * pct / 100
                const color = pct >= 70 ? '#26a69a' : pct >= 40 ? '#f0b90b' : '#ef5350'
                return (
                  <div style={{ position: 'relative', width: 130, height: 130, margin: '0 auto 8px' }}>
                    <svg viewBox="0 0 130 130" width={130} height={130}>
                      <circle cx={65} cy={65} r={r} fill="none" stroke="rgba(255,255,255,.06)" strokeWidth={9} />
                      <circle cx={65} cy={65} r={r} fill="none" stroke={color} strokeWidth={9}
                        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
                        transform="rotate(-90 65 65)" style={{ transition: 'stroke-dasharray 1s ease-out' }} />
                    </svg>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 32, fontWeight: 700, color, letterSpacing: '-.04em', lineHeight: 1 }}>{pct}</div>
                      <div style={{ fontSize: 10, color: '#787b86', marginTop: 3 }}>稳健性</div>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* 四格迷你卡片 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 14 }}>
              {[
                { val: stats.total, lbl: '总组合', color: '#d1d4dc' },
                { val: stats.passed, lbl: '通过', color: '#26a69a' },
                { val: stats.pareto, lbl: '帕累托', color: '#f0b90b' },
                { val: `${paramDims}D`, lbl: '参数维度', color: '#00d4ff' },
              ].map(({ val, lbl, color }) => (
                <div key={lbl} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 4, padding: '8px 10px', textAlign: 'center' }}>
                  <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 600, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: '#787b86', marginTop: 2 }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* 评分权重分解 */}
            <div style={{ fontSize: 10, color: '#787b86', textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: "'JetBrains Mono',monospace", marginBottom: 8 }}>评分权重</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Object.entries(weights).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#787b86', fontFamily: "'JetBrains Mono',monospace" }}>{k}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: 60, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)' }}>
                      <div style={{ width: `${v * 100}%`, height: '100%', borderRadius: 2, background: 'linear-gradient(90deg,#26a69a,#00d4ff)' }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#d1d4dc', minWidth: 24 }}>{(v*100).toFixed(0)}%</span>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2, paddingTop: 6, borderTop: '1px solid #363a45' }}>
                <span style={{ fontSize: 11, color: '#787b86', fontFamily: "'JetBrains Mono',monospace" }}>稳健性</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 60, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)' }}>
                    <div style={{ width: `${robustnessWeight * 100}%`, height: '100%', borderRadius: 2, background: '#26a69a' }} />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#26a69a', minWidth: 24 }}>{(robustnessWeight*100).toFixed(0)}%</span>
                </div>
              </div>
            </div>

            {/* 核心指标统计卡片 */}
            {stats.passed > 0 && (
              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div style={{ padding: '8px 10px', background: 'rgba(38,166,154,.06)', border: '1px solid rgba(38,166,154,.2)', borderRadius: 5 }}>
                    <div style={{ fontSize: 10, color: '#787b86', fontFamily: "'JetBrains Mono',monospace", marginBottom: 3 }}>最高收益</div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 700, color: '#26a69a' }}>+{fmt(stats.maxReturn, 1)}%</div>
                  </div>
                  <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,.03)', border: '1px solid #363a45', borderRadius: 5 }}>
                    <div style={{ fontSize: 10, color: '#787b86', fontFamily: "'JetBrains Mono',monospace", marginBottom: 3 }}>Top20均收益</div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 700, color: '#d1d4dc' }}>+{fmt(stats.top20AvgReturn, 1)}%</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                  <div style={{ padding: '8px', background: 'rgba(255,255,255,.03)', border: '1px solid #363a45', borderRadius: 5, textAlign: 'center' }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: '#d1d4dc' }}>{fmt(stats.medianReturn, 1)}%</div>
                    <div style={{ fontSize: 9, color: '#787b86', marginTop: 2 }}>收益中位数</div>
                  </div>
                  <div style={{ padding: '8px', background: 'rgba(239,83,80,.06)', border: '1px solid rgba(239,83,80,.2)', borderRadius: 5, textAlign: 'center' }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: '#ef5350' }}>{fmt(stats.avgDrawdown, 1)}%</div>
                    <div style={{ fontSize: 9, color: '#787b86', marginTop: 2 }}>平均回撤</div>
                  </div>
                  <div style={{ padding: '8px', background: 'rgba(255,255,255,.03)', border: '1px solid #363a45', borderRadius: 5, textAlign: 'center' }}>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: '#d1d4dc' }}>{fmt(stats.avgTrades, 0)}</div>
                    <div style={{ fontSize: 9, color: '#787b86', marginTop: 2 }}>平均交易数</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：Tab 面板 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Tab 栏 */}
            <div style={{ height: 32, display: 'flex', alignItems: 'flex-end', padding: '0 12px', borderBottom: '1px solid #363a45', background: '#1e222d', gap: 2, flexShrink: 0 }}>
              <button style={tabBtnStyle(activeTab === 'top10')} onClick={() => setActiveTab('top10')}>Top 20 推荐</button>
              <button style={tabBtnStyle(activeTab === 'all')} onClick={() => setActiveTab('all')}>全量数据 ({processed.length})</button>
            </div>

            {/* Tab 内容 */}
            <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>

              {/* Tab: Top 10 */}
              {activeTab === 'top10' && (
                top10.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#d1d4dc' }}>推荐参数组合 Top 20</span>
                      <span style={{ fontSize: 10, color: '#787b86', fontFamily: "'JetBrains Mono',monospace" }}>综合分 = 效用分 × 稳健性</span>
                    </div>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                        <thead>
                          <tr>
                            {([
                              ['originalIndex', '行号'],
                              ['combinedScore', '综合分'],
                              ['utilityScore', '效用分'],
                              ['robustnessScore', '稳健性'],
                              ['calmarRatio', 'Calmar'],
                              ['returnPct', '收益%'],
                              ['ddPct', '回撤%'],
                              ['winRate', '胜率%'],
                              ['winLossRatio', '盈亏比'],
                              ['totalTrades', '交易数'],
                            ] as [string, string][]).map(([key, label]) => {
                              const active = top10Sort.key === key
                              return (
                                <th key={key}
                                  onClick={() => handleTop10Sort(key)}
                                  style={{
                                    ...thS, cursor: 'pointer', userSelect: 'none', color: active ? '#26a69a' : (thS.color as string),
                                    ...(key === 'originalIndex' ? { position: 'sticky', left: 0, zIndex: 10, background: '#131722', borderRight: '1px solid rgba(255,255,255,0.06)' } : { zIndex: 1, background: '#131722' })
                                  }}
                                  title="点击切换排序方向"
                                >
                                  {label}{active ? (top10Sort.dir === 'desc' ? ' ↓' : ' ↑') : ' ⇅'}
                                </th>
                              )
                            })}
                            {top10[0] && Object.keys(userParams(top10[0].strategyParams || {})).map(k => (
                              <th key={k} style={{ ...thS, color: '#787b86' }}>{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {top10.map((row) => {
                            // 标记综合分最高的那一行(原始排名第 1,不随用户排序变化)
                            const isTopRec = ranked[0]?.originalIndex === row.originalIndex
                            return (
                            <tr key={row.originalIndex} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: isTopRec ? 'rgba(38,166,154,0.04)' : 'transparent' }}>
                              <td style={{
                                padding: '7px 10px', fontFamily: "'JetBrains Mono',monospace", color: '#787b86', display: 'flex', alignItems: 'center', gap: 6,
                                position: 'sticky', left: 0, zIndex: 1, background: isTopRec ? '#161e22' : '#131722', borderRight: '1px solid rgba(255,255,255,0.06)'
                              }}>
                                <span>{row.originalIndex}</span>
                                {isTopRec && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#26a69a', display: 'inline-block', flexShrink: 0 }} title="原始 Top 1 推荐" />}
                                {row.isPareto && <span title="Pareto 前沿:不被任何其他方案同时支配(高收益+低回撤+高 Sortino+高 PF)" style={{ padding: '1px 5px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: 'rgba(255,165,0,0.15)', color: '#FFA500', border: '1px solid rgba(255,165,0,0.4)', letterSpacing: '.04em', flexShrink: 0 }}>★</span>}
                              </td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#26a69a' }}>{fmt(row.combinedScore, 3)}</td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#d1d4dc' }}>{fmt(row.utilityScore, 3)}</td>
                              <td style={{ padding: '7px 10px' }}><RobBar score={row.robustnessScore} total={row.totalNeighbors} stable={row.stableNeighbors} /></td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#d1d4dc' }}>{fmt(row.calmarRatio)}</td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontWeight: 600, color: row.returnPct >= 0 ? '#26a69a' : '#ef5350' }}>{fmt(row.returnPct)}%</td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace', color: row.ddPct > 20 ? '#ef5350' : '#787b86' }}>{fmt(row.ddPct)}%</td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{fmt(row.winRate, 1)}%</td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{fmt(row.winLossRatio)}</td>
                              <td style={{ padding: '7px 10px', fontFamily: 'monospace' }}>{row.totalTrades}</td>
                              {Object.values(userParams(row.strategyParams || {})).map((v, j) => (
                                <td key={j} style={{ padding: '7px 10px', fontFamily: 'monospace', color: '#787b86' }}>{String(v)}</td>
                              ))}
                            </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* 收益分布散点图 */}
                    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#d1d4dc' }}>收益 vs 回撤 分布</span>
                        <span style={{ fontSize: 10, color: '#787b86', fontFamily: "'JetBrains Mono',monospace" }}>横轴: 回撤% · 纵轴: 收益% · 左上角为理想区域</span>
                      </div>
                      <div style={{ flex: 1, minHeight: 560 }}>
                        <ScatterPlot
                          data={scored.map(r => {
                            const rk = ranked.find(rr => rr.originalIndex === r.originalIndex)
                            return { returnPct: r.returnPct, ddPct: r.ddPct, passed: r.passed, originalIndex: r.originalIndex, combinedScore: rk?.combinedScore }
                          })}
                          ranked={ranked}
                        />
                      </div>
                    </div>

                    {/* 3D 参数地形图 */}
                    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexShrink: 0, flexWrap: 'wrap', gap: 10, background: 'rgba(255,255,255,0.02)', padding: '10px 14px', borderRadius: 6, border: '1px solid #363a45' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d4dc' }}>3D 参数地形</span>
                          
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#787b86' }}>X轴:</span>
                            <select value={px} onChange={e => setPlotX(e.target.value)} style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45', borderRadius: 4, padding: '2px 8px', fontSize: 11, outline: 'none' }}>
                              {paramKeys.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#787b86' }}>Y轴:</span>
                            <select value={py} onChange={e => setPlotY(e.target.value)} style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45', borderRadius: 4, padding: '2px 8px', fontSize: 11, outline: 'none' }}>
                              {paramKeys.map(k => <option key={k} value={k}>{k}</option>)}
                            </select>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 11, color: '#787b86' }}>Z轴(高度):</span>
                            <select value={pz} onChange={e => setPlotZ(e.target.value)} style={{ background: '#131722', color: '#d1d4dc', border: '1px solid #363a45', borderRadius: 4, padding: '2px 8px', fontSize: 11, outline: 'none' }}>
                              <option value="combinedScore">综合分</option>
                              <option value="utilityScore">效用分</option>
                              <option value="returnPct">收益率 %</option>
                              <option value="ddPct">回撤 %</option>
                              <option value="winRate">胜率 %</option>
                            </select>
                          </div>
                        </div>
                        
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 11, color: '#f0b90b', background: 'rgba(240,185,11,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(240,185,11,0.2)' }}>
                            提示: 其它维度参数已锁定于当前推荐 Top 1 最优解
                          </span>
                        </div>
                      </div>
                      
                      <div style={{ height: 480, border: '1px solid #363a45', borderRadius: 6, background: '#1e222d', overflow: 'hidden' }}>
                        {surfaceData.length > 2 ? (
                          <Surface3DPlot data={surfaceData} labels={{ x: px, y: py, z: pz === 'combinedScore' ? '综合分' : pz === 'returnPct' ? '收益%' : pz === 'ddPct' ? '回撤%' : pz }} />
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#787b86', fontSize: 12 }}>
                            当前切片的数据点不足 ({surfaceData.length}个)，无法生成 3D 地形。请确保策略至少有2个可变参数。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '40px 0', textAlign: 'center', color: '#787b86', fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>
                    无通过过滤的参数组合，请调整过滤条件
                  </div>
                )
              )}

              {/* Tab: 全量数据 */}
              {activeTab === 'all' && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr>
                        {['行号', '综合分', '稳健性', '收益%', '回撤%', '交易数', '状态'].map(h => (
                          <th key={h} style={{
                            ...thS,
                            ...(h === '行号' ? { position: 'sticky', left: 0, zIndex: 10, background: '#131722', borderRight: '1px solid rgba(255,255,255,0.06)' } : { zIndex: 1, background: '#131722' })
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scored.map(row => {
                        const rb = robustness[row.originalIndex]
                        const enriched = ranked.find(r => r.originalIndex === row.originalIndex)
                        return (
                          <tr key={row.originalIndex} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                            <td style={{
                              padding: '5px 10px', color: '#787b86', fontFamily: 'monospace', whiteSpace: 'nowrap',
                              position: 'sticky', left: 0, zIndex: 1, background: '#131722', borderRight: '1px solid rgba(255,255,255,0.06)'
                            }}>
                              {row.originalIndex}
                              {enriched?.isPareto && <span title="Pareto 前沿" style={{ marginLeft: 5, padding: '1px 4px', borderRadius: 3, fontSize: 9, fontWeight: 700, background: 'rgba(255,165,0,0.15)', color: '#FFA500', border: '1px solid rgba(255,165,0,0.4)' }}>★</span>}
                            </td>
                            <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: enriched ? '#26a69a' : '#363a45' }}>
                              {enriched ? fmt(enriched.combinedScore, 3) : '—'}
                            </td>
                            <td style={{ padding: '5px 10px' }}>
                              {rb ? <RobBar score={rb.robustnessScore} total={rb.totalNeighbors} stable={rb.stableNeighbors} /> : <span style={{ color: '#363a45' }}>—</span>}
                            </td>
                            <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: row.returnPct >= 0 ? '#26a69a' : '#ef5350' }}>{fmt(row.returnPct)}%</td>
                            <td style={{ padding: '5px 10px', fontFamily: 'monospace', color: '#787b86' }}>{fmt(row.ddPct)}%</td>
                            <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{row.totalTrades}</td>
                            <td style={{ padding: '5px 10px' }}>
                              {row.passed
                                ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: 'rgba(38,166,154,0.1)', color: '#26a69a' }}>通过</span>
                                : <span style={{ fontSize: 10, color: '#ef5350' }}>{row.filterReasons.join(' · ')}</span>}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
