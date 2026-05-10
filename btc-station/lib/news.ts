import type { NewsItem } from '@/types/btc'

export async function fetchNews(limit = 8): Promise<NewsItem[]> {
  try {
    const res = await fetch(
      'https://www.binance.com/bapi/composite/v1/public/cms/article/catalog/list/query?catalogId=48&pageNo=1&pageSize=' + limit + '&lang=zh-CN',
      {
        next: { revalidate: 300 },
        headers: { 'User-Agent': 'BTC-Station/1.0' },
      }
    )
    if (!res.ok) throw new Error(`Binance API failed: ${res.status}`)

    const json = await res.json()
    const articles = json?.data?.articles ?? []

    return articles.map((item: any) => ({
      title: item.title,
      url: `https://www.binance.com/zh-CN/support/announcement/${item.code}`,
      source: 'Binance',
      // Binance API usually returns publishDate in milliseconds
      publishedAt: new Date(item.publishDate || Date.now()).toISOString(),
    }))
  } catch (e) {
    console.error('Fetch news error:', e)
    return []
  }
}
