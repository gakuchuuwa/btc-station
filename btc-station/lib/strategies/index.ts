import { Strategy } from './types';

// 内置策略库
// 2026-09-04：只保留海龟 SSL 双系统 6 形态（唯一在实盘使用的策略）。
// AtrChannel / DCA / MaCross / Macd / RSI / Bollinger 已全部删除。
// 海龟策略是后端 Python 实现（backend/strategies/TurtleSslDualStrategy.py），
// 通过 /api/templates 暴露给 Python 编辑器，前端 TS 侧不重复实现，故此处为空。
export const strategies: Strategy[] = [];

export function getStrategy(id: string): Strategy | undefined {
  return strategies.find(s => s.id === id);
}
