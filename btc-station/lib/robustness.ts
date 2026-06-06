// Robustness analysis algorithms - ported from btc-panel/quant-lab.org

export interface RawRow { [key: string]: unknown }

export interface ProcessedRow {
  originalIndex: number
  netProfit: number
  netProfitPct: number
  returnPct: number
  ddPct: number
  calmarRatio: number
  winRate: number
  winLossRatio: number
  totalTrades: number
  sharpe: number
  sortino: number
  profitFactor: number
  singleLossPct: number
  marginCalls: number
  kellyFraction: number
  E: number
  initialCapital: number
  avgWin: number
  avgLoss: number
  // 多/空分组(BTC 趋势策略多空失衡惩罚用)
  netPnlLong: number
  netPnlShort: number
  totalTradesLong: number
  totalTradesShort: number
  strategyParams: Record<string, number | boolean | string>
  filterReasons: string[]
  passed: boolean
  // scoring
  finalScore: number
  utilityScore: number
  combinedScore: number
  robustnessScore: number
  neighborCount: number
  stableNeighborCount: number
  passedNeighborCount: number
  isPareto: boolean
}

export interface Filters {
  minTrades: number
  minProfitFactor: number
  maxSingleLossPct: number
  maxDrawdown: number
  minSharpe: number
  minSortino: number
  minWinRate: number
  minWinLossRatio: number
}

export interface ScoreWeights {
  calmar: number
  sortino: number
  profitFactor: number
  sharpe: number
  netReturn: number
}

// BTC 趋势策略专用默认值
// 趋势策略本质:低胜率、高盈亏比、少数大趋势贡献主要收益
// → 强调 Calmar(年化/回撤)、Sortino(只惩罚下行)、Profit Factor(盈亏比)
// → 弱化 Sharpe(会惩罚趋势爆发的"好波动")、Net Return(避免被高回撤的极端方案带歪)
export const DEFAULT_FILTERS: Filters = {
  minTrades: 20,           // 趋势策略一年约 20 笔合理(原 10)
  minProfitFactor: 1.5,    // PF < 1.5 的趋势策略无意义(原 1.0)
  maxSingleLossPct: 10,    // 单笔亏损 > 10% 是风控失败(原 30)
  maxDrawdown: 40,         // 实盘可承受上限(原 70)
  minSharpe: 0,            // 不限制 — 夏普会惩罚趋势爆发(原 0)
  minSortino: 1.0,         // Sortino 才是趋势策略真指标(原 0)
  minWinRate: 0,           // 不限制 — 趋势策略低胜率正常
  minWinLossRatio: 1.5,    // 趋势策略盈亏比 < 1.5 不可接受(原 0)
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  calmar: 0.35,            // +5 (趋势策略最核心指标)
  sortino: 0.30,           // +10 (改进版夏普,对趋势友好)
  profitFactor: 0.25,      // +5 (盈亏比是趋势策略灵魂)
  sharpe: 0,               // -5 (夏普会扣趋势爆发的分,降到 0)
  netReturn: 0.10,         // -15 (避免被极端高收益+爆仓方案带歪)
}

// ── CSV Parser ──
export function parseCSV(text: string): RawRow[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (!lines.length) return []
  const parseRow = (line: string) => {
    const values: string[] = []; let current = '', inQuotes = false
    for (const char of line) {
      if (char === '"') inQuotes = !inQuotes
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = '' }
      else current += char
    }
    values.push(current.trim()); return values
  }
  const headers = parseRow(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''))
  return lines.slice(1).map(line => {
    const values = parseRow(line)
    if (values.length !== headers.length) return null
    const row: RawRow = {}
    headers.forEach((header, idx) => {
      const value = values[idx].replace(/^"|"$/g, '').trim()
      if (value === '∅' || value === '') row[header] = null
      else if (value === 'true') row[header] = true
      else if (value === 'false') row[header] = false
      else {
        const isFormattedNum = /^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(value)
        const clean = isFormattedNum ? value.replace(/,/g, '') : value
        row[header] = isNaN(Number(clean)) || clean === '' ? value : parseFloat(clean)
      }
    })
    return row
  }).filter(Boolean) as RawRow[]
}

