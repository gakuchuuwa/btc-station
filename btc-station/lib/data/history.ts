import { getCachedCandles, setCachedCandles } from './cache';
import type { KlineBar, Market } from '../okx';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_RETRY = 2;

export interface HistoryProgress {
  percent: number;
  message: string;
}

export async function fetchHistoryBatch(
  market: Market,
  interval: string,
  before?: number
): Promise<{ candles: KlineBar[]; hasMore: boolean }> {
  let url = `/api/chart/klines?market=${market}&interval=${interval}&limit=300`;
  if (before) {
    url += `&before=${before}`;
  }

  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
      const data = await res.json();
      if (!data.candles) throw new Error('Invalid response structure');
      return data;
    } catch (e) {
      if (i === MAX_RETRY - 1) {
        throw new Error('网络异常，请稍候');
      }
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error('网络异常，请稍候');
}

export async function ensureHistoricalData(
  market: Market,
  interval: string,
  lookbackYears: number,
  onProgress?: (p: HistoryProgress) => void
): Promise<KlineBar[]> {
  const now = Date.now();
  const lookbackMs = lookbackYears * 365 * 24 * 60 * 60 * 1000;
  const targetStartTime = now - lookbackMs;
  const targetStartSeconds = Math.floor(targetStartTime / 1000);

  const cached = await getCachedCandles(market, interval);
  let candles: KlineBar[] = [];
  
  if (cached && cached.candles.length > 0) {
    candles = cached.candles;
    // Check if we need to update recent data
    if (now - cached.lastUpdate < CACHE_TTL_MS) {
      // If we have enough history, return directly
      const oldestCandle = candles[0];
      if (oldestCandle && oldestCandle.time <= targetStartSeconds) {
        return candles;
      }
    }
  }

  onProgress?.({ percent: 0, message: '正在加载历史数据...' });

  // 1. Fetch recent data (forward from our newest cached, or from now)
  let newestTime = candles.length > 0 ? candles[candles.length - 1].time : undefined;
  let newRecentCandles: KlineBar[] = [];
  
  // Since OKX fetches backward, if we have cache, we need to fetch from now backwards until we hit newestTime
  let currentBefore: number | undefined = undefined;
  let isFetchingRecent = true;

  if (candles.length > 0) {
    // Fill the gap between now and our newest cached candle
    while (isFetchingRecent) {
      const batch = await fetchHistoryBatch(market, interval, currentBefore);
      const batchCandles = batch.candles;
      
      if (batchCandles.length === 0) break;
      
      const filtered = batchCandles.filter(c => c.time > newestTime!);
      newRecentCandles = [...filtered, ...newRecentCandles];
      
      if (filtered.length < batchCandles.length || !batch.hasMore) {
        // We reached the cached data overlap
        break;
      }
      currentBefore = batchCandles[0].time;
    }
  }

  // Combine newest
  candles = [...candles, ...newRecentCandles];
  
  // 2. Fetch older data if we don't have enough history
  let oldestTime = candles.length > 0 ? candles[0].time : undefined;
  
  if (!oldestTime || oldestTime > targetStartSeconds) {
    let oldBefore = oldestTime;
    let fetchedCount = 0;
    // Rough estimate of how many we need:
    const neededSeconds = (oldestTime || Math.floor(now/1000)) - targetStartSeconds;
    // For 1d = 86400, 4h = 14400, 1h = 3600
    let intervalSeconds = 3600;
    if (interval === '1d') intervalSeconds = 86400;
    else if (interval === '4h') intervalSeconds = 14400;
    
    const totalNeeded = neededSeconds / intervalSeconds;

    while (true) {
      const batch = await fetchHistoryBatch(market, interval, oldBefore);
      const batchCandles = batch.candles;
      if (batchCandles.length === 0) break;

      candles = [...batchCandles, ...candles];
      fetchedCount += batchCandles.length;
      
      let percent = Math.min(99, Math.floor((fetchedCount / totalNeeded) * 100));
      onProgress?.({ percent, message: `正在加载历史数据... ${percent}%` });

      oldBefore = batchCandles[0].time;
      
      if (oldBefore <= targetStartSeconds || !batch.hasMore) {
        break;
      }
      
      // Delay to avoid OKX rate limits (20 req / 2s / IP)
      await new Promise(r => setTimeout(r, 150));
    }
  }

  // Deduplicate and sort (just in case)
  const uniqueCandlesMap = new Map<number, KlineBar>();
  for (const c of candles) {
    uniqueCandlesMap.set(c.time, c);
  }
  
  const finalCandles = Array.from(uniqueCandlesMap.values()).sort((a, b) => a.time - b.time);

  // Save to cache
  await setCachedCandles(market, interval, finalCandles);
  
  onProgress?.({ percent: 100, message: '加载完成' });
  return finalCandles;
}
