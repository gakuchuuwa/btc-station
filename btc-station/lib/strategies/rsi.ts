import { KlineBar } from '../okx';
import { Strategy, StrategyParams, Signal } from './types';
import { RSI } from 'technicalindicators';

export const rsiStrategy: Strategy = {
  id: 'rsi',
  name: 'RSI 超买超卖',
  description: 'RSI 跌破超卖线时买入，突破超买线时卖出。震荡市表现优秀。',
  category: 'mean-reversion',
  difficulty: 1,
  paramSchema: {
    period: { type: 'int', default: 14, min: 5, max: 50, label: 'RSI 周期' },
    oversold: { type: 'int', default: 30, min: 10, max: 40, label: '超卖阈值' },
    overbought: { type: 'int', default: 70, min: 60, max: 90, label: '超买阈值' }
  },
  generateSignals: (candles: KlineBar[], params: StrategyParams): Signal[] => {
    const period = (params.period as number) || 14;
    const oversold = (params.oversold as number) || 30;
    const overbought = (params.overbought as number) || 70;

    const closes = candles.map(c => c.close);
    let rsi = RSI.calculate({ period, values: closes });

    // padding
    const pad = new Array(candles.length - rsi.length).fill(NaN);
    rsi = [...pad, ...rsi];

    const signals: Signal[] = new Array(candles.length).fill(0);

    for (let i = 1; i < candles.length; i++) {
      if (!isNaN(rsi[i]) && !isNaN(rsi[i-1])) {
        // RSI crossed below oversold -> Buy (as per Phase 3.0 spec: "RSI 从上方下穿 oversold -> 1 (买入)")
        if (rsi[i-1] >= oversold && rsi[i] < oversold) {
          signals[i] = 1;
        }
        // RSI crossed above overbought -> Sell ("RSI 从下方上穿 overbought -> -1 (卖出)")
        else if (rsi[i-1] <= overbought && rsi[i] > overbought) {
          signals[i] = -1;
        }
      }
    }

    return signals;
  }
};
