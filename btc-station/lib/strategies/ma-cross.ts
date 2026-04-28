import { KlineBar } from '../okx';
import { Strategy, StrategyParams, Signal } from './types';
import { SMA, EMA } from 'technicalindicators';

export const maCrossStrategy: Strategy = {
  id: 'ma-cross',
  name: 'MA 双均线交叉',
  description: '快线上穿慢线时买入，下穿时卖出。最经典的趋势跟踪策略。',
  category: 'trend',
  difficulty: 1,
  paramSchema: {
    fast_period: { type: 'int', default: 20, min: 5, max: 100, label: '快线周期' },
    slow_period: { type: 'int', default: 50, min: 10, max: 200, label: '慢线周期' },
    ma_type: { type: 'select', default: 'SMA', options: ['SMA', 'EMA'], label: '均线类型' }
  },
  generateSignals: (candles: KlineBar[], params: StrategyParams): Signal[] => {
    const fast_period = (params.fast_period as number) || 20;
    const slow_period = (params.slow_period as number) || 50;
    const ma_type = (params.ma_type as string) || 'SMA';

    const closes = candles.map(c => c.close);
    
    let fast_ma: number[];
    let slow_ma: number[];

    if (ma_type === 'SMA') {
      fast_ma = SMA.calculate({ period: fast_period, values: closes });
      slow_ma = SMA.calculate({ period: slow_period, values: closes });
    } else {
      fast_ma = EMA.calculate({ period: fast_period, values: closes });
      slow_ma = EMA.calculate({ period: slow_period, values: closes });
    }

    // padding arrays with NaNs at the beginning to match candles length
    const padFast = new Array(candles.length - fast_ma.length).fill(NaN);
    fast_ma = [...padFast, ...fast_ma];

    const padSlow = new Array(candles.length - slow_ma.length).fill(NaN);
    slow_ma = [...padSlow, ...slow_ma];

    const signals: Signal[] = new Array(candles.length).fill(0);

    for (let i = 1; i < candles.length; i++) {
      if (!isNaN(fast_ma[i]) && !isNaN(slow_ma[i]) && !isNaN(fast_ma[i-1]) && !isNaN(slow_ma[i-1])) {
        // Crossed above
        if (fast_ma[i-1] <= slow_ma[i-1] && fast_ma[i] > slow_ma[i]) {
          signals[i] = 1;
        }
        // Crossed below
        else if (fast_ma[i-1] >= slow_ma[i-1] && fast_ma[i] < slow_ma[i]) {
          signals[i] = -1;
        }
      }
    }

    return signals;
  }
};
