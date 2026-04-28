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

export interface Strategy {
  id: string;
  name: string;
  description: string;
  category: 'trend' | 'mean-reversion' | 'breakout' | 'dca';
  difficulty: 1 | 2 | 3;
  paramSchema: ParamSchema;
  generateSignals: (candles: KlineBar[], params: StrategyParams) => Signal[];
}
