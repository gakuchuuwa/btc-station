import { DEFAULT_INITIAL_CAPITAL } from './constants'

function normalizeDateParam(input: string | undefined, endOfDay: boolean): string | undefined {
  if (!input?.trim()) return undefined
  const s = input.trim()
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)} ${endOfDay ? '23:59:59' : '00:00:00'}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return `${s} ${endOfDay ? '23:59:59' : '00:00:00'}`
  }
  return s
}

/** 组装 /api/backtest/dynamic 的 parameters，避免各页面硬编码本金与日期 */
export function buildBacktestParameters(
  opts: {
    capital?: number
    startDate?: string
    endDate?: string
  } = {},
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const params: Record<string, unknown> = {
    ...extra,
    initial_capital: opts.capital ?? DEFAULT_INITIAL_CAPITAL,
  }
  const start = normalizeDateParam(opts.startDate, false)
  const end = normalizeDateParam(opts.endDate, true)
  if (start) params.start_date = start
  if (end) params.end_date = end
  return params
}
