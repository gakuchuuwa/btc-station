export const OKX_BASE = 'https://www.okx.com'
const COINGECKO_BASE = 'https://api.coingecko.com'

// OKX 支持的 K 线周期映射（前端用 → OKX bar 参数）
export const TF_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m',
  '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W',
}

export type Market = 'spot' | 'swap'

const INST_ID: Record<Market, string> = {
  spot: 'BTC-USDT',
  swap: 'BTC-USDT-SWAP',
}

export interface TickerData {
  lastPrice: number
  open24h: number
  high24h: number
  low24h: number
  volCcy24h: number
}

export interface FundingRate {
  current: number | null
  nextSettleAt: number | null
}

export interface OpenInterest {
  btc: number | null
  usdValue: number | null
}

export interface PerpetualInfo {
  fundingRate: FundingRate
  openInterest: OpenInterest
  longShortRatio: number | null
}

export interface KlineBar {
  time: number   // Unix 秒
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export async function fetchOkxTicker(market: Market = 'swap'): Promise<TickerData> {
  const instId = INST_ID[market]
  const res = await fetch(
    `${OKX_BASE}/api/v5/market/ticker?instId=${instId}`,
    { next: { revalidate: 10 } }
  )
  if (!res.ok) throw new Error(`OKX ticker 请求失败: ${res.status}`)
  const json = await res.json()
  const d = json.data?.[0]
  if (!d) throw new Error('OKX ticker: 返回数据为空')
  return {
    lastPrice: parseFloat(d.last),
    open24h:   parseFloat(d.open24h),
    high24h:   parseFloat(d.high24h),
    low24h:    parseFloat(d.low24h),
    volCcy24h: parseFloat(d.volCcy24h),
  }
}

/** 主页 7 日 K 线（只取已完成的蜡烛） */
export async function fetchOkxKlines(bar = '1D', limit = 7): Promise<KlineBar[]> {
  const res = await fetch(
    `${OKX_BASE}/api/v5/market/candles?instId=BTC-USDT&bar=${bar}&limit=${limit}`,
    { next: { revalidate: 60 } }
  )
  if (!res.ok) throw new Error(`OKX K线请求失败: ${res.status}`)
  const json = await res.json()
  const rows: string[][] = json.data ?? []
  return rows
    .filter(row => row[8] === '1')
    .reverse()
    .map(row => ({
      time:   Math.floor(parseInt(row[0]) / 1000),
      open:   parseFloat(row[1]),
      high:   parseFloat(row[2]),
      low:    parseFloat(row[3]),
      close:  parseFloat(row[4]),
      volume: parseFloat(row[5]),
    }))
}

/**
 * 图表页 K 线（支持多周期、分页加载、现货/永续切换）
 * before: 时间戳（秒），用于向左翻页（传最早一根的 time）
 *
 * OKX 端点说明：
 *   /market/candles        — 只能拿最近 1440 根（约最近数月）
 *   /market/history-candles — 可以拿 2019 年至今所有历史，但不含最新未完成K线
 * 策略：有 before 参数（翻历史）时自动切换到 history-candles
 */
export async function fetchOkxKlinesChart(
  interval = '1h',
  limit = 300,
  before?: number,
  market: Market = 'swap'
): Promise<{ candles: KlineBar[]; hasMore: boolean }> {
  const bar = TF_MAP[interval] ?? '1H'
  const instId = INST_ID[market]

  // before 有值说明是向左翻页，用 history-candles；否则用普通 candles 拿最新数据
  const endpoint = before
    ? `${OKX_BASE}/api/v5/market/history-candles`
    : `${OKX_BASE}/api/v5/market/candles`

  const params = new URLSearchParams({ instId, bar, limit: String(limit) })
  if (before) params.set('after', String(before * 1000)) // OKX after = 比这个时间更早

  const res = await fetch(`${endpoint}?${params}`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`OKX K线请求失败: ${res.status}`)
  const json = await res.json()
  const rows: string[][] = json.data ?? []

  const candles = rows
    .reverse()
    .map(row => ({
      time:   Math.floor(parseInt(row[0]) / 1000),
      open:   parseFloat(row[1]),
      high:   parseFloat(row[2]),
      low:    parseFloat(row[3]),
      close:  parseFloat(row[4]),
      volume: parseFloat(row[5]),
    }))

  return { candles, hasMore: rows.length === limit }
}

let dailyHistoryCache: { data: KlineBar[]; ts: number } | null = null

/** 获取足够计算 5 年季节性和周期指标的 BTC 日线，最多翻 7 页（约 5.7 年）。 */
export async function fetchOkxDailyHistory(): Promise<KlineBar[]> {
  if (dailyHistoryCache && Date.now() - dailyHistoryCache.ts < 30 * 60_000) {
    return dailyHistoryCache.data
  }

  const byTime = new Map<number, KlineBar>()
  let before: number | undefined

  for (let page = 0; page < 7; page++) {
    const result = await fetchOkxKlinesChart('1d', 300, before, 'spot')
    if (result.candles.length === 0) break

    for (const candle of result.candles) byTime.set(candle.time, candle)
    const oldest = Math.min(...result.candles.map(candle => candle.time))
    if (before !== undefined && oldest >= before) break
    if (!result.hasMore || result.candles.length < 300) break
    before = oldest
  }

  const cutoff = Math.floor(Date.UTC(new Date().getUTCFullYear() - 6, 0, 1) / 1000)
  const data = Array.from(byTime.values())
    .filter(candle => candle.time >= cutoff)
    .sort((a, b) => a.time - b.time)
  dailyHistoryCache = { data, ts: Date.now() }
  return data
}

/** 解析公共 API 的可选数值；缺失或无效时返回 null，不合成默认行情。 */
function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/** 永续合约专用：资金费率 + 未平仓量 + 多空比 */
export async function fetchPerpetualInfo(): Promise<PerpetualInfo> {
  const [frRes, oiRes, lsRes] = await Promise.all([
    fetch(`${OKX_BASE}/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`, { next: { revalidate: 30 } }).catch(() => null),
    fetch(`${OKX_BASE}/api/v5/public/open-interest?instId=BTC-USDT-SWAP`, { next: { revalidate: 30 } }).catch(() => null),
    fetch(`${OKX_BASE}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H`, { next: { revalidate: 30 } }).catch(() => null),
  ])

  const [frJson, oiJson, lsJson] = await Promise.all([
    frRes?.ok ? frRes.json().catch(() => null) : null,
    oiRes?.ok ? oiRes.json().catch(() => null) : null,
    lsRes?.ok ? lsRes.json().catch(() => null) : null,
  ])

  const fr = frJson?.data?.[0]
  const oi = oiJson?.data?.[0]
  const ls = lsJson?.data?.[0]
  const current = toFiniteNumber(fr?.fundingRate)
  const nextSettleAt = toFiniteNumber(fr?.nextFundingTime)
  const btc = toFiniteNumber(oi?.oiCcy)
  const usdValue = toFiniteNumber(oi?.oiUsd)
  // OKX Rubik returns [timestamp, ratio] rows, unlike the object-shaped endpoints above.
  const rawRatio = toFiniteNumber(Array.isArray(ls) ? ls[1] : ls?.longShortRatio)
  const longShortRatio = rawRatio != null && rawRatio > 0 ? rawRatio : null

  if (current == null && btc == null && usdValue == null && longShortRatio == null) {
    throw new Error('OKX 永续公开指标暂不可用')
  }

  return {
    fundingRate: { current, nextSettleAt },
    openInterest: { btc, usdValue },
    longShortRatio,
  }
}

export async function fetchMarketCap(): Promise<number> {
  const res = await fetch(
    `${COINGECKO_BASE}/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true`,
    { next: { revalidate: 60 } }
  )
  if (!res.ok) return 0
  const json = await res.json()
  return json?.bitcoin?.usd_market_cap ?? 0
}
