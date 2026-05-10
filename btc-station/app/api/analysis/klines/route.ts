import { NextResponse } from 'next/server'
import { OKX_BASE } from '@/lib/okx'
import type { KlineBar } from '@/types/btc'

// 缓存 1 小时（历史数据不会变）
let cache: { data: KlineBar[]; ts: number } | null = null
const CACHE_TTL = 3_600_000

// 分批抓取 OKX history-candles，最多抓 5 年日线（约 1800 根）
async function fetchAllDailyKlines(): Promise<KlineBar[]> {
  const all: KlineBar[] = []
  let after: string | undefined = undefined
  const limit = 300

  for (let i = 0; i < 7; i++) {
    const params = new URLSearchParams({
      instId: 'BTC-USDT-SWAP',
      bar: '1D',
      limit: String(limit),
    })
    if (after) params.set('after', after)

    const endpoint = after
      ? `${OKX_BASE}/api/v5/market/history-candles`
      : `${OKX_BASE}/api/v5/market/candles`

    const res = await fetch(`${endpoint}?${params}`, { cache: 'no-store' })
    if (!res.ok) break
    const json = await res.json()
    const rows: string[][] = json.data ?? []
    if (rows.length === 0) break

    for (const row of rows) {
      all.push({
        time:   Math.floor(parseInt(row[0]) / 1000),
        open:   parseFloat(row[1]),
        high:   parseFloat(row[2]),
        low:    parseFloat(row[3]),
        close:  parseFloat(row[4]),
        volume: parseFloat(row[5]),
      })
    }

    if (rows.length < limit) break
    after = rows[rows.length - 1][0] // 最旧一根的时间戳，继续往前取
  }

  // 按时间升序排列
  all.sort((a, b) => a.time - b.time)

  // OKX BTC/USDT-SWAP 合约数据从 2019 年起
  const cutoff = new Date('2019-01-01').getTime() / 1000
  return all.filter(k => k.time >= cutoff)
}

export async function GET() {
  try {
    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      return NextResponse.json(cache.data)
    }
    const data = await fetchAllDailyKlines()
    cache = { data, ts: Date.now() }
    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/analysis/klines]', err)
    if (cache) return NextResponse.json(cache.data)
    return NextResponse.json([], { status: 503 })
  }
}
