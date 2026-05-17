'use client'

import React, { useState, useRef, useMemo, useEffect } from 'react'
import * as XLSX from 'xlsx'
import ReactECharts from 'echarts-for-react'

// ── Types ───────────────────────────────────────────────────────────────────

interface Trade {
  id: number
  profitUSDT: number
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

  const [simulations, setSimulations] = useState<MCSimulation[]>([])
  const [stats, setStats] = useState<MCStats | null>(null)
  const [originalStats, setOriginalStats] = useState<{ returnPct: number; maxDrawdownPct: number } | null>(null)
  
  const [isComputing, setIsComputing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadTrades = (trades: Trade[], name: string) => {
    setFileName(name)
    setFileData(trades)
    setSimulations([])
    setStats(null)
    
    // 计算原始回测结果
    let peak = initialCapital
    let current = initialCapital
    let maxDd = 0
    trades.forEach(t => {
      current += t.profitUSDT
      if (current > peak) peak = current
      const dd = (peak - current) / peak * 100
      if (dd > maxDd) maxDd = dd
    })
    setOriginalStats({
      returnPct: (current - initialCapital) / initialCapital * 100,
      maxDrawdownPct: maxDd
    })
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
  }, [initialCapital]) // 依赖 initialCapital，当加载时重新计算原始曲线

  // 1. 解析 Excel/CSV
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    
    const reader = new FileReader()
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      
      // 寻找交易清单 Sheet (CSV 只有一张表，可能不叫交易清单)
      let sheetName = workbook.SheetNames.find(n => n.includes('交易清单') || n.includes('List of Trades'))
      if (!sheetName) {
        if (workbook.SheetNames.length === 1 || file.name.endsWith('.csv')) {
          sheetName = workbook.SheetNames[0]
        } else {
          alert('未找到 "交易清单" 或 "List of Trades" 工作表。请确保上传的是 TradingView 完整的回测导出文件。')
          return
        }
      }

      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json(sheet) as any[]
      
      // 过滤出所有“出场”记录（TradingView 的利润结算在出场时）
      const exitRows = rows.filter(r => {
        const type = String(r['类型'] || r['Type'] || '')
        return type.includes('出场') || type.includes('Exit')
      })

      const trades: Trade[] = exitRows.map((r, i) => {
        // 尝试获取绝对利润 (USDT / USD / 任意计价货币)
        let profit = r['净损益 USDT'] ?? r['Net Profit USDT'] ?? r['净损益 USD'] ?? r['Net Profit USD'] ?? r['净损益'] ?? r['Net Profit']
        if (typeof profit === 'string') profit = parseFloat(profit.replace(/[^\d.-]/g, ''))
        return {
          id: i + 1,
          profitUSDT: Number(profit) || 0
        }
      })

