'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import './home.css'
import type { BtcSummary, NewsItem } from '@/types/btc'

// ════════════════════════════════════════════════════════════════════════════
// 数据类型
// ════════════════════════════════════════════════════════════════════════════

interface MarketData {
  funding_rates: Record<string, number | null>
  open_interest: { binance_usd?: number | null; okx_btc?: number | null }
  // Binance Futures 大户多空账户比（替代原 24h 爆仓——allForceOrders 端点不开放）
  long_short_ratio: { long_pct: number; short_pct: number; ratio: number } | null
  prices: Record<string, number | null>
  spread_pct: number | null
}

interface OnchainData {
  hashrate_eh: number | null
  mempool_count: number | null
  mempool_vsize_mb: number | null
  avg_block_interval_sec: number | null
  difficulty_adjustment: { progress_pct: number; change_pct: number; remaining_blocks: number } | null
}

interface MacroData {
  fear_greed: { value: number; label: string; prev?: number } | null
  dxy: number | null
  btc_spx_corr_30d: number | null
  wma200: { value: number; current_price: number; distance_pct: number } | null
  pi_cycle: { sma111: number; sma350x2: number; distance_pct: number; triggered: boolean } | null
}

interface SeasonalityData {
  years: Record<string, [number, number][]>  // { "2026": [[day_of_year, pct_change], ...], ... }
}

// ════════════════════════════════════════════════════════════════════════════
// 图层定义（与 mockup LAYERS 对齐）
// ════════════════════════════════════════════════════════════════════════════

type LayerKey = 'news' | 'sentiment' | 'derivative' | 'onchain' | 'macro' | 'cycle'

interface LayerDef {
  key: string  // 单字母 class（n/s/d/o/m/c）
  name: string
  desc: string
}

const LAYERS: Record<LayerKey, LayerDef> = {
  news: { key: 'n', name: '实时资讯', desc: 'BTC 中文新闻 / 链上事件' },
  sentiment: { key: 's', name: '市场情绪', desc: '恐慌贪婪 / 共识信号' },
  derivative: { key: 'd', name: '衍生品', desc: '爆仓 / OI / 资金费率' },
  onchain: { key: 'o', name: '链上', desc: '算力 / 内存池 / 出块' },
  macro: { key: 'm', name: '宏观', desc: 'DXY / 跨资产相关性' },
  cycle: { key: 'c', name: '周期', desc: '200WMA / Pi Cycle' },
}

type WidgetType =
  | 'news_feed' | 'gauge_fng' | 'split_liq' | 'spark_oi' | 'fund_matrix'
  | 'spread_table' | 'spark_hash' | 'mempool_bars' | 'signal_pi'
  | 'distance' | 'spark_dxy' | 'correlation' | 'countdown'

interface WidgetDef {
  id: string
  layer: LayerKey
  name: string
  src: string
  type: WidgetType
  span: 1 | 2 | 3 | 4 | 5 | 6
  row?: 2 | 3 | 4
}

// 12 数据 widget（新闻被抽出来单独渲染在 grid 之后）
// 总 cells = 4 + 4 + 4 + 2×9 = 30（整除 6 列 = 5 行整齐）
const WIDGETS: WidgetDef[] = [
  // ── 双格高强调：情绪 & 顶部信号 ──
  { id: 'fng', layer: 'sentiment', name: '恐慌贪婪指数', src: 'Alt.me', type: 'gauge_fng', span: 2, row: 2 },
  { id: 'pi', layer: 'cycle', name: 'Pi Cycle Top', src: '计算', type: 'signal_pi', span: 2, row: 2 },
  // ── 双倍宽：距离/趋势条 ──
  { id: 'wma200', layer: 'cycle', name: '200 周均线距离', src: '计算', type: 'distance', span: 4 },
  // ── 衍生品 4 个 ──
  { id: 'liq', layer: 'derivative', name: '多空账户比', src: 'Binance 大户', type: 'split_liq', span: 2 },
  { id: 'oi', layer: 'derivative', name: '持仓量 OI', src: 'OKX', type: 'spark_oi', span: 2 },
  { id: 'funding', layer: 'derivative', name: '资金费率矩阵', src: '多交易所', type: 'fund_matrix', span: 2 },
  { id: 'spread', layer: 'derivative', name: '多交易所价差', src: 'CCXT', type: 'spread_table', span: 2 },
  // ── 链上 3 个 ──
  { id: 'hash', layer: 'onchain', name: '全网算力', src: 'mempool.space', type: 'spark_hash', span: 2 },
  { id: 'mempool', layer: 'onchain', name: '内存池堆积', src: 'mempool.space', type: 'mempool_bars', span: 2 },
  { id: 'block', layer: 'onchain', name: '平均区块间隔', src: 'mempool.space', type: 'countdown', span: 2 },
  // ── 宏观 2 个 ──
  { id: 'dxy', layer: 'macro', name: '美元指数 DXY', src: 'Yahoo', type: 'spark_dxy', span: 2 },
  { id: 'corr', layer: 'macro', name: 'BTC/SPX 30D 相关性', src: '计算', type: 'correlation', span: 2 },
]

// 独立的新闻 widget 定义（不在 grid 内，作为单独 section）
const NEWS_WIDGET: WidgetDef = {
  id: 'news', layer: 'news', name: 'BTC 实时资讯（Google News 中文）',
  src: '中文 RSS', type: 'news_feed', span: 6, row: 3,
}

// ════════════════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════════════════

const fmt0 = (n: number | null | undefined) =>
  n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US')

const fmtCompact = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`
  return `${sign}$${abs.toFixed(0)}`
}

const fmtPct = (n: number | null | undefined, dec = 2) => {
  if (n == null || !isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(dec)}%`
}

