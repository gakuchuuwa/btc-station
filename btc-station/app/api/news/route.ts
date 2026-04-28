import { NextResponse } from 'next/server'
import { fetchNews } from '@/lib/news'
import type { NewsItem } from '@/types/btc'

let cache: { data: NewsItem[]; ts: number } | null = null
const CACHE_TTL = 300_000 // 5 minutes

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const data = await fetchNews(8)
    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/news]', err)
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json([], { status: 503 })
  }
}