// ── Step Neighbor Meta ──
export function prepareStepNeighborMeta(allRows: { strategyParams: Record<string, unknown> }[]) {
  const allKeys = Object.keys(allRows[0]?.strategyParams || {})
  const numericVaryingKeys = allKeys.filter(key => {
    const vals = allRows.map(r => r.strategyParams?.[key]).filter(v => typeof v === 'number' && isFinite(v as number)) as number[]
    return vals.length >= 2 && vals.some(v => v !== vals[0])
  })
  const boolVaryingKeys = allKeys.filter(key => {
    const vals = allRows.map(r => r.strategyParams?.[key]).filter(v => typeof v === 'boolean') as boolean[]
    return vals.length >= 2 && vals.some(v => v !== vals[0])
  })
  const stepSizes: Record<string, number> = {}
  numericVaryingKeys.forEach(key => {
    const vals = [...new Set(allRows.map(r => r.strategyParams?.[key]).filter(v => typeof v === 'number' && isFinite(v as number)) as number[])].sort((a, b) => a - b)
    if (vals.length < 2) { stepSizes[key] = Infinity; return }
    const diffs: number[] = []
    for (let i = 1; i < vals.length; i++) { const d = vals[i] - vals[i-1]; if (d > 1e-9) diffs.push(d) }
    if (diffs.length === 0) { stepSizes[key] = Infinity; return }
    const counts: Record<string, number> = {}
    diffs.forEach(d => { const r = Number(d.toFixed(8)); counts[r] = (counts[r] || 0) + 1 })
    stepSizes[key] = Number(Object.keys(counts).reduce((a, b) => counts[Number(a)] > counts[Number(b)] ? a : b))
  })
  return { numericVaryingKeys, boolVaryingKeys, stepSizes }
}

// ── Process raw data ──
function getVal(row: RawRow, ...keys: string[]): number {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null) return Number(row[k]) || 0
  return 0
}

