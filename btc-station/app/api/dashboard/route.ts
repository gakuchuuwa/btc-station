import { NextResponse } from 'next/server'
import { fetchOkxDailyHistory, fetchOkxKlinesChart, fetchOkxTicker, fetchPerpetualInfo, type KlineBar } from '@/lib/okx'

export const dynamic = 'force-dynamic'

interface DashboardData {
  market: {
    funding_rates: Record<string, number | null>
    open_interest: { okx_usd: number | null; okx_btc: number | null }
    long_short_ratio: { long_pct: number; short_pct: number; ratio: number } | null
    prices: Record<string, number | null>
    spread_pct: number | null
  } | null
  onchain: {
    hashrate_eh: number | null
    mempool_count: number | null
    mempool_vsize_mb: number | null
    avg_block_interval_sec: number | null
    difficulty_adjustment: { progress_pct: number; change_pct: number; remaining_blocks: number } | null
  } | null
  macro: {
    fear_greed: { value: number; label: string; prev?: number } | null
    wma200: { value: number; current_price: number; distance_pct: number } | null
    pi_cycle: { sma111: number; sma350x2: number; distance_pct: number; triggered: boolean } | null
  } | null
  seasonality: { years: Record<string, [number, number][]> }
}

let responseCache: { data: DashboardData; ts: number } | null = null
const CACHE_TTL = 60_000
const MEMPOOL_BASE = 'https://mempool.space/api'

async function fetchJson(url: string): Promise<any | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 7_000)
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { 'User-Agent': 'BTC Station public market dashboard' },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function average(values: number[]): number | null {
  const valid = values.filter(value => Number.isFinite(value))
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null
}

function buildSeasonality(daily: KlineBar[]): DashboardData['seasonality'] {
  const years: Record<string, [number, number][]> = {}
  const currentYear = new Date().getUTCFullYear()
  const firstYear = currentYear - 4

  for (let year = firstYear; year <= currentYear; year++) {
    const candles = daily.filter(candle => new Date(candle.time * 1000).getUTCFullYear() === year)
    if (candles.length === 0) continue
    const base = candles[0].open > 0 ? candles[0].open : candles[0].close
    if (!(base > 0)) continue

    years[String(year)] = candles.map(candle => {
      const date = new Date(candle.time * 1000)
      const dayOfYear = Math.floor((Date.UTC(year, date.getUTCMonth(), date.getUTCDate()) - Date.UTC(year, 0, 1)) / 86_400_000) + 1
      return [dayOfYear, (candle.close / base - 1) * 100]
    })
  }

  return { years }
}

function buildFearGreed(data: any): NonNullable<DashboardData['macro']>['fear_greed'] {
  const rows = Array.isArray(data?.data) ? data.data : []
  if (!rows.length) return null
  const value = Number(rows[0]?.value)
  if (!Number.isFinite(value)) return null
  const previous = Number(rows[1]?.value)
  return {
    value,
    label: String(rows[0]?.value_classification ?? ''),
    ...(Number.isFinite(previous) ? { prev: previous } : {}),
  }
}

function buildOnchain(hashrate: any, mempool: any, difficulty: any, blocks: any): DashboardData['onchain'] {
  const currentHashrate = Number(hashrate?.currentHashrate)
  const count = Number(mempool?.count)
  const vsize = Number(mempool?.vsize)
  const blockList = Array.isArray(blocks) ? blocks : []
  let avgBlockIntervalSec: number | null = null
  if (blockList.length >= 2) {
    const timestamps = blockList.map((block: any) => Number(block.timestamp)).filter(Number.isFinite)
    if (timestamps.length >= 2) {
      const sorted = timestamps.sort((a: number, b: number) => a - b)
      avgBlockIntervalSec = (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1)
    }
  }

  const progress = Number(difficulty?.progressPercent)
  const change = Number(difficulty?.difficultyChange)
  const remaining = Number(difficulty?.remainingBlocks)
  const difficultyAdjustment = [progress, change, remaining].every(Number.isFinite)
    ? { progress_pct: progress, change_pct: change, remaining_blocks: remaining }
    : null

  if (!Number.isFinite(currentHashrate) && !Number.isFinite(count) && !Number.isFinite(vsize) && avgBlockIntervalSec == null && !difficultyAdjustment) {
    return null
  }
  return {
    hashrate_eh: Number.isFinite(currentHashrate) && currentHashrate > 0 ? currentHashrate / 1e18 : null,
    mempool_count: Number.isFinite(count) ? count : null,
    mempool_vsize_mb: Number.isFinite(vsize) ? vsize / 1e6 : null,
    avg_block_interval_sec: avgBlockIntervalSec,
    difficulty_adjustment: difficultyAdjustment,
  }
}