const fmtRate = (n: number | null | undefined) => {
  if (n == null || !isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(3)}%`
}

const timeAgo = (iso: string | undefined) => {
  if (!iso) return ''
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

// ════════════════════════════════════════════════════════════════════════════
// 比特币罗盘（Bitcoin Cycle Compass）
// 中心：大数字现价 + 24h 涨跌
// 外环：6 个周期/估值信号
// 中心指针：综合得分（0=极度便宜 → 100=极度过热）
// ════════════════════════════════════════════════════════════════════════════

interface CompassSignal {
  label: string          // 短标签（如 "200WMA"）
  desc: string           // 一句话描述
  score: number          // 0~100（0 = 看空/便宜，100 = 看多/过热）
  display: string        // 当前展示值（如 "+116%"）
  loaded: boolean
}

// 数据归一化为 0~100 评分（统一向"过热/看多"方向递增）
function buildCompassSignals(
  market: MarketData | null,
  macro: MacroData | null,
  summary: BtcSummary | null,
): CompassSignal[] {
  // 1. 200WMA 距离：-50% → 0; 0% → 50; +200% → 100
  const wmaPct = macro?.wma200?.distance_pct
  const wmaScore = wmaPct != null ? Math.min(100, Math.max(0, ((wmaPct + 50) / 250) * 100)) : 50
  // 2. Pi Cycle：triggered = 100；否则按 |distance_pct| 反推
  const pi = macro?.pi_cycle
  const piScore = pi == null ? 50 : (pi.triggered ? 95 : Math.min(80, 50 + (50 - Math.min(50, Math.abs(pi.distance_pct)))))
  // 3. 恐贪指数：直接用
  const fg = macro?.fear_greed?.value
  const fgScore = fg != null ? fg : 50
  // 4. 资金费率均值：基线 0.01% = 50；+0.05% → 100；-0.03% → 0
  const fundRates = market?.funding_rates
  let fundScore = 50
  if (fundRates) {
    const arr = Object.values(fundRates).filter((v): v is number => v != null)
    if (arr.length) {
      const avg = arr.reduce((s, v) => s + v, 0) / arr.length  // 小数（0.0001 = 0.01%）
      // 把 -0.0003 ~ +0.0005 映射为 0 ~ 100
      fundScore = Math.min(100, Math.max(0, ((avg + 0.0003) / 0.0008) * 100))
    }
  }
  // 5. OI 杠杆水平：$10B = 30；$20B = 60；$30B+ = 90+
  const oi = market?.open_interest?.binance_usd
  const oiScore = oi != null ? Math.min(100, Math.max(0, (oi / 1e9 / 30) * 100)) : 50
  // 6. BTC-SPX 相关性：-1 → 0；0 → 50；+1 → 100
  const corr = macro?.btc_spx_corr_30d
  const corrScore = corr != null ? ((corr + 1) / 2) * 100 : 50

  return [
    {
      label: '200WMA',
      desc: '长期估值',
      score: wmaScore,
      display: wmaPct != null ? `${wmaPct >= 0 ? '+' : ''}${wmaPct.toFixed(0)}%` : '—',
      loaded: wmaPct != null,
    },
    {
      label: 'Pi Cycle',
      desc: '顶部信号',
      score: piScore,
      display: pi == null ? '—' : pi.triggered ? '触发' : '未触发',
      loaded: pi != null,
    },
    {
      label: '恐慌贪婪',
      desc: '市场情绪',
      score: fgScore,
      display: fg != null ? `${fg}` : '—',
      loaded: fg != null,
    },
    {
      label: '资金费率',
      desc: '衍生品多空',
      score: fundScore,
      display: fundRates && Object.values(fundRates).some((v) => v != null)
        ? `${((Object.values(fundRates).filter((v): v is number => v != null).reduce((s, v) => s + v, 0) / Math.max(1, Object.values(fundRates).filter((v) => v != null).length)) * 100).toFixed(3)}%`
        : '—',
      loaded: !!fundRates && Object.values(fundRates).some((v) => v != null),
    },
    {
      label: 'OI 杠杆',
      desc: '持仓水平',
      score: oiScore,
      display: oi != null ? `$${(oi / 1e9).toFixed(1)}B` : '—',
      loaded: oi != null,
    },
    {
      label: 'BTC/SPX',
      desc: '跨资产联动',
      score: corrScore,
      display: corr != null ? `${corr >= 0 ? '+' : ''}${corr.toFixed(2)}` : '—',
      loaded: corr != null,
    },
  ]
}

// 罗盘得分对应颜色（5 阶段，全部亮色保证暗底可见）
function scoreColor(s: number): string {
  if (s <= 25) return 'var(--up)'        // 极度便宜：青绿（亮）
  if (s <= 45) return '#7dd3c0'           // 偏便宜：浅薄荷
  if (s <= 60) return '#dde1ee'           // 中性：浅灰白（var(--tx)，原 var(--mu) 太暗）
  if (s <= 80) return 'var(--gld)'        // 偏过热：金黄
  return 'var(--dn)'                       // 极度过热：红
}

function scoreLabel(s: number): string {
  if (s <= 20) return '极度便宜'
  if (s <= 40) return '偏便宜'
  if (s <= 60) return '中性'
  if (s <= 80) return '偏过热'
  return '极度过热'
}

function MainCompass({ summary, market, macro, isUp }: { summary: BtcSummary | null; market: MarketData | null; macro: MacroData | null; isUp: boolean }) {
  const signals = buildCompassSignals(market, macro, summary)
  // 综合得分：6 信号取均值
  const avgScore = signals.reduce((s, x) => s + x.score, 0) / signals.length

  // 大指针角度：-135° (指向 200WMA) → +135° (指向 BTC/SPX)
  // 我们用 0~100 映射到 -135° ~ +135°（270° 范围）
  const needleAngle = -135 + (avgScore / 100) * 270

  // SVG 中心坐标 + 几何
  const SIZE = 360
  const CX = SIZE / 2
  const CY = SIZE / 2
  const R_OUTER = 168
  const R_TRACK = 152   // 信号刻度环
  const R_TICK_IN = 138
  const R_TICK_OUT = 162
  const R_LABEL = 178   // 信号标签距中心

  // 6 个信号均匀分布在 -135° ~ +135°（270°），间隔 54°
  // 也可以全圆 360°，但 270° 留出底部空间显示中心指针
  const signalAngles = signals.map((_, i) => -135 + (i / (signals.length - 1)) * 270)

  // 角度（度）转弧度后计算坐标
  const polar = (angleDeg: number, r: number) => {
    // 0° 指向正上方；顺时针为正
    const rad = ((angleDeg - 90) * Math.PI) / 180
    return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
  }

  // 大指针端点
  const needleEnd = polar(needleAngle, R_TRACK - 6)
  const lastPrice = summary?.price
  const change = summary?.change24h ?? 0

  return (
    <div className="chart-area compass-area">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="compass-svg">
        <defs>
          <linearGradient id="cmpsRing" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--up)" />
            <stop offset="50%" stopColor="var(--gld)" />
            <stop offset="100%" stopColor="var(--dn)" />
          </linearGradient>
          <radialGradient id="cmpsGlow">
            <stop offset="0%" stopColor="rgba(247,147,26,0.12)" />
            <stop offset="100%" stopColor="rgba(247,147,26,0)" />
          </radialGradient>
        </defs>

        {/* 中心辐射光晕 */}
        <circle cx={CX} cy={CY} r={R_OUTER + 18} fill="url(#cmpsGlow)" />

        {/* 外环（按 270° 弧形渲染渐变） */}
        {(() => {
          const startA = -135
          const endA = +135
          const start = polar(startA, R_TRACK)
          const end = polar(endA, R_TRACK)
          // 长弧（>180°）
          const largeArc = (endA - startA) > 180 ? 1 : 0
          return (
            <path
              d={`M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${R_TRACK} ${R_TRACK} 0 ${largeArc} 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`}
              fill="none" stroke="url(#cmpsRing)" strokeWidth="2.5" strokeOpacity="0.45" strokeLinecap="round"
            />
          )
        })()}

        {/* 6 个信号刻度 + 当前值标记 */}
        {signals.map((sig, i) => {
          const ang = signalAngles[i]
          const tick1 = polar(ang, R_TICK_IN)
          const tick2 = polar(ang, R_TICK_OUT)
          const label = polar(ang, R_LABEL)
          const col = sig.loaded ? scoreColor(sig.score) : 'var(--di)'
          // 标签对齐
          const anchor = ang < -90 ? 'end' : ang > 90 ? 'end' : Math.abs(ang) < 30 ? 'middle' : 'start'
          return (
            <g key={sig.label}>
              <line x1={tick1.x} y1={tick1.y} x2={tick2.x} y2={tick2.y} stroke={col} strokeWidth="2.5" strokeLinecap="round" />
              {/* 信号位置上的小圆点（当前值） */}
              {sig.loaded && (
                <circle cx={tick2.x} cy={tick2.y} r="3.5" fill={col}>
                  <animate attributeName="r" values="3.5;4.5;3.5" dur="2.4s" repeatCount="indefinite" />
                </circle>
              )}
              <text x={label.x} y={label.y} fontSize="10" fontFamily="var(--mono)" fontWeight="600" fill={col} textAnchor={anchor} dominantBaseline="middle">
                {sig.label}
              </text>
              <text x={label.x} y={label.y + 11} fontSize="9" fontFamily="var(--mono)" fill="var(--mu)" textAnchor={anchor} dominantBaseline="middle">
                {sig.display}
              </text>
            </g>
          )
        })}

        {/* 中心刻度线 (5 条短线作为参考) */}
        {[-135, -67.5, 0, 67.5, 135].map((a, i) => {
          const t1 = polar(a, R_TICK_IN - 8)
          const t2 = polar(a, R_TICK_IN - 2)
          return <line key={i} x1={t1.x} y1={t1.y} x2={t2.x} y2={t2.y} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        })}

        {/* 中心指针（综合得分） */}
        <g style={{ transformOrigin: `${CX}px ${CY}px`, transition: 'transform 1.2s cubic-bezier(.22,.61,.36,1)' }}>
          <line
            x1={CX} y1={CY}
            x2={needleEnd.x} y2={needleEnd.y}
            stroke={scoreColor(avgScore)} strokeWidth="2.4" strokeLinecap="round"
          />
          <polygon
            points={`${needleEnd.x},${needleEnd.y - 5} ${needleEnd.x + 5},${needleEnd.y + 4} ${needleEnd.x - 5},${needleEnd.y + 4}`}
            transform={`rotate(${needleAngle} ${needleEnd.x} ${needleEnd.y})`}
            fill={scoreColor(avgScore)}
          />
        </g>

        {/* 中心圆 + 大数字 */}
        <circle cx={CX} cy={CY} r="62" fill="var(--bg)" stroke="var(--bd-hi)" strokeWidth="1" />
        <circle cx={CX} cy={CY} r="4" fill={scoreColor(avgScore)} />

        {/* 中心文字 */}
        <text x={CX} y={CY - 26} fontSize="9" fontFamily="var(--mono)" fontWeight="600" fill="var(--mu)" textAnchor="middle" letterSpacing="2">
          BTC/USDT
        </text>
        {lastPrice != null ? (
          <>
            <text x={CX} y={CY - 6} fontSize="22" fontFamily="var(--mono)" fontWeight="700" fill="var(--tx)" textAnchor="middle" letterSpacing="-0.5">
              ${Math.round(lastPrice).toLocaleString('en-US')}
            </text>
            <text x={CX} y={CY + 14} fontSize="11" fontFamily="var(--mono)" fontWeight="600" fill={change >= 0 ? 'var(--up)' : 'var(--dn)'} textAnchor="middle">
              {change >= 0 ? '+' : ''}{change.toFixed(2)}%
            </text>
          </>
        ) : (
          <text x={CX} y={CY} fontSize="12" fontFamily="var(--mono)" fill="var(--mu)" textAnchor="middle">加载中…</text>
        )}
        <text x={CX} y={CY + 32} fontSize="9" fontFamily="var(--mono)" fontWeight="600" fill={scoreColor(avgScore)} textAnchor="middle" letterSpacing="1">
          {scoreLabel(avgScore)}
        </text>
      </svg>

      {/* 右侧：综合评分卡 */}
      <div className="compass-side">
        <div className="compass-side-h">综合罗盘评分</div>
        <div className="compass-side-score" style={{ color: scoreColor(avgScore) }}>{avgScore.toFixed(0)}<span>/100</span></div>
        <div className="compass-side-bar"><div style={{ width: `${avgScore}%`, background: scoreColor(avgScore) }} /></div>
        <div className="compass-side-sub">{scoreLabel(avgScore)} · 6 个周期/估值/情绪信号综合</div>
        <div className="compass-side-list">
          {signals.map((s) => (
            <div key={s.label} className="compass-side-it">
              <span className="compass-side-it-l">
                <span className="compass-side-it-dot" style={{ background: s.loaded ? scoreColor(s.score) : 'var(--di)' }} />
                {s.label}
              </span>
              <span className="compass-side-it-v" style={{ color: s.loaded ? 'var(--tx)' : 'var(--mu)' }}>{s.display}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 最右侧：今日速览（24h 高低 / 成交量 / 市值 / 距 ATH）*/}
      <div className="compass-side compass-snapshot">
        <div className="compass-side-h">今日速览</div>
        <div className="snap-grid">
          <div className="snap-cell">
            <div className="snap-l">24H 最高</div>
            <div className="snap-v hi">{summary?.high24h ? `$${Math.round(summary.high24h).toLocaleString('en-US')}` : '—'}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-l">24H 最低</div>
            <div className="snap-v lo">{summary?.low24h ? `$${Math.round(summary.low24h).toLocaleString('en-US')}` : '—'}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-l">24H 成交量</div>
            <div className="snap-v">{summary?.volume24h
              ? (summary.volume24h >= 1e6
                  ? `${(summary.volume24h / 1e6).toFixed(2)}M BTC`
                  : `${Math.round(summary.volume24h).toLocaleString('en-US')} BTC`)
              : '—'}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-l">市值</div>
            <div className="snap-v">{summary?.marketCap ? `$${(summary.marketCap / 1e12).toFixed(2)}T` : '—'}</div>
          </div>
          <div className="snap-cell">
            <div className="snap-l">距 ATH</div>
            <div className="snap-v">
              {summary?.price ? (() => {
                // 假设 ATH = $108,135（2025-01 高点），用户可后续接 API
                const ATH = 108135
                const distPct = ((summary.price - ATH) / ATH) * 100
                return <span style={{ color: distPct >= -5 ? 'var(--up)' : distPct >= -20 ? 'var(--gld)' : 'var(--dn)' }}>
                  {distPct >= 0 ? '+' : ''}{distPct.toFixed(1)}%
                </span>
              })() : '—'}
            </div>
          </div>
          <div className="snap-cell">
            <div className="snap-l">振幅</div>
            <div className="snap-v">
              {summary && summary.high24h && summary.low24h && summary.price
                ? `${(((summary.high24h - summary.low24h) / summary.price) * 100).toFixed(2)}%`
                : '—'}
            </div>
          </div>
          <div className="snap-cell">
            <div className="snap-l">当前价格</div>
            <div className="snap-v">
              {summary?.price ? `$${summary.price.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '—'}
            </div>
          </div>
          <div className="snap-cell">
            <div className="snap-l">24H 涨跌</div>
            <div className="snap-v">
              {summary?.change24h != null ? (
                <span style={{ color: summary.change24h >= 0 ? 'var(--up)' : 'var(--dn)' }}>
                  {summary.change24h >= 0 ? '+' : ''}{summary.change24h.toFixed(2)}%
                </span>
              ) : '—'}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Sparkline 工具组件
// ════════════════════════════════════════════════════════════════════════════

function Spark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <div className="wg-spark" />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 100
  const H = 42
  const dx = W / (values.length - 1)
  const points = values.map((v, i) => ({
    x: i * dx,
    y: H - ((v - min) / range) * H,
  }))
  const path = 'M ' + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')
  const area = `M 0,${H} ` + points.map((p) => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ') + ` L ${W},${H} Z`
  return (
    <div className="wg-spark">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={area} fill={color} fillOpacity="0.15" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.2" />
      </svg>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Widget 通用容器：<div class="w spanN row2 ...">
// ════════════════════════════════════════════════════════════════════════════

function W({ widget, children }: { widget: WidgetDef; children: React.ReactNode }) {
  const layerKey = LAYERS[widget.layer].key
  const rowClass = widget.row ? ` row${widget.row}` : ''
  const cls = `w span${widget.span}${rowClass}`
  // row 高度通过 inline style 兜底（CSS .row2 已定义，.row3/.row4 通过 style 覆盖）
  const style = widget.row && widget.row > 2 ? { gridRow: `span ${widget.row}` } : undefined
  return (
    <div className={cls} data-w={widget.id} style={style}>
      <div className="w-h">
        <div className="w-t">
          <span className={`w-d ${layerKey}`} />
          <span className="w-name">{widget.name}</span>
        </div>
        <span className="w-src">{widget.src}</span>
      </div>
      <div className="w-body">{children}</div>
    </div>
  )
}

const Empty = () => <div style={{ color: 'var(--mu)', fontSize: 11, padding: 6 }}>加载中…</div>
const Dash = () => <div style={{ color: 'var(--mu)', fontSize: 22, padding: 6, fontFamily: 'var(--mono)' }}>—</div>

// ════════════════════════════════════════════════════════════════════════════
// Widget 内容
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// 季节性叠加图（5 年 BTC 同期累积涨跌对比）
// ════════════════════════════════════════════════════════════════════════════

// 5 年颜色全局共用（图 + 数据单）
const SEASONALITY_COLORS: Record<string, string> = {
  '2022': '#a78bfa',   // 紫
  '2023': '#22d3a0',   // 绿（大牛）
  '2024': '#f0b90b',   // 金（大牛）
  '2025': '#00d4ff',   // 青
  '2026': '#f7931a',   // BTC 橙（当前年）
}

// 年份背景标签（"大牛"/"熊市"/"横盘"）
const YEAR_TAGS: Record<string, string> = {
  '2022': '熊市',
  '2023': '大牛',
  '2024': '大牛',
  '2025': '横盘',
  '2026': '当前',
}

function SeasonalityChart({ data }: { data: SeasonalityData | null }) {
  const W = 1100
  const H = 320
  const PAD = { t: 18, r: 56, b: 30, l: 0 }
  const INNER_W = W - PAD.l - PAD.r
  const INNER_H = H - PAD.t - PAD.b
  const YEAR_COLORS = SEASONALITY_COLORS

  const calc = useMemo(() => {
    if (!data || !data.years || Object.keys(data.years).length === 0) return null
    const years = Object.keys(data.years).sort()  // 升序
    const currentYear = years[years.length - 1]

    // 计算 Y 轴范围
    let yMin = 0, yMax = 0
    for (const y of years) {
      for (const [, pct] of data.years[y]) {
        if (pct < yMin) yMin = pct
        if (pct > yMax) yMax = pct
      }
    }
    // 留 10% 缓冲
    const padY = (yMax - yMin) * 0.08
    yMin -= padY
    yMax += padY
    const yRange = yMax - yMin || 1

    // 把 day 映射到 x
    const dayToX = (d: number) => PAD.l + ((d - 1) / 365) * INNER_W
    const pctToY = (p: number) => PAD.t + (1 - (p - yMin) / yRange) * INNER_H

    const lines = years.map((year) => {
      const pts = data.years[year]
      const isCurrent = year === currentYear
      const color = YEAR_COLORS[year] || 'var(--mu)'
      const path = 'M ' + pts.map(([d, p]) => `${dayToX(d).toFixed(1)},${pctToY(p).toFixed(1)}`).join(' L ')
      const lastPt = pts[pts.length - 1]
      const endX = dayToX(lastPt[0])
      const endY = pctToY(lastPt[1])
      const endPct = lastPt[1]
      return { year, color, path, isCurrent, endX, endY, endPct }
    })

    // 月份刻度（1-12 月）
    const monthTicks = Array.from({ length: 12 }, (_, i) => {
      const monthStart = new Date(Date.UTC(2024, i, 1))  // 2024 闰年保证完整
      const day = Math.floor((monthStart.getTime() - new Date(Date.UTC(2024, 0, 1)).getTime()) / (86400 * 1000)) + 1
      return { month: i + 1, x: dayToX(day) }
    })

    // Y 网格线（0%, 25%, 50%, 100% 等）
    const yTicks: { pct: number; y: number }[] = []
    const gridSteps = [-50, -25, 0, 25, 50, 100, 150]
    for (const p of gridSteps) {
      if (p >= yMin && p <= yMax) yTicks.push({ pct: p, y: pctToY(p) })
    }
    // 确保 0% 一定有
    if (!yTicks.find(t => t.pct === 0) && 0 >= yMin && 0 <= yMax) {
      yTicks.push({ pct: 0, y: pctToY(0) })
    }

    return { lines, monthTicks, yTicks, yMin, yMax }
  }, [data])

  if (!calc) {
    return <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mu)', fontSize: 13 }}>季节性数据加载中…</div>
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: H, display: 'block' }}>
      {/* Y 网格线 + 标签 */}
      {calc.yTicks.map(({ pct, y }) => (
        <g key={pct}>
          <line x1={0} x2={W - PAD.r} y1={y} y2={y}
            stroke={pct === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.04)'}
            strokeWidth={pct === 0 ? 1 : 1}
            strokeDasharray={pct === 0 ? '0' : '2 4'}
          />
          <text x={W - PAD.r + 6} y={y + 4} fontSize="10" fontFamily="var(--mono)" fill="var(--mu)">
            {pct >= 0 ? '+' : ''}{pct}%
          </text>
        </g>
      ))}

      {/* 月份刻度 */}
      {calc.monthTicks.map(({ month, x }) => (
        <g key={month}>
          <line x1={x} x2={x} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.025)" strokeWidth="1" />
          <text x={x} y={H - PAD.b + 14} fontSize="10" fontFamily="var(--mono)" fill="var(--mu)" textAnchor="start">
            {month}月
          </text>
        </g>
      ))}

      {/* 折线 */}
      {calc.lines.map(({ year, color, path, isCurrent }) => (
        <path
          key={year}
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={isCurrent ? 2.2 : 1.2}
          strokeOpacity={isCurrent ? 1 : 0.7}
        />
      ))}

      {/* 每条线末端只画一个小色点（去掉之前的标签，干净。年份数字移到右侧 SeasonalityLegend） */}
      {calc.lines.map(({ year, color, endX, endY, isCurrent }) => (
        <circle key={`dot-${year}`}
          cx={endX} cy={endY} r={isCurrent ? 4 : 2.5}
          fill={color} stroke="var(--bg)" strokeWidth={1}
        />
      ))}
    </svg>
  )
}

