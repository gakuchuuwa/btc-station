import { runBacktest, BacktestConfig } from './engine';
import { KlineBar } from '../okx';
import { getStrategy } from '../strategies';
import { StrategyParams, ParamSchemaDef } from '../strategies/types';

interface OptimizerMessage {
  type: 'START';
  strategyId: string;
  candles: KlineBar[];
  config: BacktestConfig;
}

// Generate all combinations of parameters
function generateCombinations(schema: Record<string, ParamSchemaDef>): StrategyParams[] {
  const keys = Object.keys(schema);
  const combinations: StrategyParams[] = [];

  function backtrack(index: number, currentParams: StrategyParams) {
    if (index === keys.length) {
      combinations.push({ ...currentParams });
      return;
    }

    const key = keys[index];
    const def = schema[key];

    if (def.type === 'int' || def.type === 'float') {
      const min = def.min ?? def.default as number;
      const max = def.max ?? def.default as number;
      // Limit steps to avoid memory explosion (max 10 steps per param if not specified)
      const step = def.step ?? Math.max(1, (max - min) / 10);
      
      if (min === max) {
        currentParams[key] = min;
        backtrack(index + 1, currentParams);
      } else {
        for (let val = min; val <= max; val += step) {
          // Fix precision issue for floats
          currentParams[key] = def.type === 'int' ? Math.round(val) : Number(val.toFixed(2));
          backtrack(index + 1, currentParams);
        }
      }
    } else if (def.type === 'select' && def.options) {
      for (const opt of def.options) {
        currentParams[key] = opt;
        backtrack(index + 1, currentParams);
      }
    } else if (def.type === 'bool') {
      currentParams[key] = true;
      backtrack(index + 1, currentParams);
      currentParams[key] = false;
      backtrack(index + 1, currentParams);
    } else {
      currentParams[key] = def.default;
      backtrack(index + 1, currentParams);
    }
  }

  backtrack(0, {});
  return combinations;
}

self.onmessage = async (e: MessageEvent<OptimizerMessage>) => {
  if (e.data.type === 'START') {
    const { strategyId, candles, config } = e.data;
    const strategy = getStrategy(strategyId);
    
    if (!strategy) {
      self.postMessage({ type: 'ERROR', message: 'Strategy not found' });
      return;
    }

    try {
      const combinations = generateCombinations(strategy.paramSchema);
      const total = combinations.length;
      
      let bestParams: StrategyParams | null = null;
      let bestSharpe = -999;
      let bestPnl = -999;

      for (let i = 0; i < total; i++) {
        const params = combinations[i];
        const signals = strategy.generateSignals(candles, params);
        const result = await runBacktest(candles, signals, config);
        
        // Priority: Profit factor > 0, then Sharpe Ratio. 
        // If Sharpe is equal, use Total Pnl.
        const sharpe = result.metrics.sharpe_ratio;
        const pnl = result.metrics.total_pnl_pct;

        if (sharpe > bestSharpe || (sharpe === bestSharpe && pnl > bestPnl)) {
          bestSharpe = sharpe;
          bestPnl = pnl;
          bestParams = params;
        }

        // Report progress every 50 iterations or at the end
        if (i % 50 === 0 || i === total - 1) {
          self.postMessage({
            type: 'PROGRESS',
            progress: Math.round(((i + 1) / total) * 100),
            currentBest: bestParams,
            bestSharpe
          });
        }
      }

      self.postMessage({
        type: 'DONE',
        bestParams,
        bestSharpe
      });
      
    } catch (error: any) {
      self.postMessage({ type: 'ERROR', message: error.message });
    }
  }
};
