import { Strategy } from './types';
import { maCrossStrategy } from './ma-cross';
import { rsiStrategy } from './rsi';
import { macdStrategy } from './macd';
import { bollingerBreakoutStrategy } from './bollinger-breakout';
import { atrChannelStrategy } from './atr-channel';
import { dcaStrategy } from './dca';

export const strategies: Strategy[] = [
  maCrossStrategy,
  rsiStrategy,
  macdStrategy,
  bollingerBreakoutStrategy,
  dcaStrategy,
  atrChannelStrategy
];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}
