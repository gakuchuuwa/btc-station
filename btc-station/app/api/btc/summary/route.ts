import { NextResponse } from 'next/server'
import { fetchOkxTicker, fetchMarketCap } from '@/lib/okx'
import type { BtcSummary } from '@/types/btc'

let cache: { data: BtcSummary; ts: number } | null = null
const CACHE_TTL = 10_000 // 10 seconds

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const [ticker, marketCap] = await Promise.all([
      fetchOkxTicker(),
      fetchMarketCap(),
    ])

    const change24h =
      ticker.open24h > 0
        ? ((ticker.lastPrice - ticker.open24h) / ticker.open24h) * 100
        : 0

    const data: BtcSummary = {
      price: ticker.lastPrice,
      change24h,
      high24h: ticker.high24h,
      low24h: ticker.low24h,
      volume24h: ticker.volCcy24h,
      marketCap,
    }

    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/btc/summary]', err)
    if (cache) return NextResponse.json(cache.data) // return stale cache on error
    return NextResponse.json(
      { price: 0, change24h: 0, high24h: 0, low24h: 0, volume24h: 0, marketCap: 0 },
      { status: 503 }
    )
  }
}
