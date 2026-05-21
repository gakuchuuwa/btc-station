import { Strategy } from './types';
import { atrChannelStrategy } from './atr-channel';
import { dcaStrategy } from './dca';

// 内置策略库(清理后版本)
// 删除原因:
//   - MaCross  : BTC 4h 7 年 +600%/-69%(无止损,跑不赢 Buy&Hold)
//   - Macd     : BTC 4h 7 年 +51%/-76%(556 笔被手续费吃光)
//   - RSI / Bollinger Breakout : 均值回归思路,在 BTC 主升浪结构下不适用
// 保留(在 BTC 4h × 7 年实测下确认能用):
//   - AtrChannel : +1874%/-37% Calmar 50,真正实战可用
//   - DCA        : +2099%/-77% Calmar 27,被动定投(≈ Buy&Hold)
// 后端独有:TurtleSslDual(海龟SSL双系统6形态),用户自研的复杂趋势策略,只在
//          Python 编辑器侧暴露,前端 TS 不重复实现
export const strategies: Strategy[] = [
  atrChannelStrategy,
  dcaStrategy,
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}
