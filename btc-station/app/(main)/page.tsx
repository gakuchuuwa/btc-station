'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import PriceCard from '@/components/PriceCard'
import NewsFeed from '@/components/NewsFeed'
import Sidebar from '@/components/Sidebar'
import { PageLoader } from '@/components/PageLoader'
import type { BtcSummary, KlineBar, NewsItem } from '@/types/btc'

const EMPTY_SUMMARY: BtcSummary = {
  price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, marketCap: 0,
}

const FEATURES = [
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
    title: '策略编辑器',
    desc: 'Python + VectorBT 框架，Monaco 专业代码编辑器，内置双均线、海龟等策略模板，开箱即用。',
    color: 'var(--accent)',
    href: '/strategy',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
      </svg>
    ),
    title: '一键回测',
    desc: '全量 OKX 历史数据，回测完成自动生成交易记录、资金曲线、回撤分析，支持导出 xlsx 报告。',
    color: 'var(--up)',
    href: '/strategy',
  },
  {
    icon: (
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M4.22 4.22l2.12 2.12m11.32 11.32 2.12 2.12M2 12h3m14 0h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
      </svg>
    ),
    title: '参数优化',
    desc: '自动识别策略参数，支持网格搜索、随机搜索、模拟退火、粒子群四种优化算法，导出 TV Assistant 格式 CSV。',
    color: 'var(--gold)',
    href: '/strategy',
  },
]