export function processRawData(data: RawRow[]): Omit<ProcessedRow, 'finalScore'|'utilityScore'|'combinedScore'|'robustnessScore'|'neighborCount'|'stableNeighborCount'|'passedNeighborCount'|'isPareto'>[] {
  return data.map((row, idx) => {
    const initialCapital = getVal(row, 'Initial Capital: All', 'Initial Capital', 'Initial capital') || 10000
    const percentProfit = getVal(row, 'Percent profitable: All', 'Percent Profitable', 'Win Rate', 'Profitable trades')
    const grossProfit = getVal(row, 'Gross profit: All', 'Gross Profit')
    const grossLoss = Math.abs(getVal(row, 'Gross loss: All', 'Gross Loss'))
    const maxDD = Math.abs(getVal(row, 'Max equity drawdown', 'Max Drawdown', 'Max drawdown'))
    const maxDDPct = Math.abs(getVal(row, 'Max equity drawdown %', 'Max Drawdown %', 'Max drawdown %'))
    let totalTrades = getVal(row, 'Total trades: All', 'Total Trades')
    const netProfit = getVal(row, 'Net profit: All', 'Net Profit', 'Net P&L: All', 'Total P&L', 'Net PnL: All', 'Total PnL')
    const netProfitPct = getVal(row, 'Net profit %: All', 'Net Profit %', 'Net P&L %: All', 'Total P&L %', 'Net PnL %: All', 'Total PnL %')
    let winningTrades = getVal(row, 'Winning trades: All', 'Winning Trades')
    let losingTrades = getVal(row, 'Losing trades: All', 'Losing Trades')
    
    const ptr = row['Profitable trades ratio'] || row['Profitable Trades Ratio']
    if (typeof ptr === 'string' && ptr.includes('/')) {
      const parts = ptr.split('/')
      winningTrades = parseInt(parts[0], 10) || 0
      totalTrades = parseInt(parts[1], 10) || 0
      losingTrades = totalTrades - winningTrades
    }

    let avgWin = getVal(row, 'Avg winning trade: All', 'Avg Trade')
    let avgLoss = Math.abs(getVal(row, 'Avg losing trade: All', 'Avg Trade'))
    const largestLoss = Math.abs(getVal(row, 'Largest losing trade: All', 'Largest Losing Trade'))
    const largestLossPct = Math.abs(getVal(row, 'Largest losing trade percent: All', 'Largest Losing Trade %'))
    const sharpe = getVal(row, 'Sharpe ratio', 'Sharpe Ratio')
    const sortino = getVal(row, 'Sortino ratio', 'Sortino Ratio')
    const profitFactor = getVal(row, 'Profit factor: All', 'Profit Factor', 'Profit factor')
    const marginCalls = getVal(row, 'Margin calls: All', 'Margin Calls', 'Margin calls')
    // 多/空分组(用于多空失衡惩罚)
    const netPnlLong  = getVal(row, 'Net P&L: Long',  'Net profit: Long', 'Net PnL: Long')
    const netPnlShort = getVal(row, 'Net P&L: Short', 'Net profit: Short', 'Net PnL: Short')
    const totalTradesLong  = getVal(row, 'Total trades: Long')
    const totalTradesShort = getVal(row, 'Total trades: Short')

    if (avgWin === 0 && winningTrades > 0 && grossProfit > 0) avgWin = grossProfit / winningTrades
    if (avgLoss === 0 && losingTrades > 0 && grossLoss > 0) avgLoss = grossLoss / losingTrades

    const p = percentProfit > 1 ? percentProfit / 100 : percentProfit
    const E = p * avgWin - (1 - p) * avgLoss
    const ddPct = maxDDPct || (maxDD / initialCapital) * 100
    const returnPct = netProfitPct
    const calmarRatio = ddPct > 0 ? returnPct / ddPct : 0
    const R = avgLoss > 0 ? avgWin / avgLoss : 0
    let kellyFraction = 0
    if (avgLoss === 0 && avgWin > 0 && winningTrades > 0) kellyFraction = 1.0
    else if (R > 0) kellyFraction = Math.min(1.0, (p * R - (1 - p)) / R)
    const singleLossPct = largestLossPct || (largestLoss / initialCapital) * 100

    const strategyParams: Record<string, number | boolean | string> = {}
    Object.keys(row).forEach(key => { if (key.startsWith('__')) strategyParams[key.replace(/^__/, '')] = row[key] as number | boolean | string })

    return {
      originalIndex: idx + 2, netProfit, netProfitPct, returnPct, ddPct, calmarRatio,
      winRate: percentProfit, winLossRatio: R, totalTrades, sharpe, sortino, profitFactor,
      singleLossPct, marginCalls, kellyFraction, E, initialCapital, avgWin, avgLoss,
      netPnlLong, netPnlShort, totalTradesLong, totalTradesShort,
      strategyParams, filterReasons: [] as string[], passed: true,
    }
  })
}

// ── Convert optimize epochs to processable format ──
export function epochsToRawRows(epochs: { profit_pct: number; drawdown_pct: number; trades: number; win_rate_pct?: number; sharpe?: number; sortino?: number; profit_factor?: number; params?: Record<string, string> }[]): RawRow[] {
  return epochs.map(e => {
    // Compute a synthetic net profit from percentage (assume $10k initial)
    const netProfit = e.profit_pct * 100  // e.g. 28.07% -> 2807 (as raw value for filtering)
    const row: RawRow = {
      'Net Profit': netProfit,
      'Net Profit %': e.profit_pct,
      'Max Drawdown %': e.drawdown_pct,
      'Total Trades': e.trades,
      'Win Rate': e.win_rate_pct ?? 50,  // default 50 if not provided
      'Sharpe Ratio': e.sharpe ?? 0,
      'Sortino Ratio': e.sortino ?? 0,
      'Profit Factor': e.profit_factor ?? 0,
      '__from_grid_search': 1,  // marker to relax filters
    }
    if (e.params) Object.entries(e.params).forEach(([k, v]) => { row[`__${k}`] = isNaN(Number(v)) ? v : Number(v) })
    return row
  })
}