      if (trades.length === 0) {
        alert('解析失败：未能从工作表中提取到交易利润数据。')
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
    
    // 使用 setTimeout 避免阻塞 UI 渲染
    setTimeout(() => {
      const nTrades = fileData.length
      const sims: MCSimulation[] = []
      
      for (let i = 0; i < numSimulations; i++) {
        let currentEquity = initialCapital
        let peakEquity = initialCapital
        let maxDrawdown = 0
        
        // 降低扇形图的渲染压力，只保存少量曲线用于绘图
        const saveCurve = i < 100 // 只保存 100 条用于画扇形图
        const curve = saveCurve ? [initialCapital] : []

        for (let j = 0; j < nTrades; j++) {
          // 有放回随机抽样 (Bootstrapping)
          const randomIdx = Math.floor(Math.random() * nTrades)
          const trade = fileData[randomIdx]
          
          currentEquity += trade.profitUSDT
          if (saveCurve) curve.push(currentEquity)
          
          if (currentEquity > peakEquity) peakEquity = currentEquity
          
          // 若当前权益 <= 0，已爆仓
          if (currentEquity <= 0) {
            maxDrawdown = 100
            currentEquity = 0
            if (saveCurve) {
              // 填充剩余曲线为 0
              for (let k = j + 1; k < nTrades; k++) curve.push(0)
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
    }, 50)
  }

  // 3. 图表配置
  const fanChartOption = useMemo(() => {
    if (simulations.length === 0) return {}
    
    // 提取保存的曲线
    const savedSims = simulations.filter(s => s.curve.length > 0)
    if (savedSims.length === 0) return {}
    
    const xData = Array.from({ length: fileData.length + 1 }, (_, i) => i)
    
    // 计算 5%, 50%, 95% 分位数曲线
    const p5Curve = []
    const p50Curve = []
    const p95Curve = []
    
    for (let step = 0; step <= fileData.length; step++) {
      const stepVals = savedSims.map(s => s.curve[step]).sort((a, b) => a - b)
      p5Curve.push(stepVals[Math.floor(stepVals.length * 0.05)])
      p50Curve.push(stepVals[Math.floor(stepVals.length * 0.50)])
      p95Curve.push(stepVals[Math.floor(stepVals.length * 0.95)])
    }

    return {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      xAxis: { type: 'category', data: xData, boundaryGap: false },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,0.05)' } } },
      series: [
        {
          name: 'P95 (乐观)', type: 'line', data: p95Curve,
          lineStyle: { opacity: 0 }, showSymbol: false,
        },
        {
          name: 'P5 (悲观)', type: 'line', data: p5Curve,
          lineStyle: { opacity: 0 }, showSymbol: false,
          areaStyle: { color: 'rgba(38,166,154,0.15)', origin: 'start' }, // 填充 P5 到 P95
          fillTo: 'P95 (乐观)' // 仅 ECharts 5.4+ 支持更复杂的带状，这里用堆叠或透明带简化
        },
        {
          name: '中位数 (P50)', type: 'line', data: p50Curve,
          lineStyle: { color: '#00d4ff', width: 2 }, showSymbol: false, z: 10
        }
      ]
    }
  }, [simulations, fileData])

  const ddHistOption = useMemo(() => {
    if (simulations.length === 0) return {}
    
    // 将所有 maxDrawdown 放入 0-100 的桶中
    const bins = Array(20).fill(0) // 0-5, 5-10, ...
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
              // 超过用户设定的阈值标红
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
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px', fontFamily: "'Space Grotesk', system-ui, sans-serif", color: '#d1d4dc' }}>
      
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, color: '#fff', marginBottom: 8, letterSpacing: '-0.02em' }}>
          蒙特卡洛压力测试 (Monte Carlo)
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.6, maxWidth: 800 }}>
          蒙特卡洛模拟用于评估量化策略的**统计鲁棒性**。它通过**随机打乱（Bootstrapping）**历史交易序列，生成成千上万条可能的未来资金曲线。这能帮你甄别：你的历史收益是因为策略本身有效，还是仅仅因为行情的出现顺序恰好对你有利？<br/>
          上传从 TradingView 导出的 <strong>回测结果 Excel/CSV（包含“交易清单”表）</strong>，即可验证策略在极端环境下的抗风险能力。
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'start' }}>
        
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
              <span style={{ fontSize: 13, color: '#00d4ff', fontWeight: 600 }}>上传 TV 导出文件 (.xlsx / .csv)</span>
              <span style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4, textAlign: 'center' }}>{fileName || '支持 TradingView 完整表现报告'}</span>
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
                若回撤超过此值，视为账户“破产”
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
                  value={<span style={{ color: stats.riskOfRuin > 10 ? 'var(--down)' : 'var(--up)' }}>{stats.riskOfRuin.toFixed(2)}%</span>} 
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
                    策略触发 {ruinThreshold}% 回撤（破产）的概率为 <strong>{stats.riskOfRuin.toFixed(2)}%</strong>。
                    {stats.riskOfRuin > 5 ? (
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
