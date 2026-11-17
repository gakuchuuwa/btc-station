import { NextResponse } from 'next/server'
import { fetchPerpetualInfo } from '@/lib/okx'

let cache: { data: Awaited<ReturnType<typeof fetchPerpetualInfo>>; ts: number } | null = null
const CACHE_TTL = 30_000 // 30 秒（资金费率 8 小时一次，不需要高频）

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }
    const data = await fetchPerpetualInfo()
    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/chart/perpetual-info]', err)
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json(
      { fundingRate: { current: 0, nextSettleAt: 0 }, openInterest: { contracts: 0, usdValue: 0 }, longShortRatio: 1 },
      { status: 503 }
    )
  }
}
