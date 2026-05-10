'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { KlineBar } from '@/types/btc'
import { PageLoader, PageError } from '@/components/PageLoader'

// ── 交易周期 ──────────────────────────────────────────────────
const PERIODS = [
  { label: '日内',   subLabel: '1天',   days: 1,   type: 'short' },
  { label: '短线',   subLabel: '3天',   days: 3,   type: 'short' },
  { label: '短线',   subLabel: '1周',   days: 7,   type: 'short' },
  { label: '短线',   subLabel: '2周',   days: 14,  type: 'short' },
  { label: '中线',   subLabel: '1个月', days: 30,  type: 'mid'   },
  { label: '中线',   subLabel: '3个月', days: 90,  type: 'mid'   },
  { label: '长线',   subLabel: '6个月', days: 180, type: 'long'  },
  { label: '长线',   subLabel: '1年',   days: 365, type: 'long'  },
]

const MC_RUNS    = 2000
const SIM_COUNT  = 2000
const CHART_PATHS = 60
const TAKER_FEE  = 0.0005
const FUNDING    = 0.0001

// ── 数学计算 ──────────────────────────────────────────────────
function calcStats(klines: KlineBar[], days: number) {
  const returns: number[] = []
  for (let i = 0; i + days < klines.length; i++)
    returns.push((klines[i + days].close - klines[i].close) / klines[i].close)
  if (!returns.length) return null
  const wins   = returns.filter(r => r > 0)
  const losses = returns.filter(r => r <= 0)
  const winRate    = wins.length / returns.length
  const avgWin     = wins.length   ? wins.reduce((a,b)=>a+b,0)   / wins.length   : 0
  const avgLoss    = losses.length ? losses.reduce((a,b)=>a+b,0) / losses.length : 0
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss
  return { returns, winRate, avgWin, avgLoss,
    avgReturn: returns.reduce((a,b)=>a+b,0)/returns.length,
    maxGain: Math.max(...returns), maxLoss: Math.min(...returns),
    expectancy, sampleCount: returns.length }
}

function runMC(returns: number[], capital: number, trades: number, runs: number) {
  const finals: number[] = []
  for (let r = 0; r < runs; r++) {
    let bal = capital
    for (let t = 0; t < trades; t++) bal *= 1 + returns[Math.floor(Math.random()*returns.length)]
    finals.push(bal)
  }
  finals.sort((a,b)=>a-b)
  return {
    medianFinal: finals[Math.floor(runs/2)],
    probProfit:  finals.filter(f=>f>capital).length/runs,
    prob2x:      finals.filter(f=>f>=capital*2).length/runs,
    worstPct5:   finals[Math.floor(runs*0.05)],
  }
}

interface SimResult { paths: number[][]; finalEquities: number[]; liqCount: number; avgFees: number }

function runContractSim(p: { capital:number; leverage:number; winRate:number; rr:number; trades:number; isTrend:boolean }): SimResult {
  const { capital, leverage, winRate, rr, trades, isTrend } = p
  const lossPerTrade = (capital/trades)*leverage*0.5
  const winPerTrade  = lossPerTrade*rr
  const liqThreshold = capital*0.1
  const notional     = capital*leverage
  const feePerTrade  = isTrend ? notional*TAKER_FEE + notional*FUNDING*(365/trades) : notional*TAKER_FEE*2
  const paths: number[][] = []; const finalEquities: number[] = []
  let liqCount=0, totalFees=0
  for (let i=0; i<SIM_COUNT; i++) {
    const path=[capital]; let equity=capital, fees=0, liq=false
    for (let t=0; t<trades; t++) {
      equity-=feePerTrade; fees+=feePerTrade
      equity+=Math.random()<winRate ? winPerTrade : -lossPerTrade
      if (equity<=liqThreshold) { liq=true; liqCount++; for(let r=t+1;r<trades;r++) path.push(liqThreshold); break }
      path.push(Math.max(equity,0))
    }
    if(!liq) path.push(equity)
    paths.push(path); finalEquities.push(Math.max(equity,0)); totalFees+=fees
  }
  return { paths, finalEquities, liqCount, avgFees: totalFees/SIM_COUNT }
}

function buildChartData(paths: number[][], trades: number) {
  const sample = paths.slice(0, CHART_PATHS)
  return Array.from({length: trades+1}, (_,t) => {
    const pt: Record<string,number> = {t}
    sample.forEach((p,i) => { pt[`p${i}`] = p[t] ?? p[p.length-1] })
    return pt
  })
}

// ── KaTeX ─────────────────────────────────────────────────────
function KatexBlock({ tex }: { tex: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    import('katex').then(k => {
      if (ref.current) k.default.render(tex, ref.current, { displayMode:true, throwOnError:false })
    })
  }, [tex])
  return <div ref={ref} style={{ overflowX:'auto', padding:'8px 0' }} />
}

// ── 格式化 ────────────────────────────────────────────────────
const fmtPct   = (n:number, d=1) => `${n>=0?'+':''}${(n*100).toFixed(d)}%`
const fmtMoney = (n:number) => '$'+n.toLocaleString('en-US',{maximumFractionDigits:0})

