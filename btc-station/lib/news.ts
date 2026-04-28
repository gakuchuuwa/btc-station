import { XMLParser } from 'fast-xml-parser'
import type { NewsItem } from '@/types/btc'

const COINDESK_RSS = 'https://www.coindesk.com/arc/outboundfeeds/rss/'

function isBtcRelated(title: string): boolean {
  const lower = title.toLowerCase()
  return lower.includes('bitcoin') || lower.includes(' btc')
}

export async function fetchNews(limit = 8): Promise<NewsItem[]> {
  const res = await fetch(COINDESK_RSS, {
    next: { revalidate: 300 },
    headers: { 'User-Agent': 'BTC-Station/1.0' },
  })
  if (!res.ok) throw new Error(`CoinDesk RSS failed: ${res.status}`)

  const xml = await res.text()
  const parser = new XMLParser({ ignoreAttributes: false })
  const parsed = parser.parse(xml)

  const items: Array<{
    title: string
    link: string
    pubDate: string
  }> = parsed?.rss?.channel?.item ?? []

  return items
    .filter(item => isBtcRelated(item.title ?? ''))
    .slice(0, limit)
    .map(item => ({
      title: item.title,
      url: item.link,
      source: 'CoinDesk',
      publishedAt: new Date(item.pubDate).toISOString(),
    }))
}