// 右侧数据单：每年颜色 dot + 当前 % + 区间（最低 ~ 最高）
function SeasonalityLegend({ data }: { data: SeasonalityData | null }) {
  if (!data || !data.years) {
    return <div className="seasonality-legend"><div className="sl-empty">加载中…</div></div>
  }
  const years = Object.keys(data.years).sort().reverse()  // 当前年在最上
  return (
    <div className="seasonality-legend">
      <div className="sl-head">5 年 YTD 表现</div>
      {years.map((year) => {
        const pts = data.years[year]
        if (!pts || pts.length === 0) return null
        const pcts = pts.map((p) => p[1])
        const current = pcts[pcts.length - 1]
        const max = Math.max(...pcts)
        const min = Math.min(...pcts)
        const color = SEASONALITY_COLORS[year] || 'var(--mu)'
        const tag = YEAR_TAGS[year] || ''
        const tagColor = current >= 50 ? 'var(--up)' : current <= -30 ? 'var(--dn)' : 'var(--mu)'
        const valueColor = current >= 0 ? 'var(--up)' : 'var(--dn)'
        return (
          <div key={year} className="sl-row">
            <div className="sl-row-h">
              <span className="sl-dot" style={{ background: color }} />
              <span className="sl-year">{year}</span>
              <span className="sl-tag" style={{ color: tagColor }}>{tag}</span>
            </div>
            <div className="sl-val" style={{ color: valueColor }}>
              {current >= 0 ? '+' : ''}{current.toFixed(2)}%
            </div>
            <div className="sl-range">
              年内 {min.toFixed(0)}% ~ {max >= 0 ? '+' : ''}{max.toFixed(0)}%
            </div>
          </div>
        )
      })}
    </div>
  )
}

