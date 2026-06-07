/** 通过 Next.js /api/chart/klines 从 OKX 拉取 K 线（不依赖 Railway 后端 CSV） */

export interface ChartCandle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
}

async function fetchKlinePage(
  interval: string,
  market: 'spot' | 'swap',
  before?: number,
): Promise<{ candles: ChartCandle[]; hasMore: boolean }> {
  const params = new URLSearchParams({ interval, limit: '300', market })
  if (before) params.set('before', String(before))
  const res = await fetch(`/api/chart/klines?${params}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error || `K线请求失败 (${res.status})`)
  }
  return res.json()
}

/** 先返回第一页，后台继续翻页；onProgress 用于渐进渲染 */
export async function loadChartCandles(
  interval: string,
  options?: {
    market?: 'spot' | 'swap'
    maxBars?: number
    onProgress?: (candles: ChartCandle[]) => void
  },
): Promise<ChartCandle[]> {
  const market = options?.market ?? 'swap'
  const maxBars = options?.maxBars ?? 20000

  const first = await fetchKlinePage(interval, market)
  if (first.candles.length === 0) {
    throw new Error('K线数据为空，请稍后重试')
  }

  const allMap = new Map<number, ChartCandle>()
  for (const c of first.candles) allMap.set(c.time, c)
  options?.onProgress?.(Array.from(allMap.values()).sort((a, b) => a.time - b.time))

  let before = Math.min(...first.candles.map(c => c.time))
  let emptyCount = 0

  while (allMap.size < maxBars) {
    await new Promise(r => setTimeout(r, 150))
    try {
      const { candles: page } = await fetchKlinePage(interval, market, before)
      if (page.length === 0) {
        emptyCount++
        if (emptyCount >= 3) break
        continue
      }
      emptyCount = 0
      for (const c of page) allMap.set(c.time, c)
      const newMin = Math.min(...page.map(c => c.time))
      if (newMin >= before) break
      before = newMin
    } catch {
      break
    }
  }

  const sorted = Array.from(allMap.values()).sort((a, b) => a.time - b.time)
  options?.onProgress?.(sorted)
  return sorted
}