// ── Filter ──
// 数据完整度自动判断:
//   完整(TV Assistant 145列) → 8 维过滤
//   简化(站内导出 / grid search) → 仅按收益/回撤/交易数过滤,其余指标缺失就跳过
// 检测依据:行内 avgWin/sortino/singleLossPct 均为 0 = 简化数据
function isSlimRow(row: ReturnType<typeof processRawData>[number]): boolean {
  // grid search 显式标记优先
  if (row.strategyParams?.['from_grid_search'] === 1) return true
  // 站内导出的 CSV: avgWin/avgLoss 均为 0(缺失 "Avg winning/losing trade" 列)
  if (row.avgWin === 0 && row.avgLoss === 0 && row.totalTrades > 0) return true
  // 或 sortino = 0 但其他指标正常(TV 145 列正常策略 sortino 一般非零)
  if (row.sortino === 0 && row.sharpe === 0 && row.profitFactor > 0) return true
  return false
}

export function applyFilters(rows: ReturnType<typeof processRawData>, filters: Filters) {
  return rows.map(row => {
    const reasons: string[] = []
    const slim = isSlimRow(row)

    if (slim) {
      // 简化数据:只过滤"必有"的字段
      if (row.returnPct <= 0) reasons.push('亏损')
      if (row.totalTrades < filters.minTrades) reasons.push(`交易数<${filters.minTrades}`)
      if (row.ddPct > filters.maxDrawdown) reasons.push(`回撤>${filters.maxDrawdown}%`)
      if (row.profitFactor > 0 && row.profitFactor < filters.minProfitFactor) reasons.push(`盈利因子<${filters.minProfitFactor}`)
    } else {
      // Full CSV data: apply all filters
      if (row.netProfit <= 0) reasons.push('亏损')
      if (row.E <= 0) reasons.push('期望为负')
      if (row.profitFactor < filters.minProfitFactor) reasons.push(`盈利因子<${filters.minProfitFactor}`)
      if (row.totalTrades < filters.minTrades) reasons.push(`交易数<${filters.minTrades}`)
      if (row.marginCalls > 0) reasons.push('有爆仓')
      if (row.singleLossPct > filters.maxSingleLossPct) reasons.push(`单笔亏损>${filters.maxSingleLossPct}%`)
      if (reasons.length === 0) {
        if (row.ddPct > filters.maxDrawdown) reasons.push(`回撤>${filters.maxDrawdown}%`)
        if (row.sharpe < filters.minSharpe) reasons.push(`夏普<${filters.minSharpe}`)
        if (row.sortino < filters.minSortino) reasons.push(`索提诺<${filters.minSortino}`)
        if (row.winRate < filters.minWinRate) reasons.push(`胜率<${filters.minWinRate}%`)
        if (row.winLossRatio < filters.minWinLossRatio) reasons.push(`盈亏比<${filters.minWinLossRatio}`)
      }
    }
    return { ...row, filterReasons: reasons, passed: reasons.length === 0 }
  })
}

