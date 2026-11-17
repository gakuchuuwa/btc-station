import type { KlineBar } from '../okx'
import type { BacktestConfig } from './engine'
import type { StrategyParams } from '../strategies/types'

export interface OptimizerProgress {
  progress: number
  currentBest: StrategyParams | null
  bestSharpe: number
}

export interface OptimizerResultRow {
  params: StrategyParams
  total_pnl: number
  total_pnl_pct: number
  max_drawdown_pct: number
  total_trades: number
  win_rate: number
  sharpe_ratio: number
  profit_factor: number
}

export interface OptimizerCompleted {
  bestParams: StrategyParams
  results: OptimizerResultRow[]
}

export function runOptimizer(
  strategyId: string,
  candles: KlineBar[],
  config: BacktestConfig,
  onProgress?: (data: OptimizerProgress) => void,
): Promise<OptimizerCompleted> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('浏览器不支持 Web Worker，无法运行本地参数搜索。'))
      return
    }

    const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url))
    let settled = false
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      worker.terminate()
      reject(error)
    }

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data
      if (data.type === 'PROGRESS') {
        onProgress?.({
          progress: data.progress,
          currentBest: data.currentBest,
          bestSharpe: data.bestSharpe,
        })
      } else if (data.type === 'DONE') {
        if (!data.bestParams) {
          fail(new Error('没有生成有效的参数组合。'))
          return
        }
        settled = true
        worker.terminate()
        resolve({
          bestParams: data.bestParams,
          results: Array.isArray(data.results) ? data.results as OptimizerResultRow[] : [],
        })
      } else if (data.type === 'ERROR') {
        fail(new Error(typeof data.message === 'string' ? data.message : '本地参数搜索失败。'))
      }
    }

    worker.onerror = (event) => fail(new Error(event.message || '本地参数搜索 Worker 出错。'))
    worker.onmessageerror = () => fail(new Error('无法读取本地参数搜索结果。'))

    worker.postMessage({ type: 'START', strategyId, candles, config })
  })
}
