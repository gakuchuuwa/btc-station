import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { fetchOkxKlinesChart, TF_MAP } from '@/lib/okx'
import type { KlineBar, Market } from '@/lib/okx'

/**
 * 全量历史 K 线：服务端一次翻到 OKX 数据底部，落盘缓存，前端一次请求拿全部。
 * 前端原本自己翻 53 页要 11 秒，这里缓存命中后是毫秒级。
 */

// 各周期毫秒数，用于判断缓存是否还新鲜
const TF_MS: Record<string, number> = {
  '1m': 60e3, '5m': 300e3, '15m': 900e3,
  '1h': 3600e3, '4h': 4 * 3600e3, '1d': 86400e3, '1w': 7 * 86400e3,
}

// Vercel Serverless 只有 /tmp 可写
const CACHE_DIR = process.env.VERCEL
  ? path.join(os.tmpdir(), 'klines-cache')
  : path.join(process.cwd(), '.next', 'cache', 'klines')

// 同一周期并发请求只跑一次翻页
const inflight = new Map<string, Promise<KlineBar[]>>()

async function readCache(key: string): Promise<KlineBar[] | null> {
  try {
    const raw = await fs.readFile(path.join(CACHE_DIR, `${key}.json`), 'utf-8')
    const bars = JSON.parse(raw) as KlineBar[]
    return Array.isArray(bars) && bars.length > 0 ? bars : null
  } catch {
    return null
  }
}

async function writeCache(key: string, bars: KlineBar[]) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    await fs.writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(bars))
  } catch {
    // 缓存写失败不影响返回数据
  }
}

/** 带退避重试的单页拉取，避开 OKX 50011 限流 */
async function fetchPage(interval: string, before: number | undefined, market: Market) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fetchOkxKlinesChart(interval, 300, before, market)
    } catch (err) {
      if (attempt === 3) throw err
      await new Promise(r => setTimeout(r, 500 * 2 ** attempt))
    }
  }
  throw new Error('unreachable')
}

/** 从 startBefore 一路往过去翻到底；startBefore 为空表示从最新开始 */
async function paginate(interval: string, market: Market, stopAt?: number): Promise<KlineBar[]> {
  const map = new Map<number, KlineBar>()
  let before: number | undefined
  let empty = 0

  while (true) {
    const { candles } = await fetchPage(interval, before, market)
    if (candles.length === 0) {
      if (++empty >= 3) break
      continue
    }
    empty = 0
    for (const c of candles) map.set(c.time, c)

    const newMin = Math.min(...candles.map(c => c.time))
    if (before !== undefined && newMin >= before) break   // 没有更早的数据了
    if (stopAt !== undefined && newMin <= stopAt) break    // 已接上旧缓存
    before = newMin
    await new Promise(r => setTimeout(r, 120))
  }

  return Array.from(map.values()).sort((a, b) => a.time - b.time)
}

async function loadFull(interval: string, market: Market, key: string): Promise<KlineBar[]> {
  const cached = await readCache(key)
  const tfMs = TF_MS[interval] ?? 3600e3
  const now = Date.now()

  // 缓存里最新一根还没过期 → 直接用
  if (cached && now - cached[cached.length - 1].time * 1000 < tfMs) {
    return cached
  }

  // 有旧缓存 → 只补最新的部分，翻到接上旧数据为止
  if (cached) {
    const lastTime = cached[cached.length - 1].time
    try {
      const fresh = await paginate(interval, market, lastTime)
      const map = new Map<number, KlineBar>()
      for (const c of cached) map.set(c.time, c)
      for (const c of fresh) map.set(c.time, c)
      const merged = Array.from(map.values()).sort((a, b) => a.time - b.time)
      await writeCache(key, merged)
      return merged
    } catch {
      return cached   // 补数据失败就先用旧的
    }
  }

  // 无缓存 → 全量翻到底
  const all = await paginate(interval, market)
  await writeCache(key, all)
  return all
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const interval = searchParams.get('interval') ?? '4h'
  const market = (searchParams.get('market') ?? 'swap') as Market

  if (!TF_MAP[interval]) {
    return NextResponse.json({ error: '不支持的时间周期' }, { status: 400 })
  }

  const key = `${market}-${interval}`
  try {
    let job = inflight.get(key)
    if (!job) {
      job = loadFull(interval, market, key).finally(() => inflight.delete(key))
      inflight.set(key, job)
    }
    const candles = await job
    return NextResponse.json({ candles, count: candles.length })
  } catch (err) {
    console.error('[/api/chart/full]', err)
    const stale = await readCache(key)
    if (stale) return NextResponse.json({ candles: stale, count: stale.length })
    return NextResponse.json({ error: 'K线加载失败，请重试' }, { status: 503 })
  }
}
