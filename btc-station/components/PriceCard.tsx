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
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--bg-elev)' }}>
      {/* Topbar — TradingView 风格 */}
      <div style={{
        height: 40, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 0,
        background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)',
      }}>
        {/* 交易对 + 价格 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, marginRight: 4, borderRight: '1px solid var(--border)', flexShrink: 0 }}>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-.02em', color: 'var(--btc)' }}>BTC/USDT</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)' }}>永续</span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 15, fontWeight: 600, marginLeft: 4 }}>{intPart}<span style={{ color: 'var(--text-mute)' }}>.{decPart}</span></span>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 500, color: isUp ? 'var(--up)' : 'var(--down)' }}>
            {isUp ? '+' : ''}{formatPercent(summary.change24h)}
          </span>
        </div>
        {/* OHLC */}
        <div style={{ display: 'flex', gap: 12, padding: '0 12px', marginRight: 4, borderRight: '1px solid var(--border)', flexShrink: 0 }}>
          {[
            { label: '开', val: summary.price > 0 && summary.change24h !== 0 ? (summary.price / (1 + summary.change24h / 100)).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—', color: 'var(--text)' },
            { label: '高', val: summary.high24h > 0 ? summary.high24h.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—', color: 'var(--up)' },
            { label: '低', val: summary.low24h > 0 ? summary.low24h.toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—', color: 'var(--down)' },
            { label: '量', val: summary.volume24h > 0 ? formatVolume(summary.volume24h) : '—', color: 'var(--text)' },
          ].map(({ label, val, color }) => (
            <span key={label} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)', whiteSpace: 'nowrap' }}>
              {label} <b style={{ color, fontWeight: 500 }}>{val}</b>
            </span>
          ))}
        </div>
        {/* 时间框架 */}
        <div style={{ display: 'flex', gap: 1, marginLeft: 4 }}>
          {['1D', '3D', '7D', '1M', '3M', '1Y'].map(t => (
            <button key={t} onClick={() => onTfChange(t)} style={{
              padding: '3px 8px', borderRadius: 3, fontFamily: 'var(--mono)', fontSize: 11,
              color: tf === t ? 'var(--accent)' : 'var(--text-mute)',
              background: tf === t ? 'rgba(0,212,255,.1)' : 'transparent',
              fontWeight: tf === t ? 600 : 400,
              border: 'none', cursor: 'pointer', transition: '.12s',
            }}>{t}</button>
          ))}
        </div>
        {/* 右侧 */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mute)', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span className="live-dot" />实时
          </span>
          <Link href="/strategy" className="btn btn-primary" style={{ height: 24, fontSize: 11, padding: '0 10px' }}>
            ▶ 运行策略
          </Link>
        </div>
      </div>

      {/* Chart */}
      <div className="chart-wrap">
        <AreaChart klines={klines} />
        <div className="x-axis mono">
          {xLabels.map((label, i) => <span key={i}>{label}</span>)}
        </div>
      </div>

      {/* 底部统计条 */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-elev)', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, fontFamily: 'var(--mono)', fontSize: 11 }}>
          <span style={{ color: 'var(--text-mute)' }}>7日 <span style={{ color: change7d >= 0 ? 'var(--up)' : 'var(--down)' }}>{formatPercent(change7d)}</span></span>
          <span style={{ color: 'var(--text-mute)' }}>波动率 <span style={{ color: 'var(--text)' }}>{volStr}</span></span>
          <span style={{ color: 'var(--text-mute)' }}>夏普 <span style={{ color: 'var(--gold)' }}>{sharpeStr}</span></span>
          {cgData?.dominance ? <span style={{ color: 'var(--text-mute)' }}>BTC占比 <span style={{ color: 'var(--accent)' }}>{cgData.dominance.toFixed(1)}%</span></span> : null}
        </div>
      </div>
    </div>
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