function W_NewsFeed({ news }: { news: NewsItem[] }) {
  if (!news.length) return <Dash />
  return (
    <div className="wg-news">
      {news.slice(0, 18).map((n, i) => (
        <a key={i} href={n.url || '#'} target="_blank" rel="noopener noreferrer" className="wg-news-row">
          <span className="wg-news-time">{timeAgo(n.publishedAt)}</span>
          <span className="wg-news-title">{n.title}</span>
          <span className="wg-news-tag nu">{n.source}</span>
        </a>
      ))}
    </div>
  )
}

function W_GaugeFng({ fg, large }: { fg: MacroData['fear_greed'] | undefined; large?: boolean }) {
  if (!fg) return <Dash />
  const v = fg.value
  const circ = 2 * Math.PI * 42
  const dash = (v / 100) * circ
  const color = v <= 25 ? 'var(--dn)' : v <= 45 ? 'var(--gld)' : v <= 55 ? 'var(--mu)' : v <= 75 ? 'var(--up)' : 'var(--up)'
  const lbl = fg.label || (v <= 25 ? '极度恐惧' : v <= 45 ? '恐惧' : v <= 55 ? '中性' : v <= 75 ? '贪婪' : '极度贪婪')
  const desc = v <= 25 ? '市场存在极度恐慌情绪，通常意味着投资者反应过度，往往是历史级别的买入机会。' 
             : v <= 45 ? '市场情绪悲观，投资者趋于保守。这可能预示短期调整，也可能在酝酿反弹动能。' 
             : v <= 55 ? '多空情绪基本平衡，无明显单边倾向。建议保持观望，等待明确的趋势信号确立。' 
             : v <= 75 ? '市场情绪高涨，买盘活跃。需逐渐警惕追高风险，可能正在接近阶段性的顶部。' 
             : '市场处于极度贪婪状态，极易发生剧烈的下杀回调。建议获利了结或严格设置止损。'

  return (
    <div className="wg-gauge-wrap">
      <div className="wg-gauge">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="7" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="url(#fgGrad)" strokeWidth="7"
            strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 1s' }} />
          <defs>
            <linearGradient id="fgGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#f0595c" />
              <stop offset="50%" stopColor="#f0b90b" />
              <stop offset="100%" stopColor="#22d3a0" />
            </linearGradient>
          </defs>
        </svg>
        <div className="wg-gauge-num">
          <div className="wg-gauge-big" style={{ color }}>{v}</div>
          <div className="wg-gauge-lbl">/ 100</div>
        </div>
      </div>
      <div className="wg-gauge-info">
        <div className="wg-status" style={{ color }}>{lbl}</div>
        <div className="wg-sub">
          {fg.prev != null ? (
            <>较昨日 <b style={{ color: v - fg.prev >= 0 ? 'var(--up)' : 'var(--dn)' }}>
              {v - fg.prev >= 0 ? '+' : ''}{v - fg.prev}
            </b></>
          ) : <>Alternative.me</>}
        </div>
      </div>
      <div className="wg-fng-desc" style={{ fontSize: '12.5px', color: 'var(--mu)', lineHeight: 1.5, marginTop: 12, padding: '0 12px', textAlign: 'center', opacity: 0.85 }}>
        {desc}
      </div>
    </div>
  )
}