// ── Score ──
// BTC 趋势策略选优逻辑(3 步):
//   1. finalScore  = 5 维加权(Calmar/Sortino/PF/Sharpe/NetReturn)
//   2. utilityScore = finalScore × 稳定系数 - 风险临界惩罚 - 多空失衡惩罚
//      - 稳定系数:仅样本极少(<10)时小幅降权,不主动奖励高样本(参数少的优化场景常见)
//      - 风险临界:贴近过滤上限(回撤/单笔亏损)的方案脆弱,降分
//      - 多空失衡:双向策略中一边亏损 / 完全靠一边 → 适应性差,降分
//   3. combinedScore = utilityScore × (1 - w + w × robustnessScore) [在 page.tsx 中合成]
export function scoreRows(filtered: ReturnType<typeof applyFilters>, weights: ScoreWeights, filters?: Filters) {
  const passed = filtered.filter(r => r.passed)
  if (passed.length === 0) return filtered.map(r => ({ ...r, finalScore: 0, utilityScore: 0 }))
  const N = passed.length
  const pLow = N < 50 ? 0.0 : 0.05, pHigh = N < 50 ? 1.0 : 0.95
  const pct = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length-1, Math.floor(s.length*p))] || 0 }
  const allDDs = passed.map(d => d.ddPct).sort((a, b) => a - b)
  const calmarFloor = Math.max(allDDs[Math.floor(allDDs.length/2)] || 5.0, 2.0)
  const dynNorm = (v: number, min: number, max: number) => max === min ? 0.5 : Math.max(0, Math.min(1, (v-min)/(max-min)))

  const recalc = passed.map(r => ({ ...r, calmarRatio: r.returnPct / Math.max(r.ddPct, calmarFloor) }))
  const ranges = {
    calmar: { min: pct(recalc.map(d=>d.calmarRatio), pLow), max: pct(recalc.map(d=>d.calmarRatio), pHigh) },
    sharpe: { min: pct(recalc.map(d=>d.sharpe), pLow), max: pct(recalc.map(d=>d.sharpe), pHigh) },
    sortino: { min: pct(recalc.map(d=>d.sortino), pLow), max: pct(recalc.map(d=>d.sortino), pHigh) },
    profitFactor: { min: pct(recalc.map(d=>d.profitFactor), pLow), max: pct(recalc.map(d=>d.profitFactor), pHigh) },
    netReturn: { min: pct(recalc.map(d=>d.returnPct), pLow), max: pct(recalc.map(d=>d.returnPct), pHigh) },
  }

  const safeMaxDD   = Math.max(0.0001, filters?.maxDrawdown ?? 40)
  const safeMaxLoss = Math.max(0.0001, filters?.maxSingleLossPct ?? 10)

  const passedSet = new Set(recalc.map(r => r.originalIndex))
  return filtered.map(row => {
    if (!passedSet.has(row.originalIndex)) return { ...row, calmarRatio: row.calmarRatio, finalScore: 0, utilityScore: 0 }
    const cr = row.returnPct / Math.max(row.ddPct, calmarFloor)
    const fs = dynNorm(cr, ranges.calmar.min, ranges.calmar.max) * weights.calmar +
      dynNorm(row.sharpe, ranges.sharpe.min, ranges.sharpe.max) * weights.sharpe +
      dynNorm(row.sortino, ranges.sortino.min, ranges.sortino.max) * weights.sortino +
      dynNorm(row.profitFactor, ranges.profitFactor.min, ranges.profitFactor.max) * weights.profitFactor +
      dynNorm(row.returnPct, ranges.netReturn.min, ranges.netReturn.max) * weights.netReturn

    // ① 稳定系数(弱化版):仅样本极少时小幅降权,不奖励高样本
    const stabilityCoeff = row.totalTrades < 10 ? 0.95 : 1.0

    // ② 风险临界惩罚:贴近回撤/单笔亏损上限的方案脆弱
    let riskPenalty = 0
    const ddProx = row.ddPct / safeMaxDD
    if (ddProx > 0.85) riskPenalty += 0.15 * (ddProx - 0.85) / 0.15
    const lossProx = row.singleLossPct / safeMaxLoss
    if (lossProx > 0.80) riskPenalty += 0.10 * (lossProx - 0.80) / 0.20

    // ③ 多空失衡惩罚:双向策略中一边亏损 / 完全靠一边
    let lsPenalty = 0
    const hasLong  = (row.totalTradesLong  || 0) > 0 || row.netPnlLong !== 0
    const hasShort = (row.totalTradesShort || 0) > 0 || row.netPnlShort !== 0
    if (hasLong && hasShort) {
      const l = row.netPnlLong || 0
      const s = row.netPnlShort || 0
      const tot = Math.abs(l) + Math.abs(s)
      if (tot > 0) {
        if (l < 0 || s < 0) {
          lsPenalty = 0.08 * Math.abs(Math.min(l, s)) / tot
        } else {
          const dom = Math.max(l, s) / tot
          if (dom > 0.90) lsPenalty = 0.03 * (dom - 0.90) / 0.10
        }
      }
    }

    const utilityScore = fs * stabilityCoeff - riskPenalty - lsPenalty
    return { ...row, calmarRatio: cr, finalScore: fs, utilityScore }
  })
}

