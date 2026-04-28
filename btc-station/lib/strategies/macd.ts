import { KlineBar } from '../okx';
import { Strategy, StrategyParams, Signal } from './types';
import { MACD } from 'technicalindicators';

export const macdStrategy: Strategy = {
  id: 'macd',
  name: 'MACD 金叉死叉',
  description: 'MACD 线上穿信号线（金叉）买入，下穿（死叉）卖出。',
  category: 'trend',
  difficulty: 2,
  paramSchema: {
    fast: { type: 'int', default: 12, min: 5, max: 30, label: '快线周期' },
    slow: { type: 'int', default: 26, min: 10, max: 50, label: '慢线周期' },
    signal: { type: 'int', default: 9, min: 3, max: 20, label: '信号线周期' }
  },
  generateSignals: (candles: KlineBar[], params: StrategyParams): Signal[] => {
    const fastPeriod = (params.fast as number) || 12;
    const slowPeriod = (params.slow as number) || 26;
    const signalPeriod = (params.signal as number) || 9;

    const closes = candles.map(c => c.close);
    let macdResult = MACD.calculate({ 
      values: closes, 
      fastPeriod, 
      slowPeriod, 
      signalPeriod, 
      SimpleMAOscillator: false, 
      SimpleMASignal: false 
    });

    const pad = new Array(candles.length - macdResult.length).fill({ MACD: NaN, signal: NaN, histogram: NaN });
    macdResult = [...pad, ...macdResult];

    const signals: Signal[] = new Array(candles.length).fill(0);

    for (let i = 1; i < candles.length; i++) {
      const prev = macdResult[i-1];
      const curr = macdResult[i];

      if (prev && curr && !isNaN(prev.MACD!) && !isNaN(curr.MACD!) && !isNaN(prev.signal!) && !isNaN(curr.signal!)) {
        // 金叉：MACD 上穿 Signal
        if (prev.MACD! <= prev.signal! && curr.MACD! > curr.signal!) {
          signals[i] = 1;
        }
        // 死叉：MACD 下穿 Signal
        else if (prev.MACD! >= prev.signal! && curr.MACD! < curr.signal!) {
          signals[i] = -1;
        }
      }
    }

    return signals;
  }
};