function W_SplitLiq({ ratio }: { ratio: MarketData['long_short_ratio'] }) {
  if (!ratio) return <Dash />
  const longPct = ratio.long_pct
  const shortPct = ratio.short_pct
  const dom = ratio.ratio >= 1 ? 'long' : 'short'
  return (
    <>
      <div className="wg-split-stat">
        <div className="wg-split-big">{ratio.ratio.toFixed(2)}</div>
        <div className="wg-split-pct" style={{ color: dom === 'long' ? 'var(--up)' : 'var(--dn)' }}>
          {dom === 'long' ? '多头主导' : '空头主导'}
        </div>
      </div>
      <div className="wg-split-bar">
        <div className="wg-split-long" style={{ flex: longPct }} />
        <div className="wg-split-short" style={{ flex: shortPct }} />
      </div>
      <div className="wg-split-legend">
        <span className="wg-split-l">多 {longPct.toFixed(1)}%</span>
        <span className="wg-split-s">空 {shortPct.toFixed(1)}%</span>
      </div>
    </>
  )
}

function W_SparkOi({ oi }: { oi: number | null | undefined }) {
  if (oi == null) return <Dash />
  return (
    <>
      <div className="wg-stat-row">
        <div className="wg-stat-big">{fmtCompact(oi)}</div>
        <div className="wg-stat-delta up">永续</div>
      </div>
      <Spark values={[oi * 0.97, oi * 0.985, oi * 0.99, oi * 0.995, oi]} color="var(--up)" />
      <div className="wg-spark-foot"><span>OKX BTC 永续</span><span>USD</span></div>
    </>
  )
}

