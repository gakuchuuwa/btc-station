import { KlineBar } from '../okx';
import { Strategy, StrategyParams, Signal } from './types';

export const dcaStrategy: Strategy = {
  id: 'dca',
  name: 'DCA 定投 (简易版)',
  description: '每隔固定时间买入固定金额，长期持有。穿越牛熊的懒人策略。(此为Buy&Hold演示版)',
  category: 'dca',
  difficulty: 1,
  paramSchema: {
    interval_days: { type: 'int', default: 7, min: 1, max: 90, label: '定投间隔（天）' },
    amount_per_buy: { type: 'float', default: 100, min: 10, max: 10000, step: 10, label: '每次定投金额（USDT）' },
    sell_strategy: {
      type: 'select',
      default: 'never',
      options: ['never', 'price_target', 'time_target'],
      label: '卖出策略'
    },
    sell_target: { type: 'float', default: 100000, min: 0, label: '目标价格（USDT）' }
  },
  generateSignals: (candles: KlineBar[], params: StrategyParams): Signal[] => {
    // 简易处理：首日买入持有到最后（作为Buy&Hold的近似演示）
    const signals: Signal[] = new Array(candles.length).fill(0);
    if (candles.length > 0) {
      signals[0] = 1;
    }
    return signals;
  }
};
