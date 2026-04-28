export interface BtcSummary {
  price: number
  change24h: number
  high24h: number
  low24h: number
  volume24h: number
  marketCap: number
}

export interface KlineBar {
  time: number   // Unix timestamp (seconds)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface NewsItem {
  title: string
  url: string
  source: string
  publishedAt: string  // ISO 8601
}
