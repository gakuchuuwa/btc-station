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
  current: number
  nextSettleAt: number
}

export interface OpenInterest {
  contracts: number
  usdValue: number
}

export interface PerpetualInfo {
  fundingRate: FundingRate
  openInterest: OpenInterest
  longShortRatio: number
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

/** 永续合约专用：资金费率 + 未平仓量 + 多空比 */
export async function fetchPerpetualInfo(): Promise<PerpetualInfo> {
  const [frRes, oiRes, lsRes] = await Promise.all([
    fetch(`${OKX_BASE}/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`, { next: { revalidate: 30 } }),
    fetch(`${OKX_BASE}/api/v5/public/open-interest?instId=BTC-USDT-SWAP`, { next: { revalidate: 30 } }),
    fetch(`${OKX_BASE}/api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H`, { next: { revalidate: 30 } }),
  ])

  const frJson = frRes.ok ? await frRes.json() : null
  const oiJson = oiRes.ok ? await oiRes.json() : null
  const lsJson = lsRes.ok ? await lsRes.json() : null

  const fr = frJson?.data?.[0]
  const oi = oiJson?.data?.[0]
  const ls = lsJson?.data?.[0]

  const btcPrice = 90000 // 近似值用于 USD 换算，实际由前端用 ticker 价格覆盖

  return {
    fundingRate: {
      current: fr ? parseFloat(fr.fundingRate) : 0,
      nextSettleAt: fr ? parseInt(fr.nextFundingTime) : 0,
    },
    openInterest: {
      contracts: oi ? parseFloat(oi.oi) : 0,
      usdValue: oi ? parseFloat(oi.oiCcy) * btcPrice : 0,
    },
    longShortRatio: ls ? parseFloat(ls.longShortRatio) : 1,
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
