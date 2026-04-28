'use client'

import { useEffect, useState, useCallback } from 'react'
import PriceCard from '@/components/PriceCard'
import NewsFeed from '@/components/NewsFeed'
import Sidebar from '@/components/Sidebar'
import type { BtcSummary, KlineBar, NewsItem } from '@/types/btc'

const EMPTY_SUMMARY: BtcSummary = {
  price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, marketCap: 0,
}

export default function HomePage() {
  const [summary, setSummary] = useState<BtcSummary>(EMPTY_SUMMARY)
  const [klines, setKlines] = useState<KlineBar[]>([])
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [secondsAgo, setSecondsAgo] = useState(0)

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch('/api/btc/summary')
      if (res.ok) { setSummary(await res.json()); setSecondsAgo(0) }
    } catch {/* silent */}
  }, [])

  const fetchKlines = useCallback(async () => {
    try {
      const res = await fetch('/api/btc/klines')
      if (res.ok) setKlines(await res.json())
    } catch {/* silent */}
  }, [])

  const fetchNews = useCallback(async () => {
    try {
      const res = await fetch('/api/news')
      if (res.ok) setNews(await res.json())
    } catch {/* silent */}
  }, [])

  // 初始加载
  useEffect(() => {
    Promise.all([fetchSummary(), fetchKlines(), fetchNews()]).finally(() => setLoading(false))
  }, [fetchSummary, fetchKlines, fetchNews])

  // 每 30 秒刷新价格
  useEffect(() => {
    const id = setInterval(fetchSummary, 30_000)
    return () => clearInterval(id)
  }, [fetchSummary])

  // 每 5 分钟刷新新闻
  useEffect(() => {
    const id = setInterval(fetchNews, 300_000)
    return () => clearInterval(id)
  }, [fetchNews])

  // 秒计数器
  useEffect(() => {
    const id = setInterval(() => setSecondsAgo(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <span className="text-mute" style={{ fontSize: 13 }}>加载中...</span>
      </div>
    )
  }

  const isUp = summary.change24h >= 0

  return (
    <>
      {/* Hero meta */}
      <div className="hero-meta">
        <div className="bread">
          <span>市场</span><span className="sep">/</span>
          <span>现货</span><span className="sep">/</span>
          <span className="curr">Bitcoin · USDT</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-mute)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="dot-live"></span>实时 · OKX
          </span>
          <span className="text-dim">|</span>
          <span className="num">{secondsAgo} 秒前更新</span>
        </div>
      </div>

      <PriceCard summary={summary} klines={klines} isUp={isUp} />

      <div className="sec-grid">
        <NewsFeed news={news} />
        <Sidebar />
      </div>
    </>
  )
}
