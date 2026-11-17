import { KlineBar } from '../okx';
import { BacktestConfig } from './engine';
import { StrategyParams } from '../strategies/types';

export interface OptimizerProgress {
  progress: number;
  currentBest: StrategyParams | null;
  bestSharpe: number;
}

export function runOptimizer(
  strategyId: string,
  candles: KlineBar[],
  config: BacktestConfig,
  onProgress?: (data: OptimizerProgress) => void
): Promise<StrategyParams> {
  return new Promise((resolve, reject) => {
    // Check if worker is supported
    if (typeof Worker === 'undefined') {
      return reject(new Error('Web Workers are not supported in this browser.'));
    }

    // Initialize worker
    const worker = new Worker(new URL('./optimizer.worker.ts', import.meta.url));

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === 'PROGRESS') {
        if (onProgress) {
          onProgress({
            progress: data.progress,
            currentBest: data.currentBest,
            bestSharpe: data.bestSharpe
          });
        }
      } else if (data.type === 'DONE') {
        worker.terminate();
        if (data.bestParams) {
          resolve(data.bestParams);
        } else {
          reject(new Error('Failed to find best parameters'));
        }
      } else if (data.type === 'ERROR') {
        worker.terminate();
        reject(new Error(data.message));
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      reject(error);
    };

    // Start the job
    worker.postMessage({
      type: 'START',
      strategyId,
      candles,
      config
    });
  });
}
