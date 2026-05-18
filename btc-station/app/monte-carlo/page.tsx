'use client'

import React, { useState, useRef, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import ReactECharts from 'echarts-for-react'

// ── Types ───────────────────────────────────────────────────────────────────

interface Trade {
  id: number
  profitUSDT: number
  profitPct: number
}

interface MCSimulation {
  finalEquity: number
  returnPct: number
  maxDrawdownPct: number
  curve: number[]
}

interface MCStats {
  returns: { p5: number; p50: number; p95: number; mean: number }
  drawdowns: { p5: number; p50: number; p95: number; mean: number; p99: number }
  riskOfRuin: number
}

// ── Components ──────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | React.ReactNode; color?: string }) {
  return (
    <div style={{ padding: '16px 20px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 12, color: 'var(--text-mute)', marginBottom: 8, letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: color || 'var(--text)' }}>
        {value}
      </div>
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function MonteCarloPage() {
  const [fileData, setFileData] = useState<Trade[]>([])
  const [fileName, setFileName] = useState<string | null>(null)
  
  const [initialCapital, setInitialCapital] = useState<number>(10000)
  const [numSimulations, setNumSimulations] = useState<number>(5000)
  const [ruinThreshold, setRuinThreshold] = useState<number>(30)

  const [simulationMode, setSimulationMode] = useState<'absolute' | 'compounding'>('compounding')
  const [simulations, setSimulations] = useState<MCSimulation[]>([])
  const [stats, setStats] = useState<MCStats | null>(null)
  
  const [isComputing, setIsComputing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const originalStats = useMemo(() => {
    if (fileData.length === 0) return null
    let peak = initialCapital
    let current = initialCapital
    let maxDd = 0
    fileData.forEach(t => {
      if (simulationMode === 'compounding') {
        current = current * (1 + (t.profitPct || 0) / 100)
      } else {
        current += (t.profitUSDT || 0)
      }
      if (current > peak) peak = current
      const dd = (peak - current) / peak * 100
      if (dd > maxDd) maxDd = dd
    })
    return {
      returnPct: (current - initialCapital) / initialCapital * 100,
      maxDrawdownPct: maxDd
    }
  }, [fileData, initialCapital, simulationMode])

  const loadTrades = (trades: Trade[], name: string) => {
    setFileName(name)
    setFileData(trades)
    setSimulations([])
    setStats(null)
  }

  useEffect(() => {
    const cachedStr = sessionStorage.getItem('mc_trades_cache')
    if (cachedStr) {
      try {
        const cachedTrades = JSON.parse(cachedStr)
        if (Array.isArray(cachedTrades) && cachedTrades.length > 0) {
          loadTrades(cachedTrades, '策略回测结果 (来自 S3 缓存)')
          sessionStorage.removeItem('mc_trades_cache') // 读取后清除
        }
      } catch (e) {}
    }
  }, [initialCapital, simulationMode]) // 依赖 initialCapital，当加载时重新计算原始曲线

  // 1. 解析 Excel/CSV — 兼容 VectorBT 平台导出 / TradingView 导出 / 通用 CSV
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })

      // ── Step 1: 选择工作表 ──
      let sheetName = workbook.SheetNames.find(n => n.includes('交易清单') || n.includes('List of Trades'))
      if (!sheetName) {
        sheetName = workbook.SheetNames[0]
      }

      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as any[]

      if (rows.length === 0) {
        alert('解析失败：工作表 "' + sheetName + '" 中没有数据行。')
        return
      }

      // ── Step 2: 自动检测列名 ──
      const colNames = Object.keys(rows[0])

      // 查找"类型"列
      const typeCol = colNames.find(c =>
        c === '类型' || c === 'Type' || c.toLowerCase() === 'type'
      )

      // 查找"利润"列 — 按优先级尝试多种可能的列名
      const profitColCandidates = [
        '净损益 USDT', 'Net Profit USDT',
        '净损益 USD', 'Net Profit USD',
        '净损益', 'Net Profit',
        'PnL', 'pnl', 'Profit', 'profit',
        'P&L', 'Net P&L',
        'profitUSDT', 'profit_usdt',
      ]
      let profitCol = profitColCandidates.find(c => colNames.includes(c))

      // 如果精确匹配失败，模糊搜索
      if (!profitCol) {
        profitCol = colNames.find(c => {
          const lower = c.toLowerCase()
          return lower.includes('损益') || lower.includes('profit') || lower.includes('pnl')
        })
      }

      // 查找"百分比"列
      const pctColCandidates = [
        '净损益 %', 'Net Profit %', 'Return %', 'return', 'Return', 'pct', '百分比'
      ]
      let pctCol = pctColCandidates.find(c => colNames.includes(c))

      let trades: Trade[] = []
      
      const parseVal = (v: any) => {
        if (typeof v === 'number') return v
        if (typeof v === 'string') {
           const parsed = parseFloat(v.replace(/[^\d.-]/g, ''))
           return isNaN(parsed) ? 0 : parsed
        }
        return 0
      }

      // ── Strategy A: 有"类型"列 → 过滤出场行 ──
      if (typeCol && profitCol) {
        const exitRows = rows.filter(r => {
          const type = String(r[typeCol] || '')
          return type.includes('出场') || type.toLowerCase().includes('exit')
        })

        if (exitRows.length > 0) {
          trades = exitRows.map((r, i) => {
            return { id: i + 1, profitUSDT: parseVal(r[profitCol!]), profitPct: pctCol ? parseVal(r[pctCol]) : 0 }
          })
        }
      }

      // ── Strategy B: 无类型列或 A 失败 → 每行当一笔交易 ──
      if (trades.length === 0 && profitCol) {
        trades = rows.map((r, i) => {
          return { id: i + 1, profitUSDT: parseVal(r[profitCol!]), profitPct: pctCol ? parseVal(r[pctCol]) : 0 }
        }).filter(t => t.profitUSDT !== 0 || t.profitPct !== 0)
      }

      // ── Strategy C: 兜底 → 用第一个数字列当利润 ──
      if (trades.length === 0) {
        const numericCol = colNames.find(c => {
          const val = rows[0][c]
          return typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)))
        })
        if (numericCol) {
          trades = rows.map((r, i) => {
            return { id: i + 1, profitUSDT: parseVal(r[numericCol]), profitPct: 0 }
          }).filter(t => t.profitUSDT !== 0)
        }
      }

      if (trades.length === 0) {
        alert(
          '解析失败：未能从工作表中提取到交易利润数据。\n\n' +
          '检测到的工作表: ' + sheetName + '\n' +
          '检测到的列名: ' + colNames.join(', ') + '\n' +
          '数据行数: ' + rows.length + '\n\n' +
          '请确保文件中包含利润相关的列（如"净损益 USDT"、"PnL"、"Profit"等）。'
        )
        return
      }

      loadTrades(trades, file.name)
    }
    reader.readAsArrayBuffer(file)
  }

  // 2. 运行蒙特卡洛
  const runMonteCarlo = () => {
    if (fileData.length === 0) return
    setIsComputing(true)
    
    // 使用时间分片 (Time Slicing) 避免阻塞 UI 渲染，解决 INP 性能问题
    const nTrades = fileData.length
    const sims: MCSimulation[] = []
    let currentSimIndex = 0

    const computeChunk = () => {
      const startTime = performance.now()

      while (currentSimIndex < numSimulations) {
        let currentEquity = initialCapital
        let peakEquity = initialCapital
        let maxDrawdown = 0
        
        // 降低扇形图的渲染压力，只保存少量曲线用于绘图
        const saveCurve = currentSimIndex < 100
        const curve = saveCurve ? [initialCapital] : []

        for (let j = 0; j < nTrades; j++) {
          const randomIdx = Math.floor(Math.random() * nTrades)
          const trade = fileData[randomIdx]
          
          if (simulationMode === 'compounding') {
            currentEquity = currentEquity * (1 + (trade.profitPct || 0) / 100)
          } else {
            currentEquity += (trade.profitUSDT || 0)
          }

          if (saveCurve) curve.push(Math.max(1, currentEquity))
          
          if (currentEquity > peakEquity) peakEquity = currentEquity
          
          if (currentEquity <= 0) {
            maxDrawdown = 100
            currentEquity = 0
            if (saveCurve) {
              for (let k = j + 1; k < nTrades; k++) curve.push(1)
            }
            break
          }
          
          const dd = (peakEquity - currentEquity) / peakEquity * 100
          if (dd > maxDrawdown) maxDrawdown = dd
        }

        sims.push({
          finalEquity: currentEquity,
          returnPct: (currentEquity - initialCapital) / initialCapital * 100,
          maxDrawdownPct: maxDrawdown,
          curve
        })

        currentSimIndex++

        // 每隔 16ms (大约一帧的时间) 释放主线程，防止阻塞导致高 INP
        if (performance.now() - startTime > 16) {
          requestAnimationFrame(computeChunk)
          return
        }
      }

      // 统计分析
      sims.sort((a, b) => a.returnPct - b.returnPct)
      const returns = {
        p5: sims[Math.floor(numSimulations * 0.05)].returnPct,
        p50: sims[Math.floor(numSimulations * 0.50)].returnPct,
        p95: sims[Math.floor(numSimulations * 0.95)].returnPct,
        mean: sims.reduce((acc, s) => acc + s.returnPct, 0) / numSimulations
      }

      sims.sort((a, b) => a.maxDrawdownPct - b.maxDrawdownPct)
      const drawdowns = {
        p5: sims[Math.floor(numSimulations * 0.05)].maxDrawdownPct,
        p50: sims[Math.floor(numSimulations * 0.50)].maxDrawdownPct,
        p95: sims[Math.floor(numSimulations * 0.95)].maxDrawdownPct,
        p99: sims[Math.floor(numSimulations * 0.99)].maxDrawdownPct,
        mean: sims.reduce((acc, s) => acc + s.maxDrawdownPct, 0) / numSimulations
      }

      const ruinCount = sims.filter(s => s.maxDrawdownPct >= ruinThreshold).length
      const riskOfRuin = (ruinCount / numSimulations) * 100

      setSimulations(sims)
      setStats({ returns, drawdowns, riskOfRuin })
      setIsComputing(false)
    }

    requestAnimationFrame(computeChunk)
  }

  // 3. 图表配置
  const fanChartOption = useMemo(() => {
    if (simulations.length === 0) return {}
    
    const savedSims = simulations.filter(s => s.curve.length > 0)
    if (savedSims.length === 0) return {}
    
    const xData = Array.from({ length: fileData.length + 1 }, (_, i) => i)
    
    const p5Curve = []
    const p50Curve = []
    const p95Curve = []
    
    for (let step = 0; step <= fileData.length; step++) {
      const stepVals = savedSims.map(s => s.curve[step]).sort((a, b) => a - b)
      p5Curve.push(stepVals[Math.floor(stepVals.length * 0.05)])
      p50Curve.push(stepVals[Math.floor(stepVals.length * 0.50)])
      p95Curve.push(stepVals[Math.floor(stepVals.length * 0.95)])
    }

    const pathSeries = savedSims.map((sim, i) => ({
      name: `模拟路径 ${i}`,
      type: 'line',
      data: sim.curve,
      lineStyle: { color: 'rgba(0, 212, 255, 0.08)', width: 1 },
      showSymbol: false,
      animation: false,
      z: 1
    }))

    return {
      tooltip: { 
        trigger: 'axis',
        backgroundColor: 'rgba(19, 23, 34, 0.9)',
        borderColor: 'rgba(255,255,255,0.1)',
        textStyle: { color: '#d1d4dc' },
        formatter: (params: any[]) => {
          const step = params[0].name;
          const p95 = params.find(p => p.seriesName === 'P95 (乐观)')?.value;
          const p50 = params.find(p => p.seriesName === '中位数 (P50)')?.value;
          const p5 = params.find(p => p.seriesName === 'P5 (悲观)')?.value;
          if (!p50) return '';
          return `<div style="font-family: 'Space Grotesk', sans-serif">
                    <div style="font-size: 12px; color: #787b86; margin-bottom: 6px">交易步数: ${step}</div>
                    <div style="font-weight: bold; margin-bottom: 4px"><span style="color: #26a69a; margin-right: 6px">●</span> P95: $${Number(p95).toLocaleString(undefined, {maximumFractionDigits:2})}</div>
                    <div style="font-weight: bold; margin-bottom: 4px"><span style="color: #00d4ff; margin-right: 6px">●</span> P50: $${Number(p50).toLocaleString(undefined, {maximumFractionDigits:2})}</div>
                    <div style="font-weight: bold;"><span style="color: #ef5350; margin-right: 6px">●</span> P5: $${Number(p5).toLocaleString(undefined, {maximumFractionDigits:2})}</div>
                  </div>`;
        }
      },
      grid: { left: '4%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: { type: 'category', data: xData, boundaryGap: false },
      yAxis: { 
        type: simulationMode === 'compounding' ? 'log' : 'value', 
        logBase: 10,
        min: (value: { min: number, max: number }) => {
          const p5Min = Math.min(...p5Curve);
          return simulationMode === 'compounding' ? Math.max(1, p5Min * 0.5) : p5Min * 0.8;
        },
        max: (value: { min: number, max: number }) => {
          const p95Max = Math.max(...p95Curve);
          return simulationMode === 'compounding' ? p95Max * 2 : p95Max * 1.2;
        },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } },
        axisLabel: {
          formatter: (value: number) => {
            if (value >= 1e9) return (value / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
            if (value >= 1e6) return (value / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            if (value >= 1e3) return (value / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
            return value.toFixed(0);
          }
        }
      },
      series: [
        ...pathSeries,
        {
          name: 'P95 (乐观)', type: 'line', data: p95Curve,
          lineStyle: { color: 'rgba(38,166,154,0.8)', width: 2, type: 'dashed' }, showSymbol: false, z: 5
        },
        {
          name: 'P5 (悲观)', type: 'line', data: p5Curve,
          lineStyle: { color: 'rgba(239,83,80,0.8)', width: 2, type: 'dashed' }, showSymbol: false, z: 5
        },
        {
          name: '中位数 (P50)', type: 'line', data: p50Curve,
          lineStyle: { color: '#00d4ff', width: 3 }, showSymbol: false, z: 10
        }
      ]
    }
  }, [simulations, fileData, simulationMode])

  const currentRiskOfRuin = useMemo(() => {
    if (simulations.length === 0) return 0
    const ruinCount = simulations.filter(s => s.maxDrawdownPct >= ruinThreshold).length
    return (ruinCount / simulations.length) * 100
  }, [simulations, ruinThreshold])

  const ddHistOption = useMemo(() => {
    if (simulations.length === 0) return {}
    
    const bins = Array(20).fill(0)
    simulations.forEach(s => {
      let idx = Math.floor(s.maxDrawdownPct / 5)
      if (idx >= 20) idx = 19
      bins[idx]++
    })

    const xAxisData = bins.map((_, i) => `${i * 5}-${(i + 1) * 5}%`)

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: { type: 'category', data: xAxisData, axisLabel: { interval: 1 } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      series: [
        {
          name: '出现频次',
          type: 'bar',
          data: bins,
          itemStyle: {
            color: (params: any) => {
              const val = parseInt(params.name.split('-')[0])
              return val >= ruinThreshold ? 'rgba(239,83,80,0.8)' : 'rgba(38,166,154,0.8)'
            },
            borderRadius: [2, 2, 0, 0]
          }
        }
      ]
    }
  }, [simulations, ruinThreshold])


  return (
    <div style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 24px', fontFamily: "'Space Grotesk', system-ui, sans-serif", color: '#d1d4dc' }}>
      
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 8, letterSpacing: '-0.02em' }}>
          蒙特卡洛压力测试 (Monte Carlo)
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6, maxWidth: 800 }}>
          蒙特卡洛模拟用于评估量化策略的**统计鲁棒性**。它通过**随机打乱（Bootstrapping）**历史交易序列，生成成千上万条可能的未来资金曲线。这能帮你甄别：你的历史收益是因为策略本身有效，还是仅仅因为行情的出现顺序恰好对你有利？<br/>
          上传回测结果 <strong>Excel/CSV（包含"交易清单"表或利润列）</strong>，即可验证策略在极端环境下的抗风险能力。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.618fr', gap: 32, alignItems: 'start' }}>
        
        {/* 左侧控制面板 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 16 }}>数据源</div>
            
            <label style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              border: '1px dashed rgba(0,212,255,0.4)', background: 'rgba(0,212,255,0.04)', borderRadius: 8,
              padding: '24px 16px', cursor: 'pointer', transition: 'all 0.2s', marginBottom: 12
            }}>
              <span style={{ fontSize: 24, marginBottom: 8 }}>📊</span>
              <span style={{ fontSize: 13, color: '#00d4ff', fontWeight: 600 }}>上传回测导出文件 (.xlsx / .csv)</span>
              <span style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4, textAlign: 'center' }}>{fileName || '支持平台导出 & TradingView 报告'}</span>
              <input type="file" accept=".xlsx, .xls, .csv" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileUpload} />
            </label>

            {fileData.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-mute)', background: 'rgba(255,255,255,0.03)', padding: '8px 12px', borderRadius: 4 }}>
                成功解析 <strong>{fileData.length}</strong> 笔历史交易
              </div>
            )}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 16 }}>模拟参数</div>
            
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-mute)', marginBottom: 6 }}>资金累加模式</label>
              <select 
                value={simulationMode} onChange={e => { setSimulationMode(e.target.value as any); setSimulations([]); setStats(null); }}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }}
              >
                <option value="compounding">复利比例模式 (推荐, 按百分比)</option>
                <option value="absolute">固定金额模式 (按 USDT 加法)</option>
              </select>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-mute)', marginBottom: 6 }}>初始本金 (USDT)</label>
              <input 
                type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }}
              />
            </div>
            
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-mute)', marginBottom: 6 }}>模拟次数 (N)</label>
              <select 
                value={numSimulations} onChange={e => setNumSimulations(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }}
              >
                <option value={1000}>1,000 次 (快速)</option>
                <option value={5000}>5,000 次 (推荐)</option>
                <option value={10000}>10,000 次 (精确)</option>
              </select>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-mute)', marginBottom: 6 }}>破产阈值 (回撤 %)</label>
              <input 
                type="number" value={ruinThreshold} onChange={e => setRuinThreshold(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, color: '#fff' }}
              />
              <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>
                若回撤超过此值，视为账户"破产"
              </div>
            </div>

            <button 
              onClick={runMonteCarlo} 
              disabled={fileData.length === 0 || isComputing}
              style={{
                width: '100%', padding: '12px', borderRadius: 6, fontWeight: 700,
                background: fileData.length === 0 ? 'var(--accent-soft)' : 'var(--accent)',
                color: fileData.length === 0 ? 'var(--text-mute)' : '#131722',
                border: 'none', cursor: fileData.length === 0 ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s'
              }}
            >
              {isComputing ? '计算中...' : '开始蒙特卡洛模拟'}
            </button>
          </div>
        </div>

        {/* 右侧结果面板 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {!stats ? (
            <div className="card" style={{ padding: '80px 40px', textAlign: 'center', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>🎲</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff', marginBottom: 8 }}>等待数据输入</div>
              <div style={{ fontSize: 13, color: 'var(--text-mute)', maxWidth: 400, margin: '0 auto' }}>
                上传您的回测历史数据并设置参数，点击开始模拟以获取专业的统计风险评估。
              </div>
            </div>
          ) : (
            <>
              {/* 核心指标 */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
                <StatCard 
                  label="破产概率 (Risk of Ruin)" 
                  value={<span style={{ color: currentRiskOfRuin > 10 ? 'var(--down)' : 'var(--up)' }}>{currentRiskOfRuin.toFixed(2)}%</span>} 
                />
                <StatCard label="原始回测收益" value={`${originalStats?.returnPct.toFixed(2)}%`} color="#fff" />
                <StatCard 
                  label="中位数预期收益" 
                  value={`${stats.returns.p50.toFixed(2)}%`} 
                  color={stats.returns.p50 > 0 ? 'var(--up)' : 'var(--down)'} 
                />
                <StatCard 
                  label="99%置信度最大回撤" 
                  value={`${stats.drawdowns.p99.toFixed(2)}%`} 
                  color="var(--down)" 
                />
              </div>

              {/* 扇形图 */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>权益路径分布 (Equity Fan Chart)</div>
                  <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>展示 5% - 95% 置信区间及中位数</div>
                </div>
                <ReactECharts option={fanChartOption} style={{ height: 320 }} theme="dark" opts={{ renderer: 'canvas' }} />
              </div>

              {/* 回撤分布图 */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>最大回撤频率分布</div>
                  <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>
                    红色区域表示超过您设定的 {ruinThreshold}% 阈值
                  </div>
                </div>
                <ReactECharts option={ddHistOption} style={{ height: 260 }} theme="dark" opts={{ renderer: 'canvas' }} />
              </div>

              {/* 评估结论 */}
              <div className="card" style={{ padding: 24 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginBottom: 16 }}>分析结论</div>
                <ul style={{ paddingLeft: 20, margin: 0, fontSize: 13, color: '#d1d4dc', lineHeight: 1.8 }}>
                  <li>
                    您的原始策略产生了 <strong>{originalStats?.returnPct.toFixed(2)}%</strong> 的收益和 <strong>{originalStats?.maxDrawdownPct.toFixed(2)}%</strong> 的回撤。
                  </li>
                  <li>
                    在经历了 {numSimulations} 次运气洗牌后，有一半的几率（中位数）你能获得 <strong>{stats.returns.p50.toFixed(2)}%</strong> 以上的收益。
                  </li>
                  <li>
                    <strong>风险预警：</strong>在最倒霉的 1% 情况下，您将面临高达 <strong>{stats.drawdowns.p99.toFixed(2)}%</strong> 的最大回撤。
                  </li>
                  <li>
                    策略触发 {ruinThreshold}% 回撤（破产）的概率为 <strong>{currentRiskOfRuin.toFixed(2)}%</strong>。
                    {currentRiskOfRuin > 5 ? (
                      <span style={{ color: 'var(--down)', fontWeight: 600, marginLeft: 8 }}>⚠ 破产风险过高，建议降低单笔仓位大小（或加减杠杆）！</span>
                    ) : (
                      <span style={{ color: 'var(--up)', fontWeight: 600, marginLeft: 8 }}>✓ 破产风险在安全范围内。</span>
                    )}
                  </li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