export default function HomePage() {
  const [summary, setSummary] = useState<BtcSummary>(EMPTY_SUMMARY)
  const [klines, setKlines] = useState<KlineBar[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tf, setTf] = useState('7D')

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/btc/summary')
      if (res.ok) setSummary(await res.json())
    } catch { /* silent */ }
  }, [])

  const fetchKlines = useCallback(async () => {
    try {
      const res = await fetch(`/api/btc/klines?tf=${tf}`)
      if (res.ok) setKlines(await res.json())
    } catch { /* silent */ }
  }, [tf])

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news')
      if (res.ok) setNews(await res.json())
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    Promise.all([fetchSummary(), fetchKlines(), fetchNews()]).finally(() => setLoading(false))
  }, [fetchSummary, fetchKlines, fetchNews])

  useEffect(() => { const id = setInterval(fetchSummary, 30_000); return () => clearInterval(id) }, [fetchSummary])
  useEffect(() => { const id = setInterval(fetchNews, 300_000); return () => clearInterval(id) }, [fetchNews])

  if (loading) return <PageLoader text="加载中…" />

  const isUp = summary.change24h >= 0

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 0' }}>

      {/* ══ Hero ══ */}
      <section style={{ padding: '40px 0 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 12px', borderRadius: 20, marginBottom: 20,
            background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.2)',
            fontSize: 11, color: 'var(--accent)', fontWeight: 600, letterSpacing: '0.06em',
            fontFamily: 'var(--mono)',
          }}>
            <span className="live-dot" />
            专为 BTC 量化交易者打造
          </div>

          <h1 style={{
            fontSize: 44, fontWeight: 700, lineHeight: 1.15,
            color: 'var(--text)', margin: '0 0 14px',
            letterSpacing: '-0.03em', fontFamily: 'var(--sans)',
          }}>
            BTC 量化
            <span style={{
              background: 'linear-gradient(135deg, var(--up) 0%, var(--accent) 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}> 策略工作台</span>
          </h1>

          <p style={{
            fontSize: 14, color: 'var(--text-mute)', lineHeight: 1.7,
            margin: '0 auto 28px', maxWidth: 520,
          }}>
            写策略、一键回测、参数优化。全量 OKX 历史数据，TV 风格界面，专业量化工具。
          </p>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Link href="/strategy" style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '9px 24px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              background: 'linear-gradient(135deg,rgba(0,212,255,.12),rgba(0,212,255,.04))',
              border: '1px solid rgba(0,212,255,.3)',
              color: 'var(--accent)', textDecoration: 'none',
              fontFamily: 'var(--mono)', letterSpacing: '.04em',
              transition: '.2s',
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,212,255,.18)'; e.currentTarget.style.boxShadow = '0 0 16px rgba(0,212,255,.15)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg,rgba(0,212,255,.12),rgba(0,212,255,.04))'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="2,1 9,5 2,9"/></svg>
              开始使用
            </Link>
            <Link href="/signup" style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              padding: '9px 24px', borderRadius: 6, fontSize: 13, fontWeight: 500,
              background: 'transparent', color: 'var(--text)',
              border: '1px solid var(--border)', textDecoration: 'none',
              transition: '.15s',
            }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--text-mute)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              免费注册
            </Link>
          </div>

          <div style={{ display: 'flex', gap: 20, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
            {['OKX 全量历史数据', '4 种优化算法', '导出 xlsx / CSV'].map(t => (
              <span key={t} style={{ fontSize: 11, color: 'var(--text-mute)', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--mono)' }}>
                <span style={{ color: 'var(--up)' }}>✓</span> {t}
              </span>
            ))}
          </div>
        </div>

        {/* 行情卡片 */}
        <PriceCard summary={summary} klines={klines} isUp={isUp} tf={tf} onTfChange={setTf} />
      </section>

      {/* ══ 功能三栏 ══ */}
      <section style={{ margin: '48px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {FEATURES.map((f, i) => (
            <Link key={i} href={f.href} style={{
              padding: '20px 20px', borderRadius: 6,
              background: 'var(--bg-elev)', border: '1px solid var(--border)',
              borderLeft: '2px solid transparent',
              transition: 'border-color .2s, border-left-color .2s, padding-left .2s',
              display: 'block', textDecoration: 'none',
            }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = 'rgba(0,212,255,.2)'
                e.currentTarget.style.borderLeftColor = 'rgba(0,212,255,.6)'
                e.currentTarget.style.paddingLeft = '18px'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.borderLeftColor = 'transparent'
                e.currentTarget.style.paddingLeft = '20px'
              }}
            >
              <div style={{ color: f.color, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>{f.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.65 }}>{f.desc}</div>
            </Link>
          ))}
        </div>

        {/* 高阶分析套件入口 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
          {/* 蒙特卡洛 */}
          <Link href="/monte-carlo" style={{
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            padding: '16px 20px', borderRadius: 6,
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderLeft: '2px solid transparent', textDecoration: 'none',
            transition: 'border-color .2s, border-left-color .2s',
          }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(239,83,80,.3)'
              e.currentTarget.style.borderLeftColor = 'rgba(239,83,80,.7)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.borderLeftColor = 'transparent'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ color: 'var(--down)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z"/>
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>蒙特卡洛风控</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.6 }}>10,000次重抽样压力测试，破产概率计算与权益区间扇形图。</div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)', marginTop: 12, textAlign: 'right' }}>验证 S3 →</div>
          </Link>

          {/* 参数优化 */}
          <Link href="/report" style={{
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            padding: '16px 20px', borderRadius: 6,
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderLeft: '2px solid transparent', textDecoration: 'none',
            transition: 'border-color .2s, border-left-color .2s',
          }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(38,166,154,.3)'
              e.currentTarget.style.borderLeftColor = 'rgba(38,166,154,.7)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.borderLeftColor = 'transparent'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ color: 'var(--up)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>参数优化报告</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.6 }}>基于邻居法的参数高原检测，避开孤峰过拟合陷阱，锁定稳健区间。</div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)', marginTop: 12, textAlign: 'right' }}>分析 S4 →</div>
          </Link>

          {/* 形态归因 */}
          <Link href="/pattern-report" style={{
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
            padding: '16px 20px', borderRadius: 6,
            background: 'var(--bg-elev)', border: '1px solid var(--border)',
            borderLeft: '2px solid transparent', textDecoration: 'none',
            transition: 'border-color .2s, border-left-color .2s',
          }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'rgba(255,171,64,.3)'
              e.currentTarget.style.borderLeftColor = 'rgba(255,171,64,.7)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--border)'
              e.currentTarget.style.borderLeftColor = 'transparent'
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={{ color: 'var(--gold)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/>
                  </svg>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>形态归因分析</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.6 }}>结合六形态等经典 K 线信号，精准溯源策略的利润提款机。</div>
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-mute)', marginTop: 12, textAlign: 'right' }}>归因测试 →</div>
          </Link>
        </div>
      </section>

      {/* ══ 新闻 + 路线图 ══ */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, marginBottom: 64 }}>
        <NewsFeed news={news} />
        <Sidebar />
      </section>

    </div>
  )
}
