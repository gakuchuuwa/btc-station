'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { formatUsd, formatPercent, formatVolume } from '@/lib/format'
import type { BtcSummary, KlineBar } from '@/types/btc'

interface Props {
  summary: BtcSummary
  klines: KlineBar[]
  isUp: boolean
  tf: string
  onTfChange: (tf: string) => void
}

export default function PriceCard({ summary, klines, isUp, tf, onTfChange }: Props) {
  const [cgData, setCgData] = useState<{ ath: number; dominance: number } | null>(null)

  useEffect(() => {
    fetch('https://api.coingecko.com/api/v3/global')
      .then(r => r.json())
      .then(d => setCgData(p => ({ ...p, dominance: d?.data?.market_cap_percentage?.btc || 0 } as any)))
      .catch(() => {})
    fetch('https://api.coingecko.com/api/v3/coins/bitcoin?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false')
      .then(r => r.json())
      .then(d => setCgData(p => ({ ...p, ath: d?.market_data?.ath?.usd || 0 } as any)))
      .catch(() => {})
  }, [])
  // 价格拆成整数部分和小数部分，保持设计稿的 .decimals 样式
  const priceFormatted = summary.price > 0
    ? summary.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—'
  const [intPart, decPart] = priceFormatted.includes('.')
    ? priceFormatted.split('.')
    : [priceFormatted, '00']

  // 24h 绝对变化额
  const priceChange = summary.price > 0 && summary.change24h !== 0
    ? summary.price - summary.price / (1 + summary.change24h / 100)
    : 0

  // 7日涨跌幅
  const change7d = klines.length >= 2
    ? (klines[klines.length - 1].close - klines[0].close) / klines[0].close * 100
    : 0

  // 计算波动率和夏普
  let volStr = '—'
  let sharpeStr = '—'
  if (klines.length > 2) {
    const returns = []
    for (let i = 1; i < klines.length; i++) {
      returns.push((klines[i].close - klines[i - 1].close) / klines[i - 1].close)
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length
    const stdDev = Math.sqrt(variance)
    
    const periodsPerYear = tf === '1D' ? 365 * 96 : tf === '3D' ? 365 * 24 : tf === '7D' ? 365 * 6 : 365
    const annVol = stdDev * Math.sqrt(periodsPerYear)
    const annReturn = mean * periodsPerYear
    const sharpe = annVol > 0 ? (annReturn - 0.04) / annVol : 0
    
    volStr = (annVol * 100).toFixed(2) + '%'
    sharpeStr = sharpe.toFixed(2)
  }

  // X轴日期标签
  const xLabels = klines.length >= 7
    ? klines.map(k => {
        const d = new Date(k.time * 1000)
        return `${d.getMonth() + 1}月${d.getDate()}`
      })
    : ['4月17', '4月18', '4月19', '4月20', '4月21', '4月22', '4月23', '今日']

  return (
    <section className="card">
      <div className="hero-top">
        <div className="hero-left">
          <div className="pair">
            <div className="pair-icon">₿</div>
            <span style={{ fontSize: 13, fontWeight: 500 }}>BTC / USDT</span>
            <span className="chip chip-neutral">Spot</span>
            <span className="chip chip-neutral">OKX</span>
          </div>
          <div className="big-price num">
            {intPart}<span className="decimals">.{decPart}</span>{' '}
            <span style={{ fontSize: 13, color: 'var(--text-mute)', fontWeight: 400 }}>USDT</span>
          </div>
          <div className="change-row">
            <span className={`chip ${isUp ? 'chip-up' : 'chip-down'}`}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor">
                {isUp ? <path d="M5 1.5l3.5 5h-7z"/> : <path d="M5 8.5l3.5-5h-7z"/>}
              </svg>
              <span className="num">{formatPercent(summary.change24h)}</span>
            </span>
            <span className={`${isUp ? 'up' : 'down'} num`} style={{ fontSize: 13 }}>
              {priceChange !== 0 ? `${isUp ? '+' : ''}${priceChange.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
            </span>
            <span className="text-dim" style={{ fontSize: 12 }}>· 24h</span>
          </div>
        </div>

        <div className="hero-stats">
          <div className="stat"><div className="section-label">24h 最高</div><div className="stat-val num">{summary.high24h > 0 ? summary.high24h.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div></div>
          <div className="stat"><div className="section-label">24h 最低</div><div className="stat-val num">{summary.low24h > 0 ? summary.low24h.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div></div>
          <div className="stat"><div className="section-label">24h 成交额</div><div className="stat-val num">{summary.volume24h > 0 ? formatVolume(summary.volume24h) : '—'}</div></div>
          <div className="stat"><div className="section-label">市值</div><div className="stat-val num">{summary.marketCap > 0 ? formatVolume(summary.marketCap) : '—'}</div></div>
          <div className="stat"><div className="section-label">开盘</div><div className="stat-val num dim">{summary.price > 0 && summary.change24h !== 0 ? (summary.price / (1 + summary.change24h / 100)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}</div></div>
          <div className="stat"><div className="section-label">流通</div><div className="stat-val num dim">{summary.price > 0 && summary.marketCap > 0 ? (summary.marketCap / summary.price / 1_000_000).toFixed(2) + 'M' : '—'}</div></div>
          <div className="stat"><div className="section-label">占比</div><div className="stat-val num dim">{cgData?.dominance ? cgData.dominance.toFixed(1) + '%' : '—'}</div></div>
          <div className="stat"><div className="section-label">ATH</div><div className="stat-val num dim">{cgData?.ath ? cgData.ath.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—'}</div></div>
        </div>
      </div>

      {/* Chart toolbar */}
      <div className="chart-toolbar">
        <div className="tf-group">
          {['1D', '3D', '7D', '1M', '3M', '1Y'].map(t => (
            <button key={t} className={`tf-btn ${tf === t ? 'active' : ''}`} onClick={() => onTfChange(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="chart-tools">
          <button><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>指标</button>
          <button><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v16H4z"/></svg>图表类型</button>
          <Link href="/chart"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M8 7h9v9"/></svg>完整图表</Link>
        </div>
      </div>

      {/* Chart — 用 Canvas 替换静态 SVG，颜色和填充风格与设计稿一致 */}
      <div className="chart-wrap">
        <AreaChart klines={klines} />
        <div className="x-axis mono">
          {xLabels.map((label, i) => <span key={i}>{label}</span>)}
        </div>
      </div>

      {/* CTA strip */}
      <div className="cta-strip">
        <div className="cta-metrics">
          <span className="m">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#26A69A" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 6-6"/></svg>
            <span>7日 <span className={`${change7d >= 0 ? 'up' : 'down'} num`}>{formatPercent(change7d)}</span></span>
          </span>
          <span className="m"><span>波动率</span><span className="m-val num">{volStr}</span></span>
          <span className="m"><span>夏普率</span><span className="m-val num">{sharpeStr}</span></span>
        </div>
        <div className="cta-actions">
          <Link href="/strategy" className="btn btn-ghost btn-lg">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 15 9 22 9 16.5 13.5 18 21 12 17 6 21 7.5 13.5 2 9 9 9"/></svg>
            运行策略
          </Link>
          <Link href="/chart" className="btn btn-primary btn-lg">打开完整图表 →</Link>
        </div>
      </div>
    </section>
  )
}

// Canvas area chart — 颜色 #26A69A，渐变填充，风格与设计稿一致
function AreaChart({ klines }: { klines: KlineBar[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || klines.length < 2) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.offsetWidth
    const h = canvas.offsetHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)

    const closes = klines.map(d => d.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const range = max - min || 1

    const px = (i: number) => (i / (closes.length - 1)) * w
    const py = (v: number) => h - ((v - min) / range) * (h * 0.82) - h * 0.05

    // 水平网格线（与设计稿一致）
    ctx.strokeStyle = 'rgba(255,255,255,0.035)'
    ctx.lineWidth = 1
    ;[0.15, 0.38, 0.62, 0.85].forEach(r => {
      ctx.beginPath(); ctx.moveTo(0, h * r); ctx.lineTo(w, h * r); ctx.stroke()
    })

    // 渐变填充
    const grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, 'rgba(38,166,154,0.28)')
    grad.addColorStop(0.6, 'rgba(38,166,154,0.06)')
    grad.addColorStop(1, 'rgba(38,166,154,0)')
    ctx.beginPath()
    ctx.moveTo(px(0), h)
    ctx.lineTo(px(0), py(closes[0]))
    closes.forEach((v, i) => ctx.lineTo(px(i), py(v)))
    ctx.lineTo(px(closes.length - 1), h)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // 折线
    ctx.beginPath()
    ctx.moveTo(px(0), py(closes[0]))
    closes.forEach((v, i) => ctx.lineTo(px(i), py(v)))
    ctx.strokeStyle = '#26A69A'
    ctx.lineWidth = 1.5
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.stroke()

    // 末端光点
    const ex = px(closes.length - 1)
    const ey = py(closes[closes.length - 1])
    ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2)
    ctx.fillStyle = '#26A69A'; ctx.fill()
    ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(38,166,154,0.25)'; ctx.fill()
  }, [klines])

  if (klines.length < 2) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-mute)', fontSize: 13 }}>
        图表加载中...
      </div>
    )
  }

  return <canvas ref={canvasRef} style={{ width: '100%', height: 280, display: 'block' }} />
}
