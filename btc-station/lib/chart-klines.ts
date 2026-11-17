/** 通过 Next.js /api/chart/klines 从 OKX 拉取 K 线（不依赖后端 CSV 缓存） */

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

/** 服务端一次性返回该周期的全部历史（已落盘缓存，命中时毫秒级） */
async function fetchFullHistory(
  interval: string,
  market: 'spot' | 'swap',
): Promise<ChartCandle[]> {
  // 优先走后端已预热的内存缓存（与回测同源、毫秒级）；失败再回退 Next 服务端翻页缓存
  for (const url of [
    `/py-api/api/candles/${encodeURIComponent(interval)}?market=${market}`,
    `/api/chart/full?interval=${interval}&market=${market}`,
  ]) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const body = (await res.json()) as { candles?: ChartCandle[] }
      if (body.candles?.length) return body.candles
    } catch { /* 试下一个来源 */ }
  }
  throw new Error('全量K线不可用')
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

  // 优先走服务端全量缓存；失败再回退到前端逐页翻
  try {
    const full = await fetchFullHistory(interval, market)
    options?.onProgress?.(full)
    return full
  } catch {
    // 落到下面的逐页加载
  }

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