// ── Pareto front ──
export function computePareto<T extends { calmarRatio: number; returnPct: number; sortino: number; profitFactor: number }>(rows: T[]): Set<number> {
  const dims: (keyof T)[] = ['calmarRatio', 'returnPct', 'sortino', 'profitFactor']
  const indices = new Set<number>()
  rows.forEach((item, i) => {
    const dominated = rows.some((other, j) => i !== j &&
      dims.every(d => (other[d] as number) >= (item[d] as number)) &&
      dims.some(d => (other[d] as number) > (item[d] as number)))
    if (!dominated) indices.add(i)
  })
  return indices
}

// ── Robustness (async chunked) ──
export function computeRobustness(
  allRows: ReturnType<typeof processRawData>,
  passedIndices: Set<number>,
  onProgress: (pct: number) => void,
  onComplete: (result: Record<number, { robustnessScore: number; totalNeighbors: number; stableNeighbors: number; passedNeighbors: number }>) => void,
): () => void {
  let aborted = false
  const abort = () => { aborted = true }

  if (allRows.length < 2) { onProgress(100); onComplete({}); return abort }

  const { numericVaryingKeys, boolVaryingKeys, stepSizes } = prepareStepNeighborMeta(allRows)
  if (numericVaryingKeys.length === 0 && boolVaryingKeys.length === 0) { onProgress(100); onComplete({}); return abort }

  const result: Record<number, { robustnessScore: number; totalNeighbors: number; stableNeighbors: number; passedNeighbors: number }> = {}
  const total = allRows.length
  let idx = 0
  const CHUNK = 150

  const processChunk = () => {
    if (aborted) return
    const end = Math.min(idx + CHUNK, total)
    for (let i = idx; i < end; i++) {
      const row = allRows[i]
      let totalN = 0, stableN = 0, passedN = 0
      for (let j = 0; j < total; j++) {
        if (i === j) continue
        const other = allRows[j]
        let changed = 0, exceeds = false
        for (const key of numericVaryingKeys) {
          const vR = row.strategyParams?.[key], vO = other.strategyParams?.[key]
          if (typeof vR !== 'number' || typeof vO !== 'number') continue
          const diff = Math.abs(vR - vO)
          if (diff < 1e-9) continue
          const step = stepSizes[key]
          if (!isFinite(step) || step <= 0) { changed++; continue }
          if (diff / step > 1.5) { exceeds = true; break }
          changed++
        }
        if (!exceeds) for (const key of boolVaryingKeys) {
          if (row.strategyParams?.[key] !== other.strategyParams?.[key]) changed++
        }
        if (exceeds || changed === 0 || changed > 2) continue
        totalN++
        if (passedIndices.has(other.originalIndex)) passedN++
        const retDiff = Math.abs(row.returnPct) < 1e-6 ? (Math.abs(other.returnPct) < 1e-6 ? 0 : 1) : Math.abs(other.returnPct - row.returnPct) / Math.abs(row.returnPct)
        const ddDiff = Math.abs(other.ddPct - row.ddPct)
        if (retDiff < 0.15 && ddDiff < 5.0) stableN++
      }
      const stableR = totalN > 0 ? stableN / totalN : 0
      const passedR = totalN > 0 ? passedN / totalN : 0
      const conf = totalN >= 3 ? 1.0 : (totalN > 0 ? 0.9 : 0)
      result[row.originalIndex] = { totalNeighbors: totalN, stableNeighbors: stableN, passedNeighbors: passedN, robustnessScore: (stableR * 0.70 + passedR * 0.30) * conf }
    }
    idx = end
    onProgress(Math.round((idx / total) * 100))
    if (idx < total) setTimeout(processChunk, 0)
    else onComplete(result)
  }
  setTimeout(processChunk, 0)
  return abort
}
