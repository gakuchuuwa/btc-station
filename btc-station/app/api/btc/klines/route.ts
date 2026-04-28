import { NextResponse } from 'next/server'
import { fetchOkxKlines } from '@/lib/okx'
import type { KlineBar } from '@/types/btc'

let cache: { data: KlineBar[]; ts: number } | null = null
const CACHE_TTL = 60_000 // 60 seconds

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }

    const data = await fetchOkxKlines('1D', 7)
    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/btc/klines]', err)
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json([], { status: 503 })
  }
}
