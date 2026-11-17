import type { KlineBar } from '../okx'
import type { Signal, Strategy, StrategyParams } from './types'

function numberParam(params: StrategyParams, key: string, fallback: number): number {
  const value = Number(params[key] ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (!Number.isInteger(period) || period < 1) return out

  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

function rsi(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null)
  if (!Number.isInteger(period) || period < 1 || values.length <= period) return out

  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1]
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= period
  avgLoss /= period

  const valueAt = (gain: number, loss: number) =>
    loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)

  out[period] = valueAt(avgGain, avgLoss)
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1]
    const gain = Math.max(change, 0)
    const loss = Math.max(-change, 0)
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = valueAt(avgGain, avgLoss)
  }
  return out
}

function movingAverageCross(candles: KlineBar[], params: StrategyParams): Signal[] {
  const closes = candles.map(c => c.close)
  const fastPeriod = Math.max(2, Math.floor(numberParam(params, 'fast_period', 20)))
  const slowPeriod = Math.max(3, Math.floor(numberParam(params, 'slow_period', 50)))
  const signals: Signal[] = new Array(candles.length).fill(0)
  if (fastPeriod >= slowPeriod) return signals

  const fast = sma(closes, fastPeriod)
  const slow = sma(closes, slowPeriod)
  for (let i = 1; i < candles.length; i++) {
    if (fast[i - 1] == null || slow[i - 1] == null || fast[i] == null || slow[i] == null) continue
    if (fast[i - 1]! <= slow[i - 1]! && fast[i]! > slow[i]!) signals[i] = 1
    else if (fast[i - 1]! >= slow[i - 1]! && fast[i]! < slow[i]!) signals[i] = -1
  }
  return signals
}

function rsiReversion(candles: KlineBar[], params: StrategyParams): Signal[] {
  const closes = candles.map(c => c.close)
  const period = Math.max(2, Math.floor(numberParam(params, 'period', 14)))
  const oversold = numberParam(params, 'oversold', 30)
  const overbought = numberParam(params, 'overbought', 70)
  const values = rsi(closes, period)
  const signals: Signal[] = new Array(candles.length).fill(0)
  if (oversold >= overbought) return signals

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    const current = values[i]
    if (prev == null || current == null) continue
    if (prev > oversold && current <= oversold) signals[i] = 1
    else if (prev < overbought && current >= overbought) signals[i] = -1
  }
  return signals
}

function donchianBreakout(candles: KlineBar[], params: StrategyParams): Signal[] {
  const entryPeriod = Math.max(2, Math.floor(numberParam(params, 'entry_period', 20)))
  const exitPeriod = Math.max(2, Math.floor(numberParam(params, 'exit_period', 10)))
  const signals: Signal[] = new Array(candles.length).fill(0)
  if (exitPeriod >= entryPeriod) return signals

  for (let i = 1; i < candles.length; i++) {
    if (i >= entryPeriod) {
      const priorHigh = Math.max(...candles.slice(i - entryPeriod, i).map(c => c.high))
      if (candles[i].close > priorHigh) {
        signals[i] = 1
        continue
      }
    }
    if (i >= exitPeriod) {
      const priorLow = Math.min(...candles.slice(i - exitPeriod, i).map(c => c.low))
      if (candles[i].close < priorLow) signals[i] = -1
    }
  }
  return signals
}

// These strategies are deterministic TypeScript implementations and run in the browser.
// They deliberately carry no advertised performance numbers: results depend on the
// selected interval, sample window, fees, and slippage entered by the user.
export const strategies: Strategy[] = [
  {
    id: 'ma-cross',
    name: '双均线交叉',
    description: '短期均线上穿长期均线时做多，下穿时平仓。趋势跟踪示例，震荡行情可能出现连续假信号。',
    category: 'trend',
    difficulty: 1,
    paramSchema: {
      fast_period: { type: 'int', default: 20, min: 5, max: 30, step: 5, label: '短期均线周期' },
      slow_period: { type: 'int', default: 50, min: 20, max: 120, step: 10, label: '长期均线周期' },
    },
    generateSignals: movingAverageCross,
  },
  {
    id: 'rsi-reversion',
    name: 'RSI 均值回归',
    description: 'RSI 进入超卖区时做多，进入超买区时平仓。示例策略，不保证在不同市场阶段有效。',
    category: 'mean-reversion',
    difficulty: 2,
    paramSchema: {
      period: { type: 'int', default: 14, min: 7, max: 28, step: 7, label: 'RSI 周期' },
      oversold: { type: 'int', default: 30, min: 20, max: 40, step: 5, label: '超卖阈值' },
      overbought: { type: 'int', default: 70, min: 60, max: 80, step: 10, label: '超买阈值' },
    },
    generateSignals: rsiReversion,
  },
  {
    id: 'donchian-breakout',
    name: '唐奇安通道突破',
    description: '收盘价突破此前区间高点时开仓，跌破较短出场区间低点时平仓。经典趋势突破逻辑。',
    category: 'breakout',
    difficulty: 2,
    paramSchema: {
      entry_period: { type: 'int', default: 20, min: 10, max: 60, step: 10, label: '入场通道周期' },
      exit_period: { type: 'int', default: 10, min: 5, max: 30, step: 5, label: '出场通道周期' },
    },
    generateSignals: donchianBreakout,
  },
]

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(strategy => strategy.id === id)
}
