import { KlineBar } from '../okx';

export interface StrategyParams {
  [key: string]: number | boolean | string;
}

export interface ParamSchemaDef {
  type: 'int' | 'float' | 'bool' | 'select';
  default: number | boolean | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];      // for 'select' type
  label: string;            // 中文展示名
  description?: string;     // 中文说明
}

export interface ParamSchema {
  [key: string]: ParamSchemaDef;
}

export type Signal = 0 | 1 | -1;  // 0=持仓不变 / 1=买入 / -1=卖出（平仓）

// 5 年 BTC 4h 实测数据(默认参数,init_cash=10000,fees=0.05%)
// 用于在策略卡片上向用户诚实展示历史表现,基准线 Buy & Hold = +2100% / -77%
export interface BacktestStats {
  returnPct: number;   // 总收益百分比
  ddPct: number;       // 最大回撤百分比(正数)
  calmar: number;      // returnPct / ddPct,越高越好
  trades: number;      // 交易笔数
  // 评级:✅ 实战可用 / ⚠️ 仅作演示 / ❌ 不推荐
  rating: 'good' | 'demo' | 'bad';
  // 跟 Buy & Hold 相比的核心定位说明,如"最佳风控,回撤显著小于 BH"
  honestNote: string;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  category: 'trend' | 'mean-reversion' | 'breakout' | 'dca';
  difficulty: 1 | 2 | 3;
  paramSchema: ParamSchema;
  generateSignals: (candles: KlineBar[], params: StrategyParams) => Signal[];
  // 可选:有实测数据的策略才挂上,卡片会显示真实表现
  backtestStats?: BacktestStats;
}
