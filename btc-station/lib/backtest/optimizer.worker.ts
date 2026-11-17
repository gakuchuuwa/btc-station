import { runBacktest, type BacktestConfig } from './engine'
import type { KlineBar } from '../okx'
import { getStrategy } from '../strategies'
import type { StrategyParams, ParamSchemaDef } from '../strategies/types'
import type { OptimizerResultRow } from './optimizer'

interface OptimizerMessage {
  type: 'START'
  strategyId: string
  candles: KlineBar[]
  config: BacktestConfig
}

const MAX_COMBINATIONS = 2_000

function generateCombinations(schema: Record<string, ParamSchemaDef>): StrategyParams[] {
  const keys = Object.keys(schema)
  const combinations: StrategyParams[] = []

  function backtrack(index: number, currentParams: StrategyParams) {
    if (combinations.length >= MAX_COMBINATIONS) {
      throw new Error(`参数组合超过本地安全上限 ${MAX_COMBINATIONS} 组。`)
    }
    if (index === keys.length) {
      combinations.push({ ...currentParams })
      return
    }

    const key = keys[index]
    const def = schema[key]
    if (def.type === 'int' || def.type === 'float') {
      const defaultValue = Number(def.default)
      const min = Number.isFinite(def.min) ? def.min! : defaultValue
      const max = Number.isFinite(def.max) ? def.max! : defaultValue
      const defaultStep = Math.max(1, Math.abs(max - min) / 10)
      const step = Number.isFinite(def.step) && def.step! > 0 ? def.step! : defaultStep
      if (min > max) throw new Error(`参数 ${key} 的最小值大于最大值。`)

      if (min === max) {
        currentParams[key] = def.type === 'int' ? Math.round(min) : Number(min.toFixed(4))
        backtrack(index + 1, currentParams)
      } else {
        for (let value = min; value <= max + step * 1e-9; value += step) {
          currentParams[key] = def.type === 'int' ? Math.round(value) : Number(value.toFixed(4))
          backtrack(index + 1, currentParams)
        }
      }
    } else if (def.type === 'select' && def.options?.length) {
      for (const option of def.options) {
        currentParams[key] = option
        backtrack(index + 1, currentParams)
      }
    } else if (def.type === 'bool') {
      currentParams[key] = true
      backtrack(index + 1, currentParams)
      currentParams[key] = false
      backtrack(index + 1, currentParams)
    } else {
      currentParams[key] = def.default
      backtrack(index + 1, currentParams)
    }
  }

  backtrack(0, {})
  return combinations
}

self.onmessage = async (event: MessageEvent<OptimizerMessage>) => {
  if (event.data.type !== 'START') return
  const { strategyId, candles, config } = event.data
  const strategy = getStrategy(strategyId)

  if (!strategy) {
    self.postMessage({ type: 'ERROR', message: '找不到要优化的本地策略。' })
    return
  }

  try {
    if (!candles.length) throw new Error('没有可用于优化的 K 线数据。')
    const combinations = generateCombinations(strategy.paramSchema)
    if (!combinations.length) throw new Error('没有生成有效的参数组合。')

    const results: OptimizerResultRow[] = []
    let bestParams: StrategyParams | null = null
    let bestSharpe = -Infinity
    let bestPnl = -Infinity

    for (let index = 0; index < combinations.length; index++) {
      const params = combinations[index]
      const signals = strategy.generateSignals(candles, params)
      const result = await runBacktest(candles, signals, config)
      const row: OptimizerResultRow = {
        params,
        total_pnl: result.metrics.total_pnl,
        total_pnl_pct: result.metrics.total_pnl_pct,
        max_drawdown_pct: result.metrics.max_drawdown_pct,
        total_trades: result.metrics.total_trades,
        win_rate: result.metrics.win_rate,
        sharpe_ratio: result.metrics.sharpe_ratio,
        profit_factor: result.metrics.profit_factor,
      }
      results.push(row)

      if (row.sharpe_ratio > bestSharpe ||
          (row.sharpe_ratio === bestSharpe && row.total_pnl_pct > bestPnl)) {
        bestSharpe = row.sharpe_ratio
        bestPnl = row.total_pnl_pct
        bestParams = params
      }

      if (index % 5 === 0 || index === combinations.length - 1) {
        self.postMessage({
          type: 'PROGRESS',
          progress: Math.round(((index + 1) / combinations.length) * 100),
          currentBest: bestParams,
          bestSharpe,
        })
        // Let the worker event loop flush progress to the page between batches.
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    }

    self.postMessage({ type: 'DONE', bestParams, bestSharpe, results })
  } catch (error: unknown) {
    self.postMessage({
      type: 'ERROR',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
