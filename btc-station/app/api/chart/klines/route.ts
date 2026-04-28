import { NextRequest, NextResponse } from 'next/server'
import { fetchOkxKlinesChart, TF_MAP } from '@/lib/okx'
import type { KlineBar, Market } from '@/lib/okx'

// 每个周期对应的服务端缓存时长（秒）
const CACHE_TTL: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 600,
  '1h': 600, '4h': 1800, '1d': 3600, '1w': 3600,
}

const cache = new Map<string, { data: { candles: KlineBar[]; hasMore: boolean }; ts: number }>()

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const interval = searchParams.get('interval') ?? '1h'
  const limit    = Math.min(parseInt(searchParams.get('limit') ?? '500'), 500)
  const before   = searchParams.get('before') ? parseInt(searchParams.get('before')!) : undefined
  const market   = (searchParams.get('market') ?? 'swap') as Market

  // 翻页请求不走缓存
  const cacheKey = `${market}:${interval}:${limit}`
  const ttl = (CACHE_TTL[interval] ?? 600) * 1000

  if (!before) {
    const hit = cache.get(cacheKey)
    if (hit && Date.now() - hit.ts < ttl) {
      return NextResponse.json(hit.data)
    }
  }

  // 校验周期参数
  if (!TF_MAP[interval]) {
    return NextResponse.json({ error: '不支持的时间周期' }, { status: 400 })
  }

  try {
    const data = await fetchOkxKlinesChart(interval, limit, before, market)
    if (!before) cache.set(cacheKey, { data, ts: Date.now() })
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/chart/klines]', err)
    const stale = cache.get(cacheKey)
    if (stale) return NextResponse.json(stale.data)
    return NextResponse.json({ candles: [], hasMore: false }, { status: 503 })
  }
}