async function createDashboardData(): Promise<DashboardData> {
  const [spotResult, swapResult, perpResult, dailyResult, weeklyResult, fearGreedData, hashrateData, mempoolData, difficultyData, blocksData] = await Promise.all([
    fetchOkxTicker('spot').catch(() => null),
    fetchOkxTicker('swap').catch(() => null),
    fetchPerpetualInfo().catch(() => null),
    fetchOkxDailyHistory().catch(() => [] as KlineBar[]),
    fetchOkxKlinesChart('1w', 200, undefined, 'spot').catch(() => ({ candles: [], hasMore: false })),
    fetchJson('https://api.alternative.me/fng/?limit=2&format=json'),
    fetchJson(`${MEMPOOL_BASE}/v1/mining/hashrate/1w`),
    fetchJson(`${MEMPOOL_BASE}/mempool`),
    fetchJson(`${MEMPOOL_BASE}/v1/difficulty-adjustment`),
    fetchJson(`${MEMPOOL_BASE}/blocks`),
  ])

  const spot = spotResult && spotResult.lastPrice > 0 ? spotResult.lastPrice : null
  const swap = swapResult && swapResult.lastPrice > 0 ? swapResult.lastPrice : null
  const ratio = perpResult?.longShortRatio ?? null
  const longShortRatio = ratio != null && Number.isFinite(ratio) && ratio > 0
    ? { ratio, long_pct: ratio / (1 + ratio) * 100, short_pct: 1 / (1 + ratio) * 100 }
    : null
  const funding = perpResult?.fundingRate?.current ?? null
  const oiBtc = perpResult?.openInterest?.btc ?? null
  const oiUsd = perpResult?.openInterest?.usdValue ?? null
  const prices = { 'OKX 现货': spot, 'OKX 永续': swap }
  const validPrices = [spot, swap].filter((value): value is number => value != null)
  const spreadPct = validPrices.length >= 2 && (validPrices[0] + validPrices[1]) > 0
    ? (Math.max(...validPrices) - Math.min(...validPrices)) / ((validPrices[0] + validPrices[1]) / 2) * 100
    : null

  const daily = dailyResult.filter(candle => Number.isFinite(candle.close) && candle.close > 0)
  const recentDaily = daily.slice(-350)
  const sma111 = recentDaily.length >= 111 ? average(recentDaily.slice(-111).map(candle => candle.close)) : null
  const sma350 = recentDaily.length >= 350 ? average(recentDaily.map(candle => candle.close)) : null
  const piCycle = sma111 != null && sma350 != null && sma350 > 0
    ? {
        sma111,
        sma350x2: sma350 * 2,
        distance_pct: (sma111 / (sma350 * 2) - 1) * 100,
        triggered: sma111 >= sma350 * 2,
      }
    : null

  const weekly = weeklyResult.candles.filter(candle => Number.isFinite(candle.close) && candle.close > 0).slice(-200)
  const wmaValue = weekly.length === 200
    ? weekly.reduce((weighted, candle, index) => weighted + candle.close * (index + 1), 0) / (200 * 201 / 2)
    : null
  const currentPrice = swap ?? spot
  const wma200 = wmaValue != null && currentPrice != null && wmaValue > 0
    ? { value: wmaValue, current_price: currentPrice, distance_pct: (currentPrice / wmaValue - 1) * 100 }
    : null

  const onchain = buildOnchain(hashrateData, mempoolData, difficultyData, blocksData)
  const market = spot != null || swap != null || perpResult
    ? {
        funding_rates: { 'OKX 永续': funding != null && Number.isFinite(funding) ? funding : null },
        open_interest: {
          okx_btc: oiBtc != null && Number.isFinite(oiBtc) && oiBtc > 0 ? oiBtc : null,
          okx_usd: oiUsd != null && Number.isFinite(oiUsd) && oiUsd > 0
            ? oiUsd
            : oiBtc != null && Number.isFinite(oiBtc) && oiBtc > 0 && currentPrice != null ? oiBtc * currentPrice : null,
        },
        long_short_ratio: longShortRatio,
        prices,
        spread_pct: spreadPct,
      }
    : null
  const macro = buildFearGreed(fearGreedData) || wma200 || piCycle
    ? { fear_greed: buildFearGreed(fearGreedData), wma200, pi_cycle: piCycle }
    : null

  return { market, onchain, macro, seasonality: buildSeasonality(daily) }
}

export async function GET() {
  if (responseCache && Date.now() - responseCache.ts < CACHE_TTL) {
    return NextResponse.json(responseCache.data, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  }

  try {
    const data = await createDashboardData()
    responseCache = { data, ts: Date.now() }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  } catch (error) {
    console.error('[/api/dashboard]', error)
    const data: DashboardData = { market: null, onchain: null, macro: null, seasonality: { years: {} } }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
  }
}
