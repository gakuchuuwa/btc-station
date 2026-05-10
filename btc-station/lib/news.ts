import { XMLParser } from 'fast-xml-parser'
import type { NewsItem } from '@/types/btc'

const GOOGLE_NEWS_RSS = 'https://news.google.com/rss/search?q=%E6%AF%94%E7%89%B9%E5%B8%81+when:7d&hl=zh-CN&gl=CN&ceid=CN:zh-Hans'

export async function fetchNews(limit = 8): Promise<NewsItem[]> {
  try {
    const res = await fetch(GOOGLE_NEWS_RSS, {
      next: { revalidate: 300 },
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    })
    if (!res.ok) throw new Error(`Google News RSS failed: ${res.status}`)

    const xml = await res.text()
    const parser = new XMLParser({ ignoreAttributes: false })
    const parsed = parser.parse(xml)

    const items: Array<{
      title: string
      link: string
      pubDate: string
      source?: any
    }> = parsed?.rss?.channel?.item ?? []

    // Ensure items is an array (fast-xml-parser might return a single object if there's only 1 item)
    const itemsArray = Array.isArray(items) ? items : (items ? [items] : [])

    return itemsArray.slice(0, limit).map((item: any) => ({
      title: item.title,
      url: item.link,
      source: item.source?.['#text'] || 'Google News',
      publishedAt: new Date(item.pubDate).toISOString(),
    }))
  } catch (e) {
    console.error('Fetch news error:', e)
    return []
  }
}