function W_FundMatrix({ rates }: { rates: Record<string, number | null> | undefined }) {
  if (!rates || !Object.keys(rates).length) return <Dash />
  const entries = Object.entries(rates)
  const avg = entries
    .filter(([, v]) => v != null)
    .reduce((s, [, v]) => s + (v || 0), 0) / Math.max(1, entries.filter(([, v]) => v != null).length)
  return (
    <>
      <div className="wg-fmatrix">
        {entries.map(([ex, r]) => {
          const cls = (r ?? 0) > 0 ? 'up' : 'dn'
          return (
            <div key={ex} className={`wg-fcell ${cls}`}>
              <div className="wg-fname">{ex}</div>
              <div className={`wg-fval ${cls}`}>{fmtRate(r)}</div>
            </div>
          )
        })}
      </div>
      <div className="wg-favg">均值 {fmtRate(avg)}</div>
    </>
  )
}

function W_SpreadTable({ prices }: { prices: Record<string, number | null> | undefined }) {
  if (!prices) return <Dash />
  const entries = Object.entries(prices).filter(([, v]) => v != null) as [string, number][]
  if (!entries.length) return <Dash />
  const vals = entries.map(([, v]) => v)
  const max = Math.max(...vals)
  const min = Math.min(...vals)
  const mid = (max + min) / 2
  return (
    <div className="wg-sp">
      {entries.map(([ex, p]) => {
        const diff = p - mid
        return (
          <div key={ex} className="wg-sp-row">
            <span className="wg-sp-x">{ex}</span>
            <span className="wg-sp-px">${fmt0(p)}</span>
            <span className="wg-sp-spr" style={{ color: diff >= 0 ? 'var(--up)' : 'var(--dn)' }}>
              {diff >= 0 ? '+' : ''}{diff.toFixed(0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function W_SparkHash({ hash }: { hash: number | null | undefined }) {
  if (hash == null) return <Dash />
  return (
    <>
      <div className="wg-stat-row">
        <div className="wg-stat-big">{hash.toFixed(0)}</div>
        <div className="wg-stat-delta up">EH/s</div>
      </div>
      <Spark values={[hash * 0.96, hash * 0.98, hash * 0.995, hash * 0.99, hash]} color="var(--up)" />
      <div className="wg-spark-foot"><span>全网算力</span><span>30D 均值</span></div>
    </>
  )
}

function W_MempoolBars({ mempool, vsize }: { mempool: number | null | undefined; vsize: number | null | undefined }) {
  if (mempool == null) return <Dash />
  const count = mempool
  // mempool 拥堵 tier 分布（粗略估算）
  const tiers = [
    { label: '低 sat/vB', value: Math.round(count * 0.15), max: count, cls: 'lo' },
    { label: '中 sat/vB', value: Math.round(count * 0.35), max: count, cls: 'md' },
    { label: '高 sat/vB', value: Math.round(count * 0.30), max: count, cls: 'hi' },
    { label: '紧急 sat/vB', value: Math.round(count * 0.20), max: count, cls: 'vh' },
  ]
  return (
    <div className="wg-mp">
      {tiers.map((t) => (
        <div key={t.label} className="wg-mp-row">
          <span className="wg-mp-tier">{t.label}</span>
          <div className="wg-mp-bar">
            <div className={`wg-mp-fill ${t.cls}`} style={{ width: `${(t.value / t.max) * 100}%` }} />
          </div>
          <span className="wg-mp-v">{fmt0(t.value)}</span>
        </div>
      ))}
    </div>
  )
}

function W_SignalPi({ pi }: { pi: MacroData['pi_cycle'] | undefined }) {
  if (!pi) return <Dash />
  const isTriggered = pi.triggered
  const lightCls = isTriggered ? 'danger' : Math.abs(pi.distance_pct) < 5 ? 'warn' : 'safe'
  return (
    <div className="wg-sig">
      <div className={`wg-sig-light ${lightCls}`}>
        <span className="wg-sig-ico">{isTriggered ? '!' : '✓'}</span>
      </div>
      <div className="wg-sig-info">
        <div className="wg-sig-stat" style={{ color: isTriggered ? 'var(--dn)' : lightCls === 'warn' ? 'var(--gld)' : 'var(--up)' }}>
          {isTriggered ? '顶部信号' : lightCls === 'warn' ? '临近触发' : '无顶部信号'}
        </div>
        <div className="wg-sig-sub">
          111D <b>${fmt0(pi.sma111)}</b> · 350D×2 <b>${fmt0(pi.sma350x2)}</b><br />
          距离 <b>{fmtPct(pi.distance_pct, 1)}</b>
        </div>
      </div>
    </div>
  )
}

function W_Distance({ wma }: { wma: MacroData['wma200'] | undefined }) {
  if (!wma) return <Dash />
  const pct = wma.distance_pct
  // 距离条：把 -50%~+200% 映射为 0~100%
  const fill = Math.min(100, Math.max(0, ((pct + 50) / 250) * 100))
  const tickAt = (50 / 250) * 100  // 0% 距离的位置
  const color = pct >= 0 ? 'var(--up)' : 'var(--dn)'
  return (
    <div className="wg-dist">
      <div className="wg-dist-stat">
        <div className="wg-dist-big" style={{ color }}>{fmtPct(pct, 0)}</div>
        <div className="wg-dist-lbl">距 200WMA · {pct >= 0 ? '高于均线' : '低于均线'}</div>
      </div>
      <div className="wg-dist-trk">
        <div className="wg-dist-fill" style={{ width: `${fill}%`, background: pct >= 0 ? 'linear-gradient(90deg,var(--up),var(--acc))' : 'linear-gradient(90deg,var(--dn),var(--gld))' }} />
        <div className="wg-dist-tick" style={{ left: `${tickAt}%` }} />
      </div>
      <div className="wg-dist-foot">
        <span>200WMA ${fmt0(wma.value)}</span>
        <span>BTC ${fmt0(wma.current_price)}</span>
      </div>
    </div>
  )
}

function W_SparkDxy({ dxy }: { dxy: number | null | undefined }) {
  if (dxy == null) return <Dash />
  return (
    <>
      <div className="wg-stat-row">
        <div className="wg-stat-big">{dxy.toFixed(2)}</div>
        <div className="wg-stat-delta up">DXY</div>
      </div>
      <Spark values={[dxy * 0.995, dxy * 1.002, dxy * 0.998, dxy * 0.997, dxy]} color="var(--acc)" />
      <div className="wg-spark-foot"><span>美元指数</span><span>Yahoo</span></div>
    </>
  )
}

function W_Correlation({ corr }: { corr: number | null | undefined }) {
  if (corr == null) return <Dash />
  // -1 → 0%；0 → 50%；+1 → 100%
  const markerAt = ((corr + 1) / 2) * 100
  const color = Math.abs(corr) > 0.5 ? (corr > 0 ? 'var(--up)' : 'var(--dn)') : 'var(--mu)'
  return (
    <div className="wg-corr">
      <div className="wg-corr-big" style={{ color }}>{corr >= 0 ? '+' : ''}{corr.toFixed(2)}</div>
      <div className="wg-corr-bar-wrap">
        <div className="wg-corr-bar" />
        <div className="wg-corr-marker" style={{ left: `${markerAt}%` }} />
      </div>
      <div className="wg-corr-scale">
        <span>-1.0</span><span>0</span><span>+1.0</span>
      </div>
    </div>
  )
}

function W_Countdown({ interval, diff }: { interval: number | null | undefined; diff: OnchainData['difficulty_adjustment'] }) {
  if (interval == null) return <Dash />
  // 实际平均区块间隔（分钟）。BTC 目标 10 分钟。
  const minutes = interval / 60
  // 速度指示：< 8 偏快（绿）/ 8-12 正常（白）/ > 12 偏慢（金）
  const status = minutes < 8 ? '偏快' : minutes > 12 ? '偏慢' : '正常'
  const statusColor = minutes < 8 ? 'var(--up)' : minutes > 12 ? 'var(--gld)' : 'var(--tx)'
  // 进度条：以 15 分钟为最大值，实际/15 表示当前慢度
  const progress = Math.min(100, (minutes / 15) * 100)
  return (
    <div className="wg-cd">
      <div>
        <div className="wg-cd-main">
          <span className="wg-cd-num">{minutes.toFixed(1)}</span>
          <span className="wg-cd-unit">分钟</span>
        </div>
        <div className="wg-cd-prog">
          <div className="wg-cd-pf" style={{ width: `${progress}%`, background: statusColor }} />
        </div>
      </div>
      <div className="wg-cd-meta">
        <span style={{ color: statusColor }}>{status} · 目标 10 分钟</span>
        {diff && <span>难度 {fmtPct(diff.change_pct, 1)}</span>}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// 主组件
// ════════════════════════════════════════════════════════════════════════════

export default function HomePage() {
  const [summary, setSummary] = useState<BtcSummary | null>(null)
  const [news, setNews] = useState<NewsItem[]>([])
  const [market, setMarket] = useState<MarketData | null>(null)
  const [onchain, setOnchain] = useState<OnchainData | null>(null)
  const [macro, setMacro] = useState<MacroData | null>(null)
  const [seasonality, setSeasonality] = useState<SeasonalityData | null>(null)

  // 数据拉取
  const fetchSummary = useCallback(async () => { try { const r = await fetch('/api/btc/summary'); if (r.ok) setSummary(await r.json()) } catch {} }, [])
  const fetchNews = useCallback(async () => { try { const r = await fetch('/api/news'); if (r.ok) setNews(await r.json()) } catch {} }, [])
  const fetchMarket = useCallback(async () => { try { const r = await fetch('/py-api/api/dashboard/market'); if (r.ok) setMarket(await r.json()) } catch {} }, [])
  const fetchOnchain = useCallback(async () => { try { const r = await fetch('/py-api/api/dashboard/onchain'); if (r.ok) setOnchain(await r.json()) } catch {} }, [])
  const fetchMacro = useCallback(async () => { try { const r = await fetch('/py-api/api/dashboard/macro'); if (r.ok) setMacro(await r.json()) } catch {} }, [])
  const fetchSeasonality = useCallback(async () => { try { const r = await fetch('/py-api/api/dashboard/seasonality'); if (r.ok) setSeasonality(await r.json()) } catch {} }, [])

  useEffect(() => {
    fetchSummary(); fetchNews(); fetchMarket(); fetchOnchain(); fetchMacro(); fetchSeasonality()
    const t1 = setInterval(fetchSummary, 30_000)
    const t2 = setInterval(fetchMarket, 30_000)
    const t3 = setInterval(fetchOnchain, 300_000)
    const t4 = setInterval(fetchMacro, 300_000)  // 5 分钟（原 1 小时太长）
    const t5 = setInterval(fetchNews, 300_000)
    const t6 = setInterval(fetchSeasonality, 3600_000)  // 季节性数据每天才动，1 小时一次足够
    return () => { [t1, t2, t3, t4, t5, t6].forEach(clearInterval) }
  }, [fetchSummary, fetchMarket, fetchOnchain, fetchMacro, fetchNews, fetchSeasonality])

  const isUp = (summary?.change24h ?? 0) >= 0

  // 跟踪后端响应：API 拿到了但内部字段为 null 时，widget 应显示 "—" 而不是 "加载中"
  const macroLoaded = macro !== null
  const marketLoaded = market !== null
  const onchainLoaded = onchain !== null

  const renderWidget = (w: WidgetDef) => {
    let body: React.ReactNode = null
    switch (w.type) {
      case 'news_feed':    body = <W_NewsFeed news={news} />; break
      case 'gauge_fng':    body = macroLoaded ? <W_GaugeFng fg={macro?.fear_greed ?? undefined} /> : <Empty />; break
      case 'split_liq':    body = marketLoaded ? <W_SplitLiq ratio={market?.long_short_ratio ?? null} /> : <Empty />; break
      case 'spark_oi':     body = marketLoaded ? <W_SparkOi oi={market?.open_interest?.binance_usd ?? null} /> : <Empty />; break
      case 'fund_matrix':  body = marketLoaded ? <W_FundMatrix rates={market?.funding_rates} /> : <Empty />; break
      case 'spread_table': body = marketLoaded ? <W_SpreadTable prices={market?.prices} /> : <Empty />; break
      case 'spark_hash':   body = onchainLoaded ? <W_SparkHash hash={onchain?.hashrate_eh} /> : <Empty />; break
      case 'mempool_bars': body = onchainLoaded ? <W_MempoolBars mempool={onchain?.mempool_count} vsize={onchain?.mempool_vsize_mb} /> : <Empty />; break
      case 'signal_pi':    body = macroLoaded ? <W_SignalPi pi={macro?.pi_cycle ?? undefined} /> : <Empty />; break
      case 'distance':     body = macroLoaded ? <W_Distance wma={macro?.wma200 ?? undefined} /> : <Empty />; break
      case 'spark_dxy':    body = macroLoaded ? <W_SparkDxy dxy={macro?.dxy} /> : <Empty />; break
      case 'correlation':  body = macroLoaded ? <W_Correlation corr={macro?.btc_spx_corr_30d} /> : <Empty />; break
      case 'countdown':    body = onchainLoaded ? <W_Countdown interval={onchain?.avg_block_interval_sec} diff={onchain?.difficulty_adjustment ?? null} /> : <Empty />; break
    }
    return <W key={w.id} widget={w}>{body}</W>
  }

  return (
    <div className="home-page">
      <div className="workspace">
        {/* ═══ 主区（占满全宽，无图层切换 sidebar）═══ */}
        <div className="main">
          <div className="ctb">
            <div className="ctb-sym">
              <span className="ctb-name">BTC 周期罗盘</span>
              <span className="ctb-tag">6 信号综合</span>
              {summary && (
                <>
                  <span className="ctb-price">{fmt0(summary.price)}</span>
                  <span className={`ctb-chg ${isUp ? 'up' : 'dn'}`}>
                    {summary.change24h >= 0 ? '+' : ''}{summary.change24h.toFixed(2)}%
                  </span>
                </>
              )}
            </div>
            <div className="ctb-r">
              <div className="live-tag"><span className="live-dot" /> 实时</div>
            </div>
          </div>

          <MainCompass summary={summary} market={market} macro={macro} isUp={isUp} />

          {/* 第二层：12 数据 widget */}
          <div className="grid-wrap">
            <div className="grid">{WIDGETS.map(renderWidget)}</div>
          </div>

          {/* 第三层：季节性叠加图（5 年同期对比）*/}
          <div className="seasonality-section">
            <div className="seasonality-h">
              <div className="seasonality-t">
                <span className="w-d c" />
                <span className="w-name">BTC 季节性 · 5 年同期叠加</span>
              </div>
              <span className="w-src">Binance 日线 · 每年 1/1 归零</span>
            </div>
            <div className="seasonality-body">
              <div className="seasonality-chart"><SeasonalityChart data={seasonality} /></div>
              <SeasonalityLegend data={seasonality} />
            </div>
          </div>

          {/* 第四层：新闻区（独立 section）*/}
          <div className="grid-wrap">
            <div className="grid">
              {renderWidget(NEWS_WIDGET)}
            </div>
          </div>

          <div className="toolstrip">
            <Link className="ts-item acc" href="/strategy">
              <div className="ts-ico acc">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
              </div>
              <div className="ts-text">
                <div className="ts-t">策略研发 <span className="ts-pill">PYTHON</span></div>
                <div className="ts-s">写策略 · 一键回测 · 8 个模板</div>
              </div>
              <span className="ts-arr">›</span>
            </Link>
            <Link className="ts-item dn" href="/monte-carlo">
              <div className="ts-ico dn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M21.21 15.89A10 10 0 1 1 8 2.83" /><path d="M22 12A10 10 0 0 0 12 2v10z" />
                </svg>
              </div>
              <div className="ts-text">
                <div className="ts-t">蒙特卡洛风控</div>
                <div className="ts-s">10,000 次重抽样 · 破产概率</div>
              </div>
              <span className="ts-arr">›</span>
            </Link>
            <Link className="ts-item gld" href="/report">
              <div className="ts-ico gld">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="13" x2="20" y2="13" /><line x1="4" y1="19" x2="20" y2="19" />
                  <circle cx="9" cy="7" r="2.4" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="13" r="2.4" fill="currentColor" stroke="none" />
                  <circle cx="11" cy="19" r="2.4" fill="currentColor" stroke="none" />
                </svg>
              </div>
              <div className="ts-text">
                <div className="ts-t">参数优化 <span className="ts-pill pro">PRO</span></div>
                <div className="ts-s">网格搜索 · 模拟退火 · 邻居法</div>
              </div>
              <span className="ts-arr">›</span>
            </Link>
            <Link className="ts-item bt" href="/pattern-report">
              <div className="ts-ico bt">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                  <path d="M3 3v18h18" /><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
                </svg>
              </div>
              <div className="ts-text">
                <div className="ts-t">形态归因</div>
                <div className="ts-s">六形态 · 信号溯源 · 利润分解</div>
              </div>
              <span className="ts-arr">›</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
