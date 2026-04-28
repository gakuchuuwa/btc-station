import { NextRequest, NextResponse } from 'next/server'
import { fetchOkxTicker } from '@/lib/okx'
import type { Market } from '@/lib/okx'

type TickerCache = { data: Awaited<ReturnType<typeof fetchOkxTicker>>; ts: number }
const cache = new Map<Market, TickerCache>()
const CACHE_TTL = 5_000 // 5 秒

export async function GET(req: NextRequest) {
  const market = (req.nextUrl.searchParams.get('market') ?? 'swap') as Market
  try {
    const hit = cache.get(market)
    if (hit && Date.now() - hit.ts < CACHE_TTL) {
      return NextResponse.json(hit.data)
    }
    const data = await fetchOkxTicker(market)
    cache.set(market, { data, ts: Date.now() })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/chart/ticker]', err)
    const stale = cache.get(market)
    if (stale) return NextResponse.json(stale.data)
    return NextResponse.json({ lastPrice: 0, open24h: 0, high24h: 0, low24h: 0, volCcy24h: 0 }, { status: 503 })
  }
}
