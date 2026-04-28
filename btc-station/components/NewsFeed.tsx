import { relativeTime } from '@/lib/format'
import type { NewsItem } from '@/types/btc'

interface Props {
  news: NewsItem[]
}

function formatTimeLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const hh = d.getHours().toString().padStart(2, '0')
  const mm = d.getMinutes().toString().padStart(2, '0')
  const isToday = d.toDateString() === now.toDateString()
  return isToday ? `${hh}:${mm}` : `昨 ${hh}:${mm}`
}

export default function NewsFeed({ news }: Props) {
  // 无数据时用占位，保持布局不塌
  const items = news.length > 0 ? news : []

  return (
    <div className="card">
      <div className="news-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2>资讯</h2>
          <span className="chip chip-neutral">BTC</span>
        </div>
        <div className="src">
          <span>CoinDesk · Bloomberg · Reuters</span>
          <span className="sep">|</span>
          <span>5 分钟刷新</span>
        </div>
      </div>
      <div className="news-filters">
        <button className="tf-btn active">全部</button>
        <button className="tf-btn">市场</button>
        <button className="tf-btn">监管</button>
        <button className="tf-btn">ETF</button>
        <button className="tf-btn">宏观</button>
        <button className="tf-btn">链上</button>
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>
          暂无新闻数据
        </div>
      ) : (
        items.map((item) => (
          <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="news-row">
            <span className="news-time num">{formatTimeLabel(item.publishedAt)}</span>
            <div>
              <div className="news-title">{item.title}</div>
              <div className="news-meta">
                <span>{item.source}</span>
                <span className="sep">·</span>
                <span>{relativeTime(item.publishedAt)}</span>
              </div>
            </div>
            <span className="chip chip-neutral">市场</span>
            <svg className="arrow-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M8 7h9v9"/></svg>
          </a>
        ))
      )}

      <div className="news-foot">
        <span>显示最新 {items.length} 条</span>
        <button>查看全部 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg></button>
      </div>
    </div>
  )
}
