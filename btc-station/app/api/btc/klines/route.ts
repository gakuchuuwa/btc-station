import { NextResponse } from 'next/server'
import { fetchOkxKlines } from '@/lib/okx'
import type { KlineBar } from '@/types/btc'

const cache = new Map<string, { data: KlineBar[]; ts: number }>()
const CACHE_TTL = 60_000 // 60 seconds

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const tf = searchParams.get('tf') || '7D'
    
    if (cache.has(tf)) {
      const c = cache.get(tf)!
      if (Date.now() - c.ts < CACHE_TTL) {
        return NextResponse.json(c.data)
      }
    }

    let interval = '4H'
    let limit = 42
    
    switch (tf) {
      case '1D': interval = '15m'; limit = 96; break;
      case '3D': interval = '1H'; limit = 72; break;
      case '7D': interval = '4H'; limit = 42; break;
      case '1M': interval = '1D'; limit = 30; break;
      case '3M': interval = '1D'; limit = 90; break;
      case '1Y': interval = '1D'; limit = 365; break;
    }

    const data = await fetchOkxKlines(interval, limit)
    cache.set(tf, { data, ts: Date.now() })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/btc/klines]', err)
    const tf = new URL(request.url).searchParams.get('tf') || '7D'
    if (cache.has(tf)) return NextResponse.json(cache.get(tf)!.data)
    return NextResponse.json([], { status: 503 })
  }
}
