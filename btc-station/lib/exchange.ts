/**
 * 交易所抽象层
 * Phase 1-2：内部实现使用 OKX（lib/okx.ts）
 * 未来若需切换或增加备用数据源，只改此文件，上层 API 路由不用动
 */

import {
  fetchOkxTicker,
  fetchOkxKlines,
  fetchOkxKlinesChart,
  fetchMarketCap,
  fetchPerpetualInfo,
} from './okx'

export type { TickerData, KlineBar, Market, FundingRate, OpenInterest, PerpetualInfo } from './okx'

export const exchange = {
  /** 当前价 + 24h 统计（支持现货/永续） */
  getTicker: fetchOkxTicker,

  /** 主页 7 日 K 线（简化版） */
  getKlines: fetchOkxKlines,

  /** 图表页 K 线（支持多周期 + 分页 + 现货/永续） */
  getChartKlines: fetchOkxKlinesChart,

  /** 市值（CoinGecko） */
  getMarketCap: fetchMarketCap,

  /** 永续合约信息（资金费率 + 未平仓量 + 多空比） */
  getPerpetualInfo: fetchPerpetualInfo,
}
