'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import './home.css'

// ════════════════════════════════════════════════════════════════════════════
// 类型
// ════════════════════════════════════════════════════════════════════════════

interface Ticker {
  lastPrice: number
  open24h: number
  high24h: number
  low24h: number
  volCcy24h: number  // 24h 成交量（BTC）
}

interface Candle {
  time: number   // 秒时间戳
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface MarketData {
  funding_rates: Record<string, number | null>
  open_interest: { binance_usd?: number | null; okx_btc?: number | null }
  liquidations_24h: { long_usd: number | null; short_usd: number | null }
  prices: Record<string, number | null>
  spread_pct: number | null
  updated_at: number
}

interface MacroData {
  fear_greed: { value: number; label: string; prev?: number } | null
  dxy: number | null
  btc_spx_corr_30d: number | null
  wma200: { value: number; current_price: number; distance_pct: number } | null
  pi_cycle: { sma111: number; sma350x2: number; distance_pct: number; triggered: boolean } | null
  updated_at: number
}

// ════════════════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════════════════

const fmt0 = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US')

const fmtMoney = (n: number | null | undefined, dec = 0) => {
  if (n == null || !isFinite(n)) return '—'
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

const fmtCompact = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

const fmtPct = (n: number | null | undefined, dec = 2) => {
  if (n == null || !isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(dec)}%`
}

const fmtRate = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(3)}%`
}

// 估算流通市值（约 1980 万枚 BTC × 价格）
const estimateMarketCap = (price: number | null | undefined) => {
  if (price == null || !isFinite(price)) return null
  return price * 19_800_000
}

// 恐慌贪婪颜色
const fgColor = (v: number) => {
  if (v <= 25) return 'var(--dn)'
  if (v <= 45) return '#f0b90b'
  if (v <= 55) return 'var(--mu)'
  if (v <= 75) return 'var(--up)'
  return 'var(--up)'
}

// 中性恐惧贪婪标签（如果后端没返回 label 时的兜底）
const fgLabel = (v: number) => {
  if (v <= 25) return '极度恐惧'
  if (v <= 45) return '恐惧'
  if (v <= 55) return '中性'
  if (v <= 75) return '贪婪'
  return '极度贪婪'
}

// ════════════════════════════════════════════════════════════════════════════
// 7 日 K 线小图（SVG 折线）
// ════════════════════════════════════════════════════════════════════════════

function Sparkline({ candles, color }: { candles: Candle[]; color: string }) {
  const W = 800
  const H = 220
  const PAD_T = 10
  const PAD_B = 10

  const { path, area, isUp } = useMemo(() => {
    if (candles.length < 2) {
      return { path: '', area: '', isUp: true }
    }
    const closes = candles.map((c) => c.close)
    const min = Math.min(...closes)
    const max = Math.max(...closes)
    const range = max - min || 1
    const dx = W / (candles.length - 1)
    const points = closes.map((c, i) => {
      const x = i * dx
      const y = PAD_T + (1 - (c - min) / range) * (H - PAD_T - PAD_B)
      return { x, y }
    })
    const path =
      'M ' +
      points
        .map((p, i) => (i === 0 ? `${p.x.toFixed(1)},${p.y.toFixed(1)}` : `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`))
        .join(' ')
    const area =
      `M ${points[0].x.toFixed(1)},${H} ` +
      points.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') +
      ` L ${points[points.length - 1].x.toFixed(1)},${H} Z`
    const isUp = closes[closes.length - 1] >= closes[0]
    return { path, area, isUp }
  }, [candles])

  const stroke = isUp ? 'var(--up)' : 'var(--dn)'
  const fill = isUp ? 'rgba(34,211,160,.14)' : 'rgba(240,89,92,.14)'

  if (!path) {
    return (
      <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mu)', fontSize: 12 }}>
        加载中…
      </div>
    )
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
      <defs>
        <linearGradient id="sparkArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fill} />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkArea)" />
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 恐慌贪婪仪表（半圆环 SVG）
// ════════════════════════════════════════════════════════════════════════════

function FearGreedGauge({ value, label, prev }: { value: number; label: string; prev?: number }) {
  // 整圆周长 ≈ 2π × 42 ≈ 264；这里设 dash 比例反映 value/100
  const circumference = 2 * Math.PI * 42
  const dash = (value / 100) * circumference

  const diff = prev != null ? value - prev : null
  const diffColor = diff == null ? undefined : diff >= 0 ? 'var(--up)' : 'var(--dn)'

  return (
    <div className="sent-body">
      <div className="gauge-wrap">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="7" />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="url(#fgG)"
            strokeWidth="7"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 1s ease-out' }}
          />
          <defs>
            <linearGradient id="fgG" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f0595c" />
              <stop offset="50%" stopColor="#f0b90b" />
              <stop offset="100%" stopColor="#22d3a0" />
            </linearGradient>
          </defs>
        </svg>
        <div className="gauge-num">
          <div className="gauge-big" style={{ color: fgColor(value) }}>{value}</div>
          <div className="gauge-lbl">/ 100</div>
        </div>
      </div>
      <div className="sent-info">
        <div className="sent-label" style={{ color: fgColor(value) }}>{label || fgLabel(value)}</div>
        {diff != null && (
          <div className="sent-sub">
            较昨日 <span style={{ color: diffColor }}>{diff >= 0 ? '+' : ''}{diff}</span>
          </div>
        )}
        <div className="sent-bars">
          <span style={{ background: 'rgba(240,89,92,.4)' }} />
          <span style={{ background: 'rgba(240,89,92,.25)' }} />
          <span style={{ background: 'rgba(240,185,11,.35)' }} />
          <span style={{ background: 'var(--up)' }} />
          <span style={{ background: 'rgba(34,211,160,.3)' }} />
        </div>
        <div className="sent-scale">
          <span>极度恐惧</span>
          <span>极度贪婪</span>
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 功能卡片
// ════════════════════════════════════════════════════════════════════════════

interface FeatureCardProps {
  icon: React.ReactNode
  iconColor: 'acc' | 'up' | 'gld' | 'dn' | 'btc' | 'pur'
  title: string
  desc: string
  cta: string
  href: string
}

function FeatureCard({ icon, iconColor, title, desc, cta, href }: FeatureCardProps) {
  // pur 这种特殊配色需要内联（CSS 没预定义对应 .feat-icon.pur 样式）
  const purpleStyle: React.CSSProperties =
    iconColor === 'pur'
      ? { background: 'rgba(167,139,250,.08)', borderColor: 'rgba(167,139,250,.15)', color: 'var(--pur)' }
      : {}

  return (
    <Link className="feat-card" href={href}>
      <div className={`feat-icon ${iconColor !== 'pur' ? iconColor : ''}`} style={purpleStyle}>
        {icon}
      </div>
      <div className="feat-title">{title}</div>
      <div className="feat-desc">{desc}</div>
      <div className="feat-footer">{cta} →</div>
    </Link>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════════

export default function HomePage() {
  const [ticker, setTicker] = useState<Ticker | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [market, setMarket] = useState<MarketData | null>(null)
  const [macro, setMacro] = useState<MacroData | null>(null)
  const [tf, setTf] = useState<'1D' | '7D' | '1M' | '3M' | '1Y'>('7D')

  // 时间区间 → candles 端点 + 取几根
  const tfMap: Record<typeof tf, { endpoint: string; limit: number }> = useMemo(
    () => ({
      '1D': { endpoint: '15m', limit: 96 },     // 15min × 96 = 1 天
      '7D': { endpoint: '4h', limit: 42 },      // 4h × 42 = 7 天
      '1M': { endpoint: '4h', limit: 180 },     // 4h × 180 = 30 天
      '3M': { endpoint: '1d', limit: 90 },      // 1d × 90 = 90 天
      '1Y': { endpoint: '1d', limit: 365 },     // 1d × 365 = 365 天
    }),
    []
  )

  // ── Ticker（10s 轮询，跟 Header 的频率对齐）──
  const fetchTicker = useCallback(async () => {
    try {
      const res = await fetch('/api/chart/ticker')
      if (!res.ok) return
      setTicker(await res.json())
    } catch { /* 忽略 */ }
  }, [])

  // ── K 线（按 tf 拉取，切换时重新加载）──
  const fetchCandles = useCallback(async () => {
    const { endpoint, limit } = tfMap[tf]
    try {
      const res = await fetch(`/py-api/api/candles/${endpoint}?limit=${limit}`)
      if (!res.ok) return
      const d = await res.json()
      const arr: Candle[] = Array.isArray(d.candles) ? d.candles : []
      setCandles(arr.slice(-limit))
    } catch { /* 忽略 */ }
  }, [tf, tfMap])

  // ── 后端 dashboard（30s / 1h 轮询）──
  const fetchMarket = useCallback(async () => {
    try {
      const res = await fetch('/py-api/api/dashboard/market')
      if (res.ok) setMarket(await res.json())
    } catch { /* 忽略 */ }
  }, [])

  const fetchMacro = useCallback(async () => {
    try {
      const res = await fetch('/py-api/api/dashboard/macro')
      if (res.ok) setMacro(await res.json())
    } catch { /* 忽略 */ }
  }, [])

  useEffect(() => {
    fetchTicker()
    fetchMarket()
    fetchMacro()
    const tickerInt = setInterval(fetchTicker, 10_000)
    const marketInt = setInterval(fetchMarket, 30_000)
    const macroInt = setInterval(fetchMacro, 3600_000)
    return () => {
      clearInterval(tickerInt)
      clearInterval(marketInt)
      clearInterval(macroInt)
    }
  }, [fetchTicker, fetchMarket, fetchMacro])

  useEffect(() => { fetchCandles() }, [fetchCandles])

  // ── 派生展示数据 ──
  const lastPrice = ticker?.lastPrice ?? null
  const change24hPct = useMemo(() => {
    if (!ticker || !ticker.open24h) return null
    return ((ticker.lastPrice - ticker.open24h) / ticker.open24h) * 100
  }, [ticker])
  const change24hAbs = ticker ? ticker.lastPrice - ticker.open24h : null
  const isUp = (change24hPct ?? 0) >= 0
  const marketCap = estimateMarketCap(lastPrice)
  // 振幅 = (24h 最高 - 24h 最低) / 24h 开盘
  const amplitudePct = ticker && ticker.open24h ? ((ticker.high24h - ticker.low24h) / ticker.open24h) * 100 : null
  // 均价 ≈ (high + low + close) / 3（一个粗略代理）
  const avgPrice = ticker ? (ticker.high24h + ticker.low24h + ticker.lastPrice) / 3 : null

  // OKX 资金费率（市场卡里取，作为价格卡的「资金费率」字段）
  const okxFundingRate = market?.funding_rates?.okx ?? null
  // OI 取 Binance（USD）
  const oiUsd = market?.open_interest?.binance_usd ?? null

  return (
    <div className="home-page">
      {/* ════ HERO ════ */}
      <section className="hero">
        <div className="hero-badge">
          <span className="live-dot" style={{ width: 5, height: 5 }} />
          专为 BTC 量化交易者打造
        </div>
        <h1>
          BTC 量化<br />
          <span className="h1-grad">策略工作台</span>
        </h1>
        <p className="hero-sub">
          写策略、一键回测、参数优化。<br />
          全量 OKX 历史数据，专业量化工具，开箱即用。
        </p>
        <div className="hero-ctas">
          <Link className="cta-main" href="/strategy">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><polygon points="1,0.5 8.5,4.5 1,8.5" /></svg>
            开始使用
          </Link>
          <Link className="cta-sec" href="/signup">免费注册</Link>
        </div>
        <div className="hero-proof">
          <span className="proof-item"><span className="ck">✓</span> OKX 全量历史数据</span>
          <span className="proof-item"><span className="ck">✓</span> 4 种参数优化算法</span>
          <span className="proof-item"><span className="ck">✓</span> 导出 xlsx / CSV / TV</span>
          <span className="proof-item"><span className="ck">✓</span> 蒙特卡洛风控分析</span>
        </div>
      </section>

      {/* ════ PRICE CARD ════ */}
      <div className="price-card">
        <div className="pc-top">
          {/* left: price info */}
          <div className="pc-left">
            <div className="pc-symbol">
              <div className="pc-sym-icon">₿</div>
              <span className="pc-sym-name">Bitcoin</span>
              <span className="pc-sym-tag">BTC/USDT</span>
              <span className="pc-sym-tag" style={{ color: 'var(--mu)' }}>永续</span>
            </div>
            <div className="pc-price">
              {lastPrice != null ? (() => {
                const intStr = Math.floor(lastPrice).toLocaleString('en-US')   // "103,247" / "77,513"
                const lastSeg = intStr.slice(-3)                                // "247" / "513"
                const firstSeg = intStr.length > 3 ? intStr.slice(0, -4) : ''  // "103" / "77"
                const dec = ((lastPrice - Math.floor(lastPrice)) * 100).toFixed(0).padStart(2, '0')
                return (
                  <>
                    ${firstSeg}{firstSeg && ','}
                    <span style={{ color: 'var(--mu)' }}>{lastSeg}</span>
                    <span className="dec">.{dec}</span>
                  </>
                )
              })() : (
                '加载中…'
              )}
            </div>
            <div className="pc-change-row">
              {change24hPct != null && (
                <span className={`pc-chg-badge ${isUp ? 'up' : 'dn'}`}>
                  {isUp ? '▲' : '▼'} {fmtPct(change24hPct)}
                </span>
              )}
              {change24hAbs != null && (
                <span className="pc-chg-abs">
                  {change24hAbs >= 0 ? '+' : ''}{fmtMoney(change24hAbs, 2)} 今日
                </span>
              )}
            </div>
            <div className="pc-stats">
              <div className="pc-stat">
                <span className="pc-stat-l">24H 最高</span>
                <span className="pc-stat-v hi">{fmtMoney(ticker?.high24h)}</span>
              </div>
              <div className="pc-stat">
                <span className="pc-stat-l">24H 最低</span>
                <span className="pc-stat-v lo">{fmtMoney(ticker?.low24h)}</span>
              </div>
              <div className="pc-stat">
                <span className="pc-stat-l">24H 成交量</span>
                <span className="pc-stat-v">{fmt0(ticker?.volCcy24h)} BTC</span>
              </div>
              <div className="pc-stat">
                <span className="pc-stat-l">市值</span>
                <span className="pc-stat-v">{fmtCompact(marketCap)}</span>
              </div>
              <div className="pc-stat">
                <span className="pc-stat-l">资金费率</span>
                <span className="pc-stat-v" style={{ color: (okxFundingRate ?? 0) >= 0 ? 'var(--up)' : 'var(--dn)' }}>
                  {fmtRate(okxFundingRate)}
                </span>
              </div>
              <div className="pc-stat">
                <span className="pc-stat-l">未平仓量</span>
                <span className="pc-stat-v">{fmtCompact(oiUsd)}</span>
              </div>
            </div>
          </div>

          {/* right: chart */}
          <div className="pc-right" style={{ minHeight: 220 }}>
            <div className="pc-chart-header">
              <div className="pc-tf-group">
                {(['1D', '7D', '1M', '3M', '1Y'] as const).map((label) => (
                  <button
                    key={label}
                    className={`pc-tf ${tf === label ? 'on' : ''}`}
                    onClick={() => setTf(label)}
                  >{label}</button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--mu)', fontFamily: 'var(--mono)' }}>
                <span className="live-dot" /> 实时
              </div>
            </div>
            <Sparkline candles={candles} color={isUp ? 'up' : 'dn'} />
          </div>
        </div>

        {/* bottom bar */}
        <div className="pc-bottom">
          <div className="pc-meta">
            <div className="pc-meta-item">开盘 <b>{fmtMoney(ticker?.open24h)}</b></div>
            <div className="pc-meta-item">均价 <b>{fmtMoney(avgPrice)}</b></div>
            <div className="pc-meta-item">振幅 <b style={{ color: 'var(--up)' }}>{fmtPct(amplitudePct, 2)}</b></div>
            <div className="pc-meta-item">
              资金费率 <b style={{ color: (okxFundingRate ?? 0) >= 0 ? 'var(--up)' : 'var(--dn)' }}>{fmtRate(okxFundingRate)}</b>
            </div>
          </div>
          <Link className="pc-action" href="/strategy">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor"><polygon points="1,0.5 8.5,4.5 1,8.5" /></svg>
            策略研发
          </Link>
        </div>
      </div>

      {/* ════ FEATURES ════ */}
      <div className="section-label">平台功能</div>
      <div className="feat-grid">
        <FeatureCard
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" /></svg>}
          iconColor="acc"
          title="策略编辑器"
          desc="Python + VectorBT 框架，Monaco 专业代码编辑器，内置双均线、海龟等策略模板，开箱即用。"
          cta="策略研发"
          href="/strategy"
        />
        <FeatureCard
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
          iconColor="up"
          title="一键回测"
          desc="全量 OKX 历史数据，回测完成自动生成交易记录、资金曲线、回撤分析，支持导出 xlsx 报告。"
          cta="开始回测"
          href="/strategy"
        />
        <FeatureCard
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M4.22 4.22l2.12 2.12m11.32 11.32 2.12 2.12M2 12h3m14 0h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" /></svg>}
          iconColor="gld"
          title="参数优化"
          desc="自动识别策略参数，支持网格搜索、模拟退火四种优化算法，导出 TV Assistant 格式 CSV。"
          cta="开始优化"
          href="/strategy"
        />
        <FeatureCard
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z" /></svg>}
          iconColor="dn"
          title="蒙特卡洛风控"
          desc="10,000 次重抽样压力测试，破产概率计算与权益区间扇形图，验证策略真实稳健性。"
          cta="风控分析"
          href="/monte-carlo"
        />
        <FeatureCard
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>}
          iconColor="pur"
          title="参数优化报告"
          desc="基于邻居法的参数高原检测，避开孤峰过拟合陷阱，锁定稳健区间，8 维度过滤排名。"
          cta="查看报告"
          href="/report"
        />
        <FeatureCard
          icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" /></svg>}
          iconColor="btc"
          title="形态归因分析"
          desc="结合六形态等经典 K 线信号，精准溯源策略的利润提款机，分析入场信号质量。"
          cta="归因分析"
          href="/pattern-report"
        />
      </div>

      {/* ════ LOWER GRID: NEWS + SIDEBAR ════ */}
      <div className="lower-grid">
        {/* NEWS（暂为占位：等接 RSS 后再填）*/}
        <div className="news-card">
          <div className="card-head">
            <span className="card-title">市场资讯</span>
            <span className="card-src">
              <span className="live-dot" style={{ width: 4, height: 4 }} />
              开发中
            </span>
          </div>
          <div className="news-filters">
            <button className="news-filter on">全部</button>
            <button className="news-filter">行情</button>
            <button className="news-filter">宏观</button>
            <button className="news-filter">链上</button>
            <button className="news-filter">衍生品</button>
            <button className="news-filter">监管</button>
          </div>
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--mu)', fontSize: 13 }}>
            🛠 市场资讯模块正在接入 CoinDesk / CryptoPanic RSS，敬请期待
          </div>
          <div className="news-foot">
            <span>—</span>
            <span style={{ fontSize: 12, color: 'var(--mu)' }}>暂未对接资讯源</span>
          </div>
        </div>

        {/* SIDEBAR */}
        <div className="sidebar">
          {/* Quick start CTA */}
          <div className="s-card">
            <div className="s-body">
              <div className="cta-card-label">快速开始</div>
              <div className="cta-card-h3">从图表到策略<br />一站式 BTC 量化工作台</div>
              <div className="cta-card-p">多周期 K 线、常用技术指标、参数回测——全部专注 BTC。</div>
              <div className="cta-btns">
                <Link className="btn-row btn-row-prim" href="/strategy">
                  <span className="l">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 6-6" /></svg>
                    打开完整图表
                  </span>
                  <span>→</span>
                </Link>
                <Link className="btn-row btn-row-ghost" href="/strategy">
                  <span className="l">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><polygon points="12 2 15 9 22 9 16.5 13.5 18 21 12 17 6 21 7.5 13.5 2 9 9 9" /></svg>
                    测试一个策略
                  </span>
                  <span className="arr">→</span>
                </Link>
              </div>
            </div>
          </div>

          {/* Sentiment */}
          <div className="s-card">
            <div className="sent-head">
              <span className="card-title">市场情绪</span>
              <span className="sent-src">Alternative.me</span>
            </div>
            {macro?.fear_greed ? (
              <FearGreedGauge
                value={macro.fear_greed.value}
                label={macro.fear_greed.label}
                prev={macro.fear_greed.prev}
              />
            ) : (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--mu)', fontSize: 12 }}>加载中…</div>
            )}
          </div>

          {/* Roadmap */}
          <div className="s-card">
            <div className="road-head">
              <span className="card-title">产品路线图</span>
              <span className="road-phase">Phase 3 · 当前</span>
            </div>
            <div className="road-body">
              <div className="road-item">
                <div className="road-dot done">
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="#22d3a0" strokeWidth={2.5}>
                    <polyline points="1 5 4 8 9 2" />
                  </svg>
                </div>
                <div>
                  <div className="road-title">行情 · 资讯 · 迷你图表</div>
                  <div className="road-sub">Phase 1 · 已完成</div>
                </div>
              </div>
              <div className="road-item">
                <div className="road-dot done">
                  <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="#22d3a0" strokeWidth={2.5}>
                    <polyline points="1 5 4 8 9 2" />
                  </svg>
                </div>
                <div>
                  <div className="road-title">完整 TradingView 图表</div>
                  <div className="road-sub">Phase 2 · 已完成</div>
                </div>
              </div>
              <div className="road-item">
                <div className="road-dot next" />
                <div>
                  <div className="road-title">
                    策略研发与稳健性评估 <span className="badge-pro">Pro</span>
                  </div>
                  <div className="road-sub" style={{ color: 'var(--up)' }}>Phase 3 · 进行中</div>
                </div>
              </div>
              <div className="road-item">
                <div className="road-dot future" />
                <div>
                  <div className="road-title" style={{ color: 'var(--mu)' }}>AI 策略分析与生成</div>
                  <div className="road-sub">Phase 4 · 接入 Agent</div>
                </div>
              </div>
            </div>
          </div>

          {/* Legal */}
          <div className="legal">
            <strong>重要提示 · </strong>本平台仅为交易分析工具，不构成投资建议。所有策略由用户自行编写与选择，盈亏自负。平台不推送信号、不代客理财、不托管资金。
          </div>
        </div>
      </div>
    </div>
  )
}
