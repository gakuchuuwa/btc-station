import { useState, useMemo } from 'react'
import { relativeTime } from '@/lib/format'
import type { NewsItem } from '@/types/btc'

interface Props {
  news: NewsItem[]
}

const CATEGORIES = ['全部', '市场', '监管', 'ETF', '宏观', '链上']

// 简单的关键词匹配规则，用于自动打标签
const KEYWORDS: Record<string, string[]> = {
  '监管': ['监管', '政策', 'SEC', '政府', '法案', '合规', '起诉', '查封', '法庭', '制裁', '洗钱'],
  'ETF': ['ETF', '贝莱德', 'BlackRock', '灰度', 'Grayscale', '富达', 'Fidelity', '现货', '基金'],
  '宏观': ['美联储', 'CPI', '降息', '加息', '通胀', '宏观', '非农', '鲍威尔', '经济', '衰退', 'GDP'],
  '链上': ['链上', '地址', '巨鲸', '流出', '流入', '清算', '算力', '挖矿', '减半', '节点', '转账'],
}

function getCategoryForNews(title: string): string {
  const upperTitle = title.toUpperCase()
  for (const [category, words] of Object.entries(KEYWORDS)) {
    if (words.some(w => upperTitle.includes(w.toUpperCase()))) {
      return category
    }
  }
  return '市场' // 默认分类
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
  const [activeFilter, setActiveFilter] = useState('全部')

  // 对新闻数据进行打标签和过滤
  const filteredItems = useMemo(() => {
    if (!news || news.length === 0) return []
    
    // 给每条新闻打上分类标签
    const mapped = news.map(item => ({
      ...item,
      tag: getCategoryForNews(item.title)
    }))

    // 根据选中的过滤器过滤
    if (activeFilter === '全部') return mapped
    return mapped.filter(item => item.tag === activeFilter)
  }, [news, activeFilter])

  return (
    <div className="card">
      <div className="news-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2>资讯</h2>
          <span className="chip chip-neutral">BTC</span>
        </div>
        <div className="src">
          <span>全网实时聚合</span>
          <span className="sep">|</span>
          <span>5 分钟刷新</span>
        </div>
      </div>
      <div className="news-filters">
        {CATEGORIES.map(cat => (
          <button 
            key={cat}
            className={`tf-btn ${activeFilter === cat ? 'active' : ''}`}
            onClick={() => setActiveFilter(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: 'var(--text-mute)', fontSize: 13 }}>
          {news.length === 0 ? '暂无新闻数据' : `暂无“${activeFilter}”相关最新新闻`}
        </div>
      ) : (
        filteredItems.map((item) => (
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
            <span 
              className="chip chip-neutral" 
              style={{ color: item.tag !== '市场' ? 'var(--accent)' : undefined }}
            >
              {item.tag}
            </span>
            <svg className="arrow-ico" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M8 7h9v9"/></svg>
          </a>
        ))
      )}

      <div className="news-foot">
        <span>显示最新 {filteredItems.length} 条</span>
        {activeFilter === '全部' ? (
          <button>查看全部 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg></button>
        ) : (
          <button onClick={() => setActiveFilter('全部')}>
            返回全部 <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 5l7 7-7 7"/></svg>
          </button>
        )}
      </div>
    </div>
  )
}
