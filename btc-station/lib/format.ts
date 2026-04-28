export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

export function formatVolume(value: number): string {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`
  if (value >= 1_000_000_000)     return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000)         return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000)             return `$${(value / 1_000).toFixed(2)}K`
  return `$${value.toFixed(2)}`
}

export function formatMarketCap(value: number): string {
  return formatVolume(value)
}

/** 中文相对时间：刚刚 / X 分钟前 / X 小时前 / 昨天 / X 天前 / X 周前 / 日期 */
export function relativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1)   return '刚刚'
  if (minutes < 60)  return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)    return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days === 1)    return '昨天'
  if (days < 7)      return `${days} 天前`
  const weeks = Math.floor(days / 7)
  if (weeks < 5)     return `${weeks} 周前`
  // 超过 30 天显示完整日期
  const d = new Date(isoDate)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
