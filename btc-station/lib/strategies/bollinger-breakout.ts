import { KlineBar } from '../okx';
import { Strategy, StrategyParams, Signal } from './types';
import { BollingerBands } from 'technicalindicators';

export const bollingerBreakoutStrategy: Strategy = {
  id: 'bollinger-breakout',
  name: '布林带突破',
  description: '价格突破上轨买入，跌破中轨卖出。捕捉强趋势爆发。',
  category: 'breakout',
  difficulty: 2,
  paramSchema: {
    period: { type: 'int', default: 20, min: 10, max: 50, label: '周期' },
    std_dev: { type: 'float', default: 2.0, min: 1.0, max: 4.0, step: 0.1, label: '标准差倍数' }
  },
  generateSignals: (candles: KlineBar[], params: StrategyParams): Signal[] => {
    const period = (params.period as number) || 20;
    const stdDev = (params.std_dev as number) || 2.0;

    const closes = candles.map(c => c.close);
    let bbResult = BollingerBands.calculate({ period, stdDev, values: closes });

    const pad = new Array(candles.length - bbResult.length).fill({ upper: NaN, middle: NaN, lower: NaN, pb: NaN });
    bbResult = [...pad, ...bbResult];

    const signals: Signal[] = new Array(candles.length).fill(0);

    for (let i = 1; i < candles.length; i++) {
      const prevC = closes[i-1];
      const currC = closes[i];
      const bbPrev = bbResult[i-1];
      const bbCurr = bbResult[i];

      if (bbPrev && bbCurr && !isNaN(bbPrev.upper) && !isNaN(bbCurr.upper)) {
        // 收盘价从下方上穿上轨 -> 买入
        if (prevC <= bbPrev.upper && currC > bbCurr.upper) {
          signals[i] = 1;
        }
        // 收盘价从上方下穿中轨 -> 卖出
        else if (prevC >= bbPrev.middle && currC < bbCurr.middle) {
          signals[i] = -1;
        }
      }
    }

    return signals;
  }
};