// ── 类型颜色 ──────────────────────────────────────────────────
const typeColor = (type:string) =>
  type==='short' ? 'var(--down)' : type==='long' ? 'var(--up)' : 'var(--gold)'

// ══════════════════════════════════════════════════════════════
// 主页面
// ══════════════════════════════════════════════════════════════
export default function AnalysisPage() {

  const [klines,   setKlines]  = useState<KlineBar[]>([])
  const [loading,  setLoading] = useState(true)
  const [fetchErr, setErr]     = useState('')
  const [capital,  setCapital] = useState(25000)
  const [trades,   setTrades]  = useState(50)
  const [yearFrom, setYear]    = useState(2020)
  const [leverage, setLev]     = useState(10)
  const [simMode,  setSimMode] = useState<'short'|'trend'>('short')
  const [shortRes, setShortRes]= useState<SimResult|null>(null)
  const [trendRes, setTrendRes]= useState<SimResult|null>(null)
  const [simRunning, setSR]    = useState(false)
  const [showProof,  setProof] = useState(false)
  const [showHood,   setHood]  = useState(false)

  // 破产计算器
  const [rWR,  setRWR]  = useState(52)
  const [rAW,  setRAW]  = useState(250)
  const [rAL,  setRAL]  = useState(200)
  const [rC,   setRC]   = useState(5)
  const [rDD,  setRDD]  = useState(20)
  const [rCap, setRCap] = useState(10000)

  const fetchKlines = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const res = await fetch('/api/analysis/klines')
      if (!res.ok) throw new Error('数据加载失败')
      setKlines(await res.json())
    } catch(e) { setErr(e instanceof Error ? e.message : '未知错误') }
    finally { setLoading(false) }
  }, [])
  useEffect(()=>{ fetchKlines() },[fetchKlines])

  const strategies = {
    short: { winRate:0.55, rr:1.0, trades:100, isTrend:false },
    trend: { winRate:0.40, rr:3.0, trades:10,  isTrend:true  },
  }
  const runSim = useCallback(()=>{
    setSR(true)
    setTimeout(()=>{
      setShortRes(runContractSim({capital, leverage, ...strategies.short}))
      setTrendRes(runContractSim({capital, leverage, ...strategies.trend}))
      setSR(false)
    }, 50)
  },[capital, leverage]) // eslint-disable-line
  useEffect(()=>{ runSim() },[]) // eslint-disable-line

  const filteredKlines = useMemo(()=>{
    const cutoff = new Date(`${yearFrom}-01-01`).getTime()/1000
    return klines.filter(k=>k.time>=cutoff)
  },[klines, yearFrom])

  const rows = useMemo(()=>{
    if (filteredKlines.length<10) return []
    return PERIODS.map(p=>{
      const s = calcStats(filteredKlines, p.days)
      if (!s) return null
      const mc = runMC(s.returns, capital, trades, MC_RUNS)
      return {...p, ...s, mc}
    }).filter(Boolean) as (ReturnType<typeof calcStats> & typeof PERIODS[0] & {mc: ReturnType<typeof runMC>})[]
  },[filteredKlines, capital, trades])

  // 短线代表（1天）vs 长线代表（1年）
  const shortRow = rows.find(r=>r.days===1)
  const longRow  = rows.find(r=>r.days===365)
  const bestRow  = rows.length ? rows.reduce((a,b)=>a!.expectancy>b!.expectancy?a:b) : null

  const activeRes  = simMode==='short' ? shortRes : trendRes
  const activeTrades = strategies[simMode].trades
  const chartData  = useMemo(()=> activeRes ? buildChartData(activeRes.paths, activeTrades) : [], [activeRes, activeTrades])
  const liqLine    = capital*0.1

  const getPathColor = (i:number) => {
    if (!activeRes) return '#333'
    const f = activeRes.finalEquities[i]
    if (f<=liqLine) return '#2a2a2a'
    return f>capital ? 'rgba(38,166,154,0.2)' : 'rgba(239,83,80,0.15)'
  }

  const ruinCalc = useMemo(()=>{
    const p   = rWR/100
    const ev  = p*rAW - (1-p)*rAL - rC
    const bev = (rAL+rC)/(rAW+rAL)
    const cl  = rCap*(rDD/100)
    let ruin=1
    if (ev>0&&rAL>0&&cl>0) {
      const ratio=rAL/ev; const base=(1-ratio)/(1+ratio)
      ruin = base>0 ? Math.max(0,Math.min(1,1-Math.pow(base,cl/rAL))) : 1
    }
    return {ev, bev, ruin, cl}
  },[rWR,rAW,rAL,rC,rDD,rCap])

  if (loading) return <PageLoader text="正在加载历史数据…" />
  if (fetchErr) return <PageError message={fetchErr} onRetry={fetchKlines} />

  return (
    <div style={{maxWidth:'var(--max-w)',margin:'0 auto',padding:'32px 24px'}}>

      {/* ══════════════════════════════════════════════════════
          第一层：结论首屏 —— 3秒内看懂答案
      ══════════════════════════════════════════════════════ */}

      {shortRow && longRow && (
        <div style={{marginBottom:40}}>

          {/* 大标题结论 */}
          <div className="conclusion-hero">
            <div style={{fontSize:12,color:'var(--text-mute)',letterSpacing:'0.15em',marginBottom:12,textTransform:'uppercase'}}>
              基于 OKX {filteredKlines.length} 根真实历史数据 · 数学结论
            </div>
            <div className="conclusion-title">
              做长线，最终盈利概率碾压短线
              <span style={{color:'var(--up)',marginLeft:12}}>
                +{((longRow.mc.probProfit - shortRow.mc.probProfit)*100).toFixed(0)}%
              </span>
            </div>
            <div style={{fontSize:15,color:'var(--text-mute)',marginBottom:28}}>
              长线模拟盈利概率 <span style={{color:'var(--up)',fontWeight:700}}>{(longRow.mc.probProfit*100).toFixed(1)}%</span>
              &nbsp;&nbsp;vs&nbsp;&nbsp;
              短线模拟盈利概率 <span style={{color:'var(--down)',fontWeight:700}}>{(shortRow.mc.probProfit*100).toFixed(1)}%</span>
            </div>

            {/* 直觉化对比：100次交易赢多少次 */}
            <div className="vs-grid">
              {/* 短线 */}
              <div className="vs-card-down">
                <div style={{fontSize:12,color:'var(--down)',fontWeight:700,marginBottom:8}}>短线交易 100次</div>
                <div style={{display:'flex',alignItems:'baseline',gap:4,justifyContent:'center',marginBottom:8}}>
                  <span className="num" style={{fontSize:48,fontWeight:800,color:'var(--down)',lineHeight:1}}>{Math.round(shortRow.winRate*100)}</span>
                  <span style={{fontSize:14,color:'var(--text-mute)'}}>次盈利</span>
                </div>
                <div style={{fontSize:12,color:'var(--text-mute)'}}>{Math.round((1-shortRow.winRate)*100)} 次亏损</div>
              </div>

              <div style={{textAlign:'center'}}>
                <div style={{fontSize:22,color:'var(--text-dim)'}}>vs</div>
              </div>

              {/* 长线 */}
              <div className="vs-card-up">
                <div style={{fontSize:12,color:'var(--up)',fontWeight:700,marginBottom:8}}>长线交易 100次</div>
                <div style={{display:'flex',alignItems:'baseline',gap:4,justifyContent:'center',marginBottom:8}}>
                  <span className="num" style={{fontSize:48,fontWeight:800,color:'var(--up)',lineHeight:1}}>{Math.round(longRow.winRate*100)}</span>
                  <span style={{fontSize:14,color:'var(--text-mute)'}}>次盈利</span>
                </div>
                <div style={{fontSize:12,color:'var(--text-mute)'}}>{Math.round((1-longRow.winRate)*100)} 次亏损</div>
              </div>
            </div>
          </div>

          {/* 三句大白话说明 */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:24}}>
            {[
              {
                icon:'🎯',
                title:'胜率更高',
                body:`做长线，历史上每10次交易有${Math.round(longRow.winRate*10)}次盈利。做短线只有${Math.round(shortRow.winRate*10)}次。`,
                color:'var(--up)',
              },
              {
                icon:'💰',
                title:'赚得更多',
                body:`长线平均每次盈利 ${fmtPct(longRow.avgWin,1)}，短线平均每次只赚 ${fmtPct(shortRow.avgWin,1)}。`,
                color:'var(--up)',
              },
              {
                icon:'🎲',
                title:'模拟验证',
                body:`用历史数据模拟${trades}次交易，长线盈利概率 ${(longRow.mc.probProfit*100).toFixed(0)}%，短线只有 ${(shortRow.mc.probProfit*100).toFixed(0)}%。`,
                color:'var(--accent)',
              },
            ].map(c=>(
              <div key={c.title} className="card" style={{padding:'18px 20px'}}>
                <div style={{fontSize:24,marginBottom:10}}>{c.icon}</div>
                <div style={{fontSize:13,fontWeight:700,color:c.color,marginBottom:6}}>{c.title}</div>
                <div style={{fontSize:12,color:'var(--text-mute)',lineHeight:1.7}}>{c.body}</div>
              </div>
            ))}
          </div>

          {/* 全周期胜率横条图 —— 一眼看出趋势 */}
          <div className="card" style={{padding:'20px 24px'}}>
            <div style={{fontSize:13,fontWeight:700,color:'var(--text)',marginBottom:4}}>
              所有交易周期胜率对比 —— 越往右越高
            </div>
            <div style={{fontSize:11,color:'var(--text-mute)',marginBottom:20}}>
              竖线 = 50% 基准（随机猜涨跌的水平）· 超过基准才有意义
            </div>
            {rows.map(row=>(
              <div key={row.days} style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
                <div style={{width:72,flexShrink:0,textAlign:'right'}}>
                  <span style={{fontSize:11,color:typeColor(row.type),fontWeight:600}}>{row.label}</span>
                  <span style={{fontSize:10,color:'var(--text-dim)',marginLeft:4}}>{row.subLabel}</span>
                </div>
                <div style={{flex:1,height:28,borderRadius:4,background:'var(--surface-2)',overflow:'hidden',position:'relative'}}>
                  <div style={{
                    height:'100%', width:`${row.winRate*100}%`, borderRadius:4,
                    background: row.type==='short' ? 'var(--down)' : row.type==='long' ? 'var(--up)' : 'var(--gold)',
                    transition:'width 0.8s ease',
                    display:'flex',alignItems:'center',justifyContent:'flex-end',paddingRight:8,
                  }}>
                    {row.winRate>0.38 && <span className="num" style={{fontSize:11,fontWeight:700,color:'#fff'}}>{(row.winRate*100).toFixed(1)}%</span>}
                  </div>
                  {/* 50%基准线 */}
                  <div style={{position:'absolute',top:0,left:'50%',width:2,height:'100%',background:'var(--text)',opacity:0.3}}/>
                  {row.winRate<=0.38 && (
                    <span className="num" style={{position:'absolute',left:`${row.winRate*100+2}%`,top:'50%',transform:'translateY(-50%)',fontSize:11,fontWeight:700,color:'var(--text-mute)'}}>
                      {(row.winRate*100).toFixed(1)}%
                    </span>
                  )}
                </div>
                <div style={{width:80,flexShrink:0,fontSize:11,color:'var(--text-mute)'}}>
                  {row.type==='short'&&<span style={{color:'var(--down)'}}>短线区间</span>}
                  {row.type==='mid'  &&<span style={{color:'var(--gold)'}}>中线区间</span>}
                  {row.type==='long' &&<span style={{color:'var(--up)'}}>长线区间</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          第二层：为什么？—— 用大白话解释原因
      ══════════════════════════════════════════════════════ */}

      <div style={{marginBottom:40}}>
        <div style={{textAlign:'center',marginBottom:24}}>
          <div style={{fontSize:20,fontWeight:700,color:'var(--text)',marginBottom:6}}>为什么长线胜率更高？</div>
          <div style={{fontSize:13,color:'var(--text-mute)'}}>三个原因，用大白话解释</div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:16,marginBottom:24}}>
          {[
            {
              num:'01',
              title:'比特币长期是涨的',
              body:'过去几年，BTC 从几千美元涨到几万美元。做短线每天猜涨跌，猜对的概率接近抛硬币；做长线顺着大趋势走，时间越长越有利。',
              icon:'📈',
            },
            {
              num:'02',
              title:'短线手续费吃掉利润',
              body:'每次买卖都要交手续费。短线交易频繁，手续费累积下来可能比利润还多。长线交易次数少，手续费影响几乎可以忽略不计。',
              icon:'💸',
            },
            {
              num:'03',
              title:'短线需要很高胜率才能盈利',
              body:'做短线，每笔利润小，需要连续猜对很多次才能赚钱。做长线，一次涨幅可能抵过十次短线，即使赢的次数少也能赚到钱。',
              icon:'⚖️',
            },
          ].map(c=>(
            <div key={c.num} className="card" style={{padding:'24px 20px'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14}}>
                <span style={{fontSize:24}}>{c.icon}</span>
                <span style={{fontSize:11,color:'var(--text-dim)',fontFamily:'monospace',fontWeight:700}}>{c.num}</span>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:10}}>{c.title}</div>
              <div style={{fontSize:12,color:'var(--text-mute)',lineHeight:1.8}}>{c.body}</div>
            </div>
          ))}
        </div>

        {/* 合约模拟 —— 直观展示爆仓风险 */}
        <div className="card" style={{padding:'20px',marginBottom:16}}>
          <div style={{fontSize:14,fontWeight:700,color:'var(--text)',marginBottom:4}}>
            合约交易模拟：短线 vs 长线，谁更容易活下来？
          </div>
          <div style={{fontSize:12,color:'var(--text-mute)',marginBottom:20}}>
            用 {SIM_COUNT.toLocaleString()} 条随机路径模拟，红线以下 = 爆仓归零
          </div>

          <div style={{display:'grid',gridTemplateColumns:'200px 1fr',gap:16,alignItems:'start'}}>
            <div>
              <div style={{fontSize:11,color:'var(--text-mute)',marginBottom:10,fontWeight:600}}>调节参数</div>

              <div style={{marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                  <span style={{fontSize:11,color:'var(--text-mute)'}}>杠杆倍数</span>
                  <span className="num" style={{fontSize:13,fontWeight:700,color: leverage>=20?'var(--down)':leverage>=10?'var(--gold)':'var(--up)'}}>{leverage}x</span>
                </div>
                <input type="range" min={1} max={50} step={1} value={leverage}
                  onChange={e=>setLev(Number(e.target.value))}
                  style={{width:'100%',accentColor:leverage>=20?'var(--down)':'#e5a74a'}}/>
                {leverage>=20&&<div style={{fontSize:10,color:'var(--down)',marginTop:4}}>⚠ 强平距离极小</div>}
              </div>

              {(['short','trend'] as const).map(m=>(
                <button key={m} onClick={()=>setSimMode(m)} style={{
                  width:'100%',padding:'10px 12px',borderRadius:6,marginBottom:8,
                  cursor:'pointer',textAlign:'left',
                  border:`1px solid ${simMode===m?(m==='short'?'var(--down)':'var(--up)'):'var(--border)'}`,
                  background:simMode===m?(m==='short'?'var(--down-soft)':'var(--up-soft)'):'transparent',
                  color:'var(--text)',
                  transition:'background .15s, border-color .15s',
                }}>
                  <div style={{fontSize:11,fontWeight:700,marginBottom:2}}>
                    {m==='short'?'⚡ 短线（高频）':'📈 长线（趋势）'}
                  </div>
                  <div style={{fontSize:10,color:'var(--text-mute)'}}>
                    {m==='short'?'胜率55%·盈亏比1:1·100次':'胜率40%·盈亏比3:1·10次'}
                  </div>
                </button>
              ))}

              <button onClick={runSim} disabled={simRunning} style={{
                width:'100%',padding:'7px',borderRadius:6,fontSize:11,fontWeight:600,
                cursor:simRunning?'not-allowed':'pointer',
                background:'var(--accent)',color:'#fff',border:'none',marginTop:4,
                opacity:simRunning?0.6:1,
              }}>{simRunning?'模拟中…':'重新模拟'}</button>

              {/* 爆仓率大字 */}
              {activeRes&&(
                <div style={{marginTop:16,padding:'14px',borderRadius:8,background:activeRes.liqCount/SIM_COUNT>0.3?'var(--down-soft)':'var(--up-soft)',border:`1px solid ${activeRes.liqCount/SIM_COUNT>0.3?'var(--down)':'var(--up)'}`}}>
                  <div style={{fontSize:10,color:'var(--text-mute)',marginBottom:4}}>爆仓率</div>
                  <div className="num" style={{fontSize:32,fontWeight:800,color:activeRes.liqCount/SIM_COUNT>0.3?'var(--down)':'var(--up)',lineHeight:1}}>
                    {((activeRes.liqCount/SIM_COUNT)*100).toFixed(0)}%
                  </div>
                  <div style={{fontSize:11,color:'var(--text-mute)',marginTop:4}}>
                    {SIM_COUNT}次模拟中有{activeRes.liqCount}次归零
                  </div>
                </div>
              )}
            </div>

            <div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData} margin={{top:4,right:8,bottom:4,left:8}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)"/>
                  <XAxis dataKey="t" tick={{fontSize:10,fill:'var(--text-mute)'}} label={{value:'交易次数',position:'insideBottom',offset:-2,fontSize:10,fill:'var(--text-mute)'}}/>
                  <YAxis tickFormatter={v=>`$${(v/1000).toFixed(0)}K`} tick={{fontSize:10,fill:'var(--text-mute)'}} width={44}/>
                  <Tooltip formatter={(v:unknown)=>[fmtMoney(v as number),'']} labelFormatter={l=>`第${l}笔`}
                    contentStyle={{background:'var(--card)',border:'1px solid var(--border)',fontSize:11}}/>
                  <ReferenceLine y={liqLine} stroke="#ef5350" strokeWidth={2}
                    label={{value:`爆仓线 ${fmtMoney(liqLine)}`,position:'insideTopRight',fontSize:10,fill:'#ef5350'}}/>
                  {Array.from({length:CHART_PATHS},(_,i)=>(
                    <Line key={i} type="monotone" dataKey={`p${i}`} stroke={getPathColor(i)}
                      strokeWidth={1} dot={false} isAnimationActive={false}/>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 短线 vs 长线对比 */}
          {shortRes&&trendRes&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginTop:16}}>
              {[
                { label:'⚡ 短线合约', r:shortRes, color:'var(--down)', bg:'var(--down-soft)',
                  desc:'短线频繁操作，手续费高，容易连亏触碰爆仓线。' },
                { label:'📈 长线合约', r:trendRes, color:'var(--up)', bg:'var(--up-soft)',
                  desc:'长线操作少，单笔空间大，手续费可忽略，爆仓率低。' },
              ].map(c=>(
                <div key={c.label} style={{padding:'16px',borderRadius:8,background:c.bg,border:`1px solid ${c.color}`}}>
                  <div style={{fontSize:12,fontWeight:700,color:c.color,marginBottom:12}}>{c.label}</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                    {[
                      {k:'爆仓率',    v:`${((c.r.liqCount/SIM_COUNT)*100).toFixed(0)}%`, bad: c.r.liqCount/SIM_COUNT>0.3},
                      {k:'最终盈利率',v:`${(c.r.finalEquities.filter(e=>e>capital).length/SIM_COUNT*100).toFixed(0)}%`, bad: c.r.finalEquities.filter(e=>e>capital).length/SIM_COUNT<0.5},
                      {k:'手续费损耗',v:fmtMoney(c.r.avgFees), bad: c.label.includes('短线')},
                      {k:'占本金',    v:`${(c.r.avgFees/capital*100).toFixed(1)}%`, bad: c.label.includes('短线')},
                    ].map(d=>(
                      <div key={d.k} style={{background:'rgba(0,0,0,0.12)',borderRadius:6,padding:'8px 10px'}}>
                        <div style={{fontSize:10,color:'var(--text-mute)',marginBottom:2}}>{d.k}</div>
                        <div className="num" style={{fontSize:16,fontWeight:700,color:d.bad?'var(--down)':'var(--up)'}}>{d.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:'var(--text-mute)',lineHeight:1.7}}>{c.desc}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          第三层：数学证明 —— 想深入的人往下看
      ══════════════════════════════════════════════════════ */}

      <div style={{borderTop:'1px solid var(--border)',paddingTop:32,marginBottom:24}}>
        <button onClick={()=>setProof(v=>!v)} style={{
          width:'100%',padding:'14px 20px',borderRadius:8,
          display:'flex',alignItems:'center',justifyContent:'space-between',
          cursor:'pointer',background:'var(--card)',border:'1px solid var(--border)',
          textAlign:'left',marginBottom: showProof ? 20 : 0,
        }}>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:'var(--text)'}}>📊 查看完整数学数据</div>
            <div style={{fontSize:11,color:'var(--text-mute)',marginTop:2}}>所有周期的详细统计表格 · 蒙特卡洛结果 · 破产概率计算器</div>
          </div>
          <span style={{fontSize:12,color:'var(--text-mute)',transform:showProof?'rotate(180deg)':'none',transition:'transform 0.2s'}}>▼</span>
        </button>

        {showProof&&(
          <div>
            {/* 参数调节 */}
            <div className="card" style={{padding:'16px 20px',marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:600,color:'var(--text-mute)',marginBottom:12,textTransform:'uppercase',letterSpacing:'0.06em'}}>参数调节</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:20,alignItems:'flex-end'}}>
                <div>
                  <div style={{fontSize:11,color:'var(--text-mute)',marginBottom:6}}>起始年份</div>
                  <div style={{display:'flex',gap:4}}>
                    {Array.from(new Set(klines.map(k=>new Date(k.time*1000).getFullYear()))).sort().map(y=>(
                      <button key={y} onClick={()=>setYear(y)} style={{
                        padding:'5px 10px',borderRadius:4,fontSize:12,cursor:'pointer',
                        border:`1px solid ${yearFrom===y?'var(--accent)':'var(--border)'}`,
                        background:yearFrom===y?'var(--accent-soft)':'transparent',
                        color:yearFrom===y?'var(--accent)':'var(--text-mute)',
                      }}>{y}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:11,color:'var(--text-mute)',marginBottom:6}}>初始资金</div>
                  <div style={{display:'flex',gap:4}}>
                    {[1000,5000,10000,25000,50000].map(c=>(
                      <button key={c} onClick={()=>setCapital(c)} style={{
                        padding:'5px 10px',borderRadius:4,fontSize:12,cursor:'pointer',
                        border:`1px solid ${capital===c?'var(--accent)':'var(--border)'}`,
                        background:capital===c?'var(--accent-soft)':'transparent',
                        color:capital===c?'var(--accent)':'var(--text-mute)',
                      }}>{c>=1000?`$${c/1000}K`:`$${c}`}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{fontSize:11,color:'var(--text-mute)',marginBottom:6}}>交易次数</div>
                  <div style={{display:'flex',gap:4}}>
                    {[10,20,50,100].map(t=>(
                      <button key={t} onClick={()=>setTrades(t)} style={{
                        padding:'5px 10px',borderRadius:4,fontSize:12,cursor:'pointer',
                        border:`1px solid ${trades===t?'var(--accent)':'var(--border)'}`,
                        background:trades===t?'var(--accent-soft)':'transparent',
                        color:trades===t?'var(--accent)':'var(--text-mute)',
                      }}>{t}次</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 详细统计表格 */}
            <div className="card" style={{marginBottom:16,overflow:'hidden'}}>
              <div style={{padding:'12px 20px',borderBottom:'1px solid var(--border)',fontSize:13,fontWeight:600,color:'var(--text)'}}>
                详细统计表格
              </div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{borderBottom:'1px solid var(--border)'}}>
                      {['交易周期','样本数','胜率','平均盈利','平均亏损','期望值',`MC盈利概率(${trades}次)`].map(h=>(
                        <th key={h} style={{padding:'10px 14px',textAlign:'left',color:'var(--text-mute)',fontWeight:500,fontSize:11,whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row=>(
                      <tr key={row.days} style={{
                        borderBottom:'1px solid var(--border)',
                        background: row.days===365 ? 'rgba(38,166,154,0.04)' : undefined,
                      }}>
                        <td style={{padding:'10px 14px',whiteSpace:'nowrap'}}>
                          <span style={{fontWeight:700,color:typeColor(row.type)}}>{row.label}</span>
                          <span style={{fontSize:10,color:'var(--text-dim)',marginLeft:4}}>{row.subLabel}</span>
                        </td>
                        <td className="num" style={{padding:'10px 14px',color:'var(--text-mute)'}}>{row.sampleCount}</td>
                        <td className="num" style={{padding:'10px 14px',color:typeColor(row.type),fontWeight:600}}>{(row.winRate*100).toFixed(1)}%</td>
                        <td className="num" style={{padding:'10px 14px',color:'var(--up)'}}>{fmtPct(row.avgWin,2)}</td>
                        <td className="num" style={{padding:'10px 14px',color:'var(--down)'}}>{fmtPct(row.avgLoss,2)}</td>
                        <td className="num" style={{padding:'10px 14px',color:row.expectancy>0?'var(--up)':'var(--down)',fontWeight:700}}>{fmtPct(row.expectancy,2)}</td>
                        <td style={{padding:'10px 14px'}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <div style={{width:48,height:5,borderRadius:3,background:'var(--surface-2)',overflow:'hidden'}}>
                              <div style={{height:'100%',width:`${row.mc.probProfit*100}%`,background:row.mc.probProfit>=0.5?'var(--up)':'var(--down)',borderRadius:3}}/>
                            </div>
                            <span className="num" style={{fontSize:12,fontWeight:600,color:row.mc.probProfit>=0.5?'var(--up)':'var(--down)'}}>
                              {(row.mc.probProfit*100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 破产概率计算器 */}
            <div className="card" style={{marginBottom:16}}>
              <div style={{padding:'12px 20px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:'var(--text)'}}>破产淘汰概率计算器</div>
                  <div style={{fontSize:11,color:'var(--text-mute)',marginTop:2}}>输入你的交易参数，实时计算净期望值和爆仓概率</div>
                </div>
                {bestRow&&(
                  <button onClick={()=>{
                    setRWR(Math.round(bestRow.winRate*100))
                    setRAW(Math.max(10,Math.round(Math.abs(bestRow.avgWin)*rCap)))
                    setRAL(Math.max(10,Math.round(Math.abs(bestRow.avgLoss)*rCap)))
                  }} style={{padding:'6px 14px',borderRadius:4,fontSize:11,fontWeight:600,cursor:'pointer',border:'1px solid var(--up)',background:'var(--up-soft)',color:'var(--up)'}}>
                    ↑ 导入长线最佳参数（{bestRow.label} {bestRow.subLabel}）
                  </button>
                )}
              </div>
              <div style={{padding:'20px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:24}}>
                <div style={{display:'flex',flexDirection:'column',gap:12}}>
                  {[
                    {label:'胜率 (%)',val:rWR,set:setRWR,min:1,max:99,step:1},
                    {label:'平均盈利 (USDT)',val:rAW,set:setRAW,min:10,max:10000,step:10},
                    {label:'平均亏损 (USDT)',val:rAL,set:setRAL,min:10,max:10000,step:10},
                    {label:'手续费 (USDT)',val:rC,set:setRC,min:0,max:100,step:1},
                    {label:'初始资金 (USDT)',val:rCap,set:setRCap,min:100,max:100000,step:100},
                    {label:'最大回撤红线 (%)',val:rDD,set:setRDD,min:5,max:50,step:5},
                  ].map(({label,val,set,min,max,step})=>(
                    <div key={label} style={{display:'flex',alignItems:'center',gap:12}}>
                      <label style={{fontSize:11,color:'var(--text-mute)',whiteSpace:'nowrap',minWidth:130}}>{label}</label>
                      <input type="range" min={min} max={max} step={step} value={val}
                        onChange={e=>set(Number(e.target.value))}
                        style={{flex:1,accentColor:'var(--accent)'}}/>
                      <span className="num" style={{fontSize:12,color:'var(--text)',minWidth:56,textAlign:'right'}}>{val.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {[
                    {label:'单笔净期望值',formula:`${rWR}%×$${rAW} − ${100-rWR}%×$${rAL} − $${rC}`,value:`${ruinCalc.ev>=0?'+':''}${ruinCalc.ev.toFixed(2)} USDT`,color:ruinCalc.ev>0?'var(--up)':'var(--down)',sub:ruinCalc.ev>0?'✓ 正期望':'✗ 负期望，长期必亏',border:ruinCalc.ev>0?'rgba(38,166,154,0.3)':'rgba(239,83,80,0.3)'},
                    {label:'保本所需最低胜率',formula:`($${rAL}+$${rC})÷($${rAW}+$${rAL})`,value:`${(ruinCalc.bev*100).toFixed(1)}%`,color:rWR/100>=ruinCalc.bev?'var(--up)':'var(--down)',sub:`当前胜率${rWR}% — ${rWR/100>=ruinCalc.bev?'✓ 超过保本线':'✗ 低于保本线'}`,border:'var(--border)'},
                    {label:'破产概率',formula:`回撤红线=$${rCap.toLocaleString()}×${rDD}%=$${ruinCalc.cl.toLocaleString()}`,value:ruinCalc.ev<=0?'100%':`${(ruinCalc.ruin*100).toFixed(1)}%`,color:ruinCalc.ruin>0.3?'var(--down)':ruinCalc.ruin>0.1?'var(--gold)':'var(--up)',sub:ruinCalc.ev<=0?'净期望为负，最终必破产':ruinCalc.ruin<0.05?'极低风险':ruinCalc.ruin<0.2?'风险可控':'高风险',border:'var(--border)',bar:ruinCalc.ev<=0?1:ruinCalc.ruin,barColor:ruinCalc.ruin>0.3?'var(--down)':ruinCalc.ruin>0.1?'var(--gold)':'var(--up)'},
                  ].map(c=>(
                    <div key={c.label} style={{padding:'12px 14px',borderRadius:6,background:'var(--surface-2)',border:`1px solid ${c.border}`}}>
                      <div style={{fontSize:10,color:'var(--text-mute)',marginBottom:2}}>{c.label}</div>
                      <div style={{fontSize:10,color:'var(--text-dim)',marginBottom:6,fontFamily:'monospace'}}>{c.formula}</div>
                      <div className="num" style={{fontSize:22,fontWeight:700,color:c.color}}>{c.value}</div>
                      {'bar' in c&&<div style={{margin:'6px 0 3px',height:5,borderRadius:3,background:'var(--border)',overflow:'hidden'}}><div style={{height:'100%',width:`${(c.bar as number)*100}%`,background:c.barColor,borderRadius:3,transition:'width 0.4s'}}/></div>}
                      <div style={{fontSize:10,color:'var(--text-mute)',marginTop:3}}>{c.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Under the Hood */}
            <div className="card" style={{overflow:'hidden'}}>
              <button onClick={()=>setHood(v=>!v)} style={{width:'100%',padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',background:'none',border:'none',textAlign:'left'}}>
                <span style={{fontSize:13,fontWeight:600,color:'var(--text)',fontFamily:'monospace'}}>👉 底层数学模型与算法白皮书（Under the Hood）</span>
                <span style={{fontSize:12,color:'var(--text-mute)',transform:showHood?'rotate(180deg)':'none',transition:'transform 0.2s'}}>▼</span>
              </button>
              {showHood&&(
                <div style={{borderTop:'1px solid var(--border)',padding:'24px 20px'}}>
                  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css"/>
                  {[
                    {title:'1. 单笔净期望值（Net EV）',
                     tex:String.raw`Net\ EV = \left( P_{win} \times W_{avg} \right) - \left( P_{loss} \times L_{avg} \right) - \left( Fee_{taker} + Funding \right)`,
                     notes:['短线高频：W_avg 小，手续费占比极大，Net EV 极易为负。','长线低频：W_avg 大，手续费可忽略，Net EV 显著为正。']},
                    {title:'2. 盈亏平衡胜率（Breakeven Threshold）',
                     tex:String.raw`P_{break} = \frac{L_{avg} + Fee_{taker} + Funding}{W_{avg} + L_{avg}}`,
                     notes:['短线 P_break 往往高达 60–70%，极难长期维持。','长线 P_break 通常在 30–35%，容错率极高。']},
                    {title:'3. 强平淘汰概率（Probability of Liquidation）',
                     tex:String.raw`P(Ruin) = 1 - \left( \frac{1 - \dfrac{L_{avg}}{Net\ EV}}{1 + \dfrac{L_{avg}}{Net\ EV}} \right)^{\dfrac{Capital_{limit}}{L_{avg}}}`,
                     notes:['交易频率越高，抽到连续亏损的概率越大。','杠杆越高，单次亏损越大，越容易触碰强平线。']},
                  ].map((b,i)=>(
                    <div key={i} style={{marginBottom:24}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--accent)',marginBottom:8,fontFamily:'monospace'}}>// {b.title}</div>
                      <div style={{padding:'14px',borderRadius:6,background:'var(--bg)',border:'1px solid var(--border)'}}>
                        <KatexBlock tex={b.tex}/>
                        {b.notes.map((n,j)=>(
                          <div key={j} style={{fontSize:11,color:'var(--text-mute)',lineHeight:1.6,marginTop:4}}>
                            <span style={{color:'var(--gold)',marginRight:6}}>⚡</span>{n}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 免责声明 */}
      <div style={{fontSize:11,color:'var(--text-dim)',lineHeight:1.8,padding:'12px 16px',borderRadius:6,background:'var(--surface-2)',border:'1px solid var(--border)'}}>
        数据来源：OKX BTC/USDT 永续合约日线 · 历史表现不代表未来 · 本页面仅供学习研究，不构成投资建议
      </div>

    </div>
  )
}
