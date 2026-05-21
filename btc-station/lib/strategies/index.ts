import { Strategy } from './types';
import { rsiStrategy } from './rsi';
import { bollingerBreakoutStrategy } from './bollinger-breakout';
import { atrChannelStrategy } from './atr-channel';
import { dcaStrategy } from './dca';

// 内置策略库（清理后版本）
// 删除原因:
//   - MaCross  : BTC 4h 7 年实测 +600%/-69%(无止损,回撤=Buy&Hold,收益却仅 1/3),教科书演示但实战亏钱
//   - Macd     : BTC 4h 7 年实测 +51%/-76%(556 笔交易被手续费吃光),最优参数也只 +465%,垃圾
// 保留:
//   - AtrChannel       : +1874%/-37% Calmar 50.1,真正实战可用
//   - DCA              : +2099%/-77% Calmar 27,被动定投(≈ Buy&Hold)
//   - RSI / Bollinger  : 前端独有的均值回归/突破策略,待实测决定去留
export const strategies: Strategy[] = [
  atrChannelStrategy,
  dcaStrategy,
  rsiStrategy,
  bollingerBreakoutStrategy,
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}
