# BTC Station — Phase 3.0 实施策划书 v1.0

> **本文档用途**：Phase 3.0 可执行规格，交付给 Claude Design 出视觉，再交付给 Claude Code 实施。
>
> **前置条件**：Phase 2.2 已完成（图表页 + 画线 + 扩充指标 + 现货/永续切换 + 多图表分屏）。
>
> **预计工时**：5-7 天 AI 编码（不含视觉迭代）。
>
> **本阶段定位**：用户**首次接触量化策略**的入门体验。让用户从"看图表"跨越到"跑回测"，建立"原来量化是这样的"心智，为 Phase 3.1 Python 编辑器和 Phase 4 Pro 订阅做铺垫。

---

## 0. Phase 3.0 范围

**6 个预设策略 + 浏览器内现货回测 + 简易回测报告 + 信号点位标注。**

不做：永续合约回测（Phase 3.1）、用户写自定义策略（Phase 3.1）、参数遍历优化（Phase 3.2）、AI 分析（Phase 5）。

---

## 1. 核心用户故事

> **小张是一个加密交易者，已经会看 K 线，听说"量化策略能赚钱"但从没用过。他打开 BTC Station，看到"策略库"，挑了一个 MA 交叉策略，调了下周期参数，点"运行回测"。3 秒后看到一份报告：过去 1 年这个策略 +47%，胜率 52%，最大回撤 18%。报告下方图表上密密麻麻的买卖箭头让他第一次直观理解"什么是量化"。他想试试自己的参数组合，发现单组手动调要试很久——这时页面提示："想自动跑 1000 组参数找最优？升级 Pro"。**

这就是 Phase 3.0 的精确目标：**从"看图表"到"想升级 Pro"的转化漏斗第一步**。

---

## 2. 与 Phase 2.2 的关系

### 2.1 Phase 2.2 继承不变
- 图表页所有功能
- 现货 / 永续切换器（Phase 3.0 策略页**仅显示现货**，切换器禁用并提示）
- 所有指标 + 画线工具
- 用户偏好系统

### 2.2 Phase 3.0 新增

| 新增 | 位置 |
|---|---|
| 策略列表页 | `/strategies`（从占位页升级） |
| 策略详情 + 回测页 | `/strategies/[strategy_id]`（新增） |
| 用户已保存策略列表 | `/strategies/my`（新增，需登录） |
| 历史 K 线缓存（IndexedDB） | 客户端基础设施 |
| 回测引擎（JS） | `lib/backtest/` 新模块 |
| 6 个预设策略实现 | `lib/strategies/` 新模块 |
| 信号渲染（图表上的买卖箭头） | `components/Chart/SignalMarkers.tsx` |
| 回测报告组件 | `components/Backtest/Report.tsx` |
| 净值曲线组件 | `components/Backtest/EquityCurve.tsx` |

---

## 3. 三层架构总览

```
┌──────────────────────────────────────────────────────┐
│  1. 策略层 (lib/strategies/)                          │
│     - 6 个预设策略，每个一个独立文件                    │
│     - 统一接口：输入 OHLCV + 参数 → 输出信号序列         │
└──────────────────────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  2. 回测引擎 (lib/backtest/)                          │
│     - 输入：信号序列 + OHLCV + 资金管理配置             │
│     - 输出：交易记录 + 净值曲线 + 统计指标               │
└──────────────────────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  3. 数据层 (lib/data/)                                │
│     - OKX 历史 K 线拉取 + IndexedDB 缓存               │
│     - 用户策略存储到 Supabase                          │
└──────────────────────────────────────────────────────┘
```

---

## 4. 数据层规格

### 4.1 历史 K 线拉取与缓存

#### 4.1.1 OKX API 限制

```
GET /api/v5/market/history-candles?instId=BTC-USDT&bar=1D&limit=300&after={ts}
```

- 单次最多 300 根
- `after` 是分页游标（毫秒时间戳，返回该时间之前的数据）
- 公共端点限频：20 req/2s/IP

#### 4.1.2 数据需求量

| 周期 | 5 年数据需要请求数 |
|---|---|
| 1d | 6 次 |
| 4h | 37 次 |
| 1h | 147 次 |
| 15m | 583 次（实测可能因为数据上限只能拿到 3-4 年） |

> Phase 3.0 仅支持 **1d / 4h / 1h** 三个周期回测；15m / 5m / 1m 由于数据量过大延后到 Phase 3.2 服务端处理。

#### 4.1.3 IndexedDB 缓存策略

**为什么用 IndexedDB**：
- 容量大（浏览器允许 50MB+，Postgres 用户级缓存需要 Supabase 资源）
- 二进制存储效率高
- 跨页面持久化（用户回到图表页缓存仍在）

**库选型**：`idb` npm 包（最轻量、TS 友好）

**Schema**：
```typescript
// IndexedDB: btc-station-cache
// Object Store: candles
// Key: `${market}_${interval}` (例如 'spot_1d')
// Value: {
//   candles: Candle[],
//   lastUpdate: number (timestamp)
// }
```

**缓存策略**：
- **首次回测时**：调用 `ensureHistoricalData(interval, lookbackYears)`，循环拉取并存 IndexedDB
- **后续访问**：检查 lastUpdate，距今 < 6 小时直接用缓存；> 6 小时增量拉最新部分（只拉缺口）
- **进度反馈**：拉数据时 UI 显示 "正在加载历史数据... 35%"
- **失败重试**：单次请求失败立即重试 1 次；2 次都失败提示用户"网络异常，请稍候"

#### 4.1.4 数据 API 路由扩展

```
GET /api/chart/history-klines?interval={tf}&before={ts}&market=spot
```

返回 OKX 的 history-candles 数据（非最近的当前周期，而是历史完整数据）。Phase 2.2 的 `/api/chart/klines` 拉最近 500 根，这个新路由专门拉长历史。

### 4.2 数据库变更

**`strategies` 表**（Phase 2.1 已建，Phase 3.0 启用）：

不变更 schema，但新增使用约定：
- `code` 字段：Phase 3.0 存策略的 JSON 配置（不是 Python 代码）
- `params` 字段：用户自定义的参数值
- 新增"策略类型"判断：通过 `code` 起始字符判断（`{` 开头是 Phase 3.0 JSON 配置；`# python` 注释行开头是 Phase 3.1 Python 代码）

**`backtests` 表**（Phase 2.1 已建，Phase 3.0 启用）：

不变更 schema。Phase 3.0 写入：
- `config`：`{interval, lookback_days, initial_capital, position_sizing}`
- `metrics`：`{total_pnl, total_pnl_pct, win_rate, max_dd_pct, sharpe, total_trades, ...}`
- `trades`：交易记录数组
- `status`：直接 `completed`（客户端跑，无 pending 态）

---

## 5. 策略层规格

### 5.1 统一接口

```typescript
// lib/strategies/types.ts

export interface StrategyParams {
  [key: string]: number | boolean | string;
}

export interface ParamSchema {
  [key: string]: {
    type: 'int' | 'float' | 'bool' | 'select';
    default: number | boolean | string;
    min?: number;
    max?: number;
    step?: number;
    options?: string[];      // for 'select' type
    label: string;            // 中文展示名
    description?: string;     // 中文说明
  };
}

export interface Strategy {
  id: string;                 // 'ma-cross' | 'rsi' | ...
  name: string;               // 中文名
  description: string;        // 中文一段话说明
  category: 'trend' | 'mean-reversion' | 'breakout' | 'dca';
  difficulty: 1 | 2 | 3;      // 难度 1-3 星
  paramSchema: ParamSchema;
  generateSignals: (candles: Candle[], params: StrategyParams) => Signal[];
}

export type Signal = 0 | 1 | -1;  // 0=持仓不变 / 1=买入 / -1=卖出（平仓）
// 注意 Phase 3.0 只做现货，没有做空概念
```

### 5.2 6 个策略详细规格

#### 5.2.1 MA 交叉（趋势）

```typescript
{
  id: 'ma-cross',
  name: 'MA 双均线交叉',
  description: '快线上穿慢线时买入，下穿时卖出。最经典的趋势跟踪策略。',
  category: 'trend',
  difficulty: 1,
  paramSchema: {
    fast_period: { type: 'int', default: 20, min: 5, max: 100, label: '快线周期' },
    slow_period: { type: 'int', default: 50, min: 10, max: 200, label: '慢线周期' },
    ma_type: { type: 'select', default: 'SMA', options: ['SMA', 'EMA'], label: '均线类型' }
  }
}
```

**信号逻辑**：
- 快线从下方穿越慢线 → 上一根 0、当前 1
- 快线从上方穿越慢线 → 当前 -1
- 其他 0

#### 5.2.2 RSI 超买超卖（均值回归）

```typescript
{
  id: 'rsi',
  name: 'RSI 超买超卖',
  description: 'RSI 跌破超卖线时买入，突破超买线时卖出。震荡市表现优秀。',
  category: 'mean-reversion',
  difficulty: 1,
  paramSchema: {
    period: { type: 'int', default: 14, min: 5, max: 50, label: 'RSI 周期' },
    oversold: { type: 'int', default: 30, min: 10, max: 40, label: '超卖阈值' },
    overbought: { type: 'int', default: 70, min: 60, max: 90, label: '超买阈值' }
  }
}
```

**信号逻辑**：
- RSI 从上方下穿 oversold → 1（买入）
- RSI 从下方上穿 overbought → -1（卖出）

#### 5.2.3 MACD 金叉死叉（趋势）

```typescript
{
  id: 'macd',
  name: 'MACD 金叉死叉',
  description: 'MACD 线上穿信号线（金叉）买入，下穿（死叉）卖出。',
  category: 'trend',
  difficulty: 2,
  paramSchema: {
    fast: { type: 'int', default: 12, min: 5, max: 30, label: '快线周期' },
    slow: { type: 'int', default: 26, min: 10, max: 50, label: '慢线周期' },
    signal: { type: 'int', default: 9, min: 3, max: 20, label: '信号线周期' }
  }
}
```

#### 5.2.4 布林带突破（突破）

```typescript
{
  id: 'bollinger-breakout',
  name: '布林带突破',
  description: '价格突破上轨买入，跌破中轨卖出。捕捉强趋势爆发。',
  category: 'breakout',
  difficulty: 2,
  paramSchema: {
    period: { type: 'int', default: 20, min: 10, max: 50, label: '周期' },
    std_dev: { type: 'float', default: 2.0, min: 1.0, max: 4.0, step: 0.1, label: '标准差倍数' }
  }
}
```

**信号逻辑**：
- 收盘价从下方上穿上轨 → 1
- 收盘价从上方下穿中轨 → -1（不等到下轨，及时止盈）

#### 5.2.5 DCA 定投（被动）

```typescript
{
  id: 'dca',
  name: 'DCA 定投',
  description: '每隔固定时间买入固定金额，长期持有。穿越牛熊的懒人策略。',
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
    sell_target: { type: 'float', default: 100000, min: 0, label: '目标价格（USDT，如选 price_target）' }
  }
}
```

**特殊性**：DCA 不是基于信号交叉的策略，而是基于时间间隔。回测引擎需要专门处理（详见第 6.4 节）。

#### 5.2.6 ATR 通道 + 止损（专业）

```typescript
{
  id: 'atr-channel',
  name: 'ATR 通道突破 + 止损',
  description: '基于 ATR 动态构建价格通道，突破上轨买入，触及止损线卖出。带专业级风险控制。',
  category: 'breakout',
  difficulty: 3,
  paramSchema: {
    atr_period: { type: 'int', default: 14, min: 7, max: 30, label: 'ATR 周期' },
    channel_mult: { type: 'float', default: 2.0, min: 1.0, max: 5.0, step: 0.1, label: '通道倍数' },
    stop_loss_atr: { type: 'float', default: 2.0, min: 1.0, max: 5.0, step: 0.1, label: '止损 ATR 倍数' },
    use_trailing_stop: { type: 'bool', default: true, label: '启用追踪止损' }
  }
}
```

**信号逻辑**（最复杂的一个）：
- 通道上轨 = MA(close, 20) + ATR × channel_mult
- 通道下轨 = MA(close, 20) - ATR × channel_mult
- 价格上穿上轨 → 1（买入），并记录入场价
- 持仓中：止损线 = 入场价 - ATR × stop_loss_atr（如启用追踪止损，止损线随最高价上移）
- 价格触及止损线 → -1（卖出）

### 5.3 技术实现

**JS 指标库**：继续用 Phase 2.2 引入的 `technicalindicators`。

**目录结构**：
```
lib/strategies/
├── index.ts              # 导出所有策略
├── types.ts              # 通用类型
├── ma-cross.ts
├── rsi.ts
├── macd.ts
├── bollinger-breakout.ts
├── dca.ts
└── atr-channel.ts
```

---

## 6. 回测引擎规格

### 6.1 引擎接口

```typescript
// lib/backtest/engine.ts

export interface BacktestConfig {
  initial_capital: number;       // 默认 10000 USDT
  position_sizing: 'all_in' | 'fixed_pct' | 'fixed_amount';
  position_value: number;        // all_in=100, fixed_pct=百分比 (0-100), fixed_amount=USDT 金额
  fee_pct: number;               // 默认 0.1%（OKX 现货 taker）
  slippage_pct: number;          // 默认 0.05%
}

export interface BacktestResult {
  trades: Trade[];               // 详细交易记录
  equity_curve: EquityPoint[];   // 净值曲线
  metrics: Metrics;              // 统计指标
}

export interface Trade {
  entry_time: number;
  exit_time: number;
  entry_price: number;
  exit_price: number;
  size: number;                  // 买入数量（BTC）
  pnl: number;                   // 盈亏（USDT）
  pnl_pct: number;
  fee: number;
  duration_bars: number;
  reason: 'signal' | 'stop_loss' | 'manual';
}

export interface Metrics {
  total_pnl: number;
  total_pnl_pct: number;
  win_rate: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  max_drawdown: number;
  max_drawdown_pct: number;
  avg_pnl: number;
  avg_winning_trade: number;
  avg_losing_trade: number;
  profit_factor: number;
  sharpe_ratio: number;
  buy_hold_return_pct: number;   // 同期 Buy & Hold 对照
  outperformance: number;        // 跑赢/跑输 Buy & Hold 多少
}
```

### 6.2 资金管理模型（Phase 3.0 简化）

只支持三种：
- **all_in**：每次信号触发用全部可用资金买入（最激进）
- **fixed_pct**：每次用账户当前资金的 X%（默认 100%，可调 10-100）
- **fixed_amount**：每次用固定 USDT 金额（适合 DCA）

不做：凯利公式、动态加仓、马丁格尔（这些是 Phase 3.1 高级功能）。

### 6.3 回测主循环（信号驱动型）

```typescript
async function runBacktest(
  candles: Candle[],
  signals: Signal[],
  config: BacktestConfig
): Promise<BacktestResult> {
  let cash = config.initial_capital;
  let position = 0;  // 持有的 BTC 数量
  let entry_price = 0;
  const trades: Trade[] = [];
  const equity_curve: EquityPoint[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const signal = signals[i];

    // 信号 1: 买入
    if (signal === 1 && position === 0) {
      const buyValue = calculatePositionSize(cash, config);
      const fillPrice = candle.close * (1 + config.slippage_pct / 100);
      const fee = buyValue * (config.fee_pct / 100);
      const size = (buyValue - fee) / fillPrice;

      position = size;
      entry_price = fillPrice;
      cash -= buyValue;
      // 记录入场点供后续平仓用
    }

    // 信号 -1: 卖出
    if (signal === -1 && position > 0) {
      const sellValue = position * candle.close * (1 - config.slippage_pct / 100);
      const fee = sellValue * (config.fee_pct / 100);
      const netSellValue = sellValue - fee;

      const pnl = netSellValue - (position * entry_price);
      trades.push({
        entry_time: ...,
        exit_time: candle.time,
        entry_price,
        exit_price: candle.close,
        size: position,
        pnl,
        pnl_pct: (pnl / (position * entry_price)) * 100,
        fee,
        duration_bars: ...,
        reason: 'signal'
      });

      cash += netSellValue;
      position = 0;
    }

    // 记录每根 K 线的总权益
    const equity = cash + position * candle.close;
    equity_curve.push({ time: candle.time, equity });
  }

  // 期末若有持仓，按最后收盘价平仓
  if (position > 0) {
    // 同上逻辑，reason: 'manual' (期末强平)
  }

  return {
    trades,
    equity_curve,
    metrics: calculateMetrics(trades, equity_curve, candles, config)
  };
}
```

### 6.4 DCA 策略的特殊处理

DCA 不基于信号交叉，需要独立的回测分支：

```typescript
async function runDCABacktest(
  candles: Candle[],
  params: DCAParams,
  config: BacktestConfig
): Promise<BacktestResult> {
  // 每 interval_days 触发一次买入
  // 累积 BTC，记录每次买入的成本
  // 期末按当前价格估算盈亏
  // 不存在"卖出"概念（除非用户配置了 sell_target）
}
```

### 6.5 性能预期

- BTC 5 年日线（1800 根 K 线）+ MA 交叉策略：< 100 毫秒
- BTC 5 年 4h（11000 根）+ ATR 通道：< 500 毫秒
- BTC 3 年 1h（25000 根）+ MACD：< 1 秒

完全在浏览器内可接受范围。

---

## 7. UI 规格

### 7.1 策略列表页 `/strategies`

#### 7.1.1 页面结构（自上而下）

1. **页面标题**：`策略库`
2. **副标题**：`从经典到进阶的 BTC 交易策略，一键回测验证想法`
3. **筛选标签**（可选）：`全部` / `趋势` / `均值回归` / `突破` / `定投`
4. **策略卡片网格**（每行 2-3 个卡片）

#### 7.1.2 策略卡片设计

每张卡片显示：
- **策略名**（大字）
- **难度星级**（★ / ★★ / ★★★）
- **类别标签**（趋势 / 均值回归 / 突破 / 定投）
- **一句话描述**（2-3 行截断）
- **底部按钮**：`查看详情 →`

点击卡片任意位置跳 `/strategies/[strategy_id]`。

#### 7.1.3 已登录用户额外区块

页面底部新增"我保存的策略"区块（横向滚动卡片），未登录用户该区块隐藏。

每张已保存策略卡片显示：策略名 + 上次回测净值 + 最后运行时间 + "继续" 按钮。

### 7.2 策略详情 + 回测页 `/strategies/[strategy_id]`

#### 7.2.1 页面布局

**左侧 320px 边栏**（参数 + 回测设置）：
- **策略说明**：完整描述 + 难度 + 类别
- **参数表单**：根据 `paramSchema` 动态渲染
  - `int` / `float` → 数字输入框
  - `bool` → 开关
  - `select` → 下拉选择
  - 每个参数有 tooltip 解释
- **回测设置**：
  - 时间周期：1d / 4h / 1h（仅限 Phase 3.0 三选一）
  - 回测时长：3 个月 / 6 个月 / 1 年 / 3 年 / 5 年（默认 1 年）
  - 初始资金：默认 10,000 USDT，可改
  - 仓位模式：`满仓` / `固定百分比 X%` / `固定金额 X USDT`
  - 手续费：默认 0.1%（不可改，Phase 3.1 开放）
- **底部按钮**：
  - `运行回测` （主按钮，运行中变 loading 状态）
  - `保存策略`（次按钮，登录用户才显示，存到 Supabase）

**右侧主区域**（分上下）：

**上半（图表区，约 60% 高度）**：
- 与图表页同款 K 线（仅本策略时长范围）
- **买卖箭头标注**（绿色↑ 买入 / 红色↓ 卖出）
- 鼠标悬停箭头显示该笔交易的：入场价 / 出场价 / 盈亏
- 持仓区间用淡绿色矩形高亮

**下半（回测结果，约 40% 高度）**：
回测未运行时显示空状态："运行回测后将在此显示结果"

回测后显示：
- **顶部 4 个核心指标卡片**（横排）：
  - 总收益率（百分比 + 绝对值，涨绿跌红）
  - 胜率
  - 最大回撤
  - 夏普比率
- **净值曲线图**（折线图）：
  - 蓝色：策略净值
  - 灰色虚线：Buy & Hold 对照
  - X 轴时间，Y 轴权益（USDT）
- **交易记录表**（可折叠展开）：
  - 列：入场时间 / 入场价 / 出场时间 / 出场价 / 数量 / 盈亏 / 盈亏 % / 持仓周期
  - 默认显示最近 10 条，"查看全部" 展开
- **下载按钮**：`导出回测报告（CSV）`（按 Phase 3.2 兼容格式输出，但 Phase 3.0 只填核心指标，参数列正常填，部分高级指标留空——为 Phase 3.2 兼容做准备）

#### 7.2.2 加载与错误状态

- **首次拉取历史数据**（IndexedDB 无缓存时）：右侧主区域显示进度条 "正在加载历史数据 35%"
- **回测运行中**：参数边栏按钮变 `回测中... 2.3s`，主区域显示 loading 蒙层
- **数据拉取失败**：友好错误 "网络异常，请稍候重试"
- **参数无效**（如 fast_period >= slow_period）：表单底部红字提示，按钮禁用

### 7.3 我的策略页 `/strategies/my`（需登录）

#### 7.3.1 页面结构

- 标题：`我的策略`
- 副标题：`已保存的策略与历史回测`
- 表格（响应式卡片化于移动端）：
  - 列：策略名 / 基础策略 / 周期 / 时长 / 净收益率 / 胜率 / 最后运行 / 操作
  - 操作：`继续编辑` / `复制` / `删除`

#### 7.3.2 空状态

未保存任何策略时显示：
- 大字 `还没有保存的策略`
- 副字 `去策略库挑一个开始吧`
- 按钮 `浏览策略库` → `/strategies`

### 7.4 信号渲染（图表上的买卖箭头）

#### 7.4.1 lightweight-charts 集成

```typescript
import { ISeriesApi, SeriesMarker, Time } from 'lightweight-charts';

const markers: SeriesMarker<Time>[] = trades.flatMap(trade => [
  {
    time: trade.entry_time as Time,
    position: 'belowBar',
    color: '#26A17B',
    shape: 'arrowUp',
    text: `买入 @ ${trade.entry_price.toFixed(2)}`
  },
  {
    time: trade.exit_time as Time,
    position: 'aboveBar',
    color: trade.pnl > 0 ? '#26A17B' : '#E84C3D',
    shape: 'arrowDown',
    text: `卖出 @ ${trade.exit_price.toFixed(2)} (${trade.pnl_pct > 0 ? '+' : ''}${trade.pnl_pct.toFixed(2)}%)`
  }
]);

candleSeries.setMarkers(markers);
```

#### 7.4.2 持仓区间高亮

通过自定义画线（继承 Phase 2.2 的画线层）画淡绿色半透明矩形覆盖持仓区间。

---

## 8. UI 字符串增量

| 中文 |
|---|
| 策略库 |
| 我的策略 |
| 趋势 / 均值回归 / 突破 / 定投 |
| 难度 / 入门 / 中级 / 进阶 |
| 参数设置 |
| 回测设置 |
| 时间周期 / 回测时长 / 初始资金 / 仓位模式 |
| 满仓 / 固定百分比 / 固定金额 |
| 运行回测 / 回测中... |
| 保存策略 / 已保存 |
| 总收益率 / 胜率 / 最大回撤 / 夏普比率 |
| 净值曲线 / Buy & Hold 对照 |
| 交易记录 / 入场 / 出场 / 持仓周期 |
| 导出回测报告 |
| 还没有保存的策略 / 浏览策略库 |
| 正在加载历史数据 |
| 提示：本策略基于现货数据回测，永续合约精确模拟在 Pro 版上线 |

---

## 9. CSV 导出格式（Phase 3.0 简化版）

为 Phase 3.2 兼容做准备，Phase 3.0 输出的 CSV 也用 191 列结构，但：
- 大部分指标列可填（核心 30+ 项 Phase 3.0 已计算）
- 高级指标列（Sortino、Margin Efficiency、Avg # bars in losing trades 等）填空字符串或 0
- 多空分别统计（`: Long` / `: Short`）：现货回测里 `: Long` 等于 `: All`，`: Short` 全填 0
- 元数据列：`_setTime_` / `_parseTime_` 用 ISO 时间，`_duration_` 用毫秒，`comment` 填 "Manual single backtest"
- 参数列：策略的 `paramSchema` 所有参数（中文名 + `__` 前缀）

**这样保证 Phase 3.0 的 CSV 也能上传到 quant-lab.org（虽然部分指标空白）**，到 Phase 3.2 时无需改格式。

---

## 10. 性能与体验要求

| 项目 | 要求 |
|---|---|
| 首次拉数据（5 年日线） | < 5 秒（6 次 OKX 请求） |
| 缓存命中后回测启动 | < 100 毫秒 |
| 单次回测（1 年日线） | < 200 毫秒 |
| 单次回测（5 年 4h） | < 1 秒 |
| 信号箭头渲染（500 笔交易） | 流畅无卡顿 |
| 净值曲线绘制 | 60fps |
| 移动端可用性 | 策略列表 + 详情可看，回测能跑（性能略慢可接受） |

---

## 11. 不做的事

- ❌ 永续合约回测（Phase 3.1）
- ❌ 用户写自定义策略（Phase 3.1）
- ❌ 参数遍历优化（Phase 3.2）
- ❌ AI 策略分析（Phase 5）
- ❌ 多周期组合策略
- ❌ 多空策略（现货只做多）
- ❌ 复杂止损（追踪止损除外，因 ATR 策略需要）
- ❌ 杠杆模拟
- ❌ 策略分享 / 公开策略库
- ❌ 策略代码编辑器（Phase 3.1）
- ❌ 异步任务队列（客户端跑，无需）
- ❌ Pro 付费门槛（Phase 4 才上 Stripe）
- ❌ 新闻面板（保持图表纯净）
- ❌ 策略表现排行榜

---

## 12. 验收标准

### 功能
- [ ] `/strategies` 页面显示 6 个策略卡片
- [ ] 策略详情页参数表单按 schema 正确渲染
- [ ] 6 个策略各跑通至少一次回测（用默认参数）
- [ ] 买卖箭头正确标注在 K 线上
- [ ] 净值曲线显示策略 vs Buy & Hold
- [ ] 4 个核心指标计算正确（与手算或 Excel 对照误差 < 0.5%）
- [ ] 交易记录表格完整
- [ ] CSV 导出文件能正常下载且 191 列结构正确
- [ ] 登录用户可保存策略到 Supabase
- [ ] `/strategies/my` 显示已保存策略
- [ ] DCA 策略特殊路径正常（无信号交叉，按时间触发）
- [ ] 切换永续 tab 时正确显示提示并禁用回测

### 数据
- [ ] IndexedDB 缓存在首次回测后建立
- [ ] 二次回测命中缓存（< 100ms 启动）
- [ ] 6 小时后增量更新缓存
- [ ] 网络异常时友好错误提示
- [ ] 5 年日线数据 6 次请求内拉完

### 性能
- [ ] 单次回测延时符合第 10 节要求
- [ ] 500+ 笔交易箭头渲染流畅
- [ ] 净值曲线 60fps

### 合规
- [ ] 策略详情页底部小字声明 "本回测基于历史数据，不代表未来收益"
- [ ] 全站无"必涨""推荐买入"等用语
- [ ] Phase 4 Pro 提示文案是"自动跑数千组参数找最优"（功能型描述），不是"找到必赚参数"

---

## 13. 工作流交付

### Step 1: 本文档 → Claude Design

```
我有一个 BTC 量化交易网站 BTC Station，Phase 2.2 已上线
（部署在 [Vercel URL]）。现在做 Phase 3.0：6 个预设策略 + 浏览器内回测。

请：
1. 读 Phase 1/2.1/2.2 的 codebase（继承设计系统）
2. 读 Phase 3.0 实施策划书（附件）
3. 产出以下高保真 mockup（全中文）：
   - 策略库列表页（含策略卡片设计、筛选标签、空状态）
   - 策略详情 + 回测页（左边栏参数 + 右侧图表 + 报告）
   - 我的策略页（已登录态）+ 空状态
   - 6 种策略的参数面板形态（特别是 ATR 那个 4 参数的复杂版）
   - 信号箭头在 K 线上的视觉处理（密集交易时如何避免重叠）
   - 净值曲线 + Buy & Hold 对照视觉
   - 移动端布局方案
   - 加载状态（拉数据 / 回测中）的视觉

风格继承 Phase 2.x 的克制深色，新元素：
- 4 个核心指标卡片要"专业有信息密度"，不要花哨
- 策略卡片要让人想点击但不要营销感
- 难度星级要克制（不要游戏化得太重）
```

### Step 2: 策划 + 视觉 → Claude Code

```
为 BTC Station 实施 Phase 3.0。
- 项目现状：[GitHub 仓库]
- 实施策划书：[附件]
- 视觉设计：[Claude Design 输出]

按以下顺序实施：
1. 数据基础设施
   a. lib/data/history.ts：循环拉取 OKX 历史 K 线
   b. lib/data/cache.ts：IndexedDB 缓存（用 idb 包）
   c. /api/chart/history-klines API 路由
2. 6 个策略实现（lib/strategies/）
3. 回测引擎（lib/backtest/）
4. /strategies 列表页
5. /strategies/[id] 详情 + 回测页
6. 信号渲染 + 净值曲线
7. 保存策略到 Supabase
8. /strategies/my 页面
9. CSV 导出
10. 文案合规审查（无投资建议暗示）

每步做完告知我本地验证后再下一步。
最后部署 Vercel。

特别注意：
- 永续 tab 在策略页要禁用并显示中性提示
- IndexedDB 失败要降级到内存缓存（不阻塞用户使用）
- 回测引擎用 Web Worker 跑，避免阻塞 UI 主线程（5 年 4h 回测可能 0.5s+）
```

---

## 14. 项目负责人实操清单

1. **把本文档丢给 Claude Design**（建议先用 ChatGPT/Claude.ai 检查文档完整性，再交给设计 Claude）
2. **审视觉**：特别关注策略卡片的吸引力和详情页的信息密度
3. **策划 + 视觉打包给 Claude Code** 实施
4. **每步本地验证**（按第 12 节）
5. **挑 1-2 个朋友测试** → 看他们能否在不指导下完成"挑策略 → 跑回测 → 看懂报告"全流程
6. **Phase 3.0 验收通过后**回来找我写 Phase 3.1 实施策划书（Python 编辑器 + E2B 沙箱 + 永续合约精确模拟）

---

## 15. 风险与已知挑战

| 风险 | 缓解 |
|---|---|
| OKX history-candles 时间游标实现复杂 | 写好工具函数 + 充分单元测试 |
| IndexedDB 在隐私模式下不可用 | 降级到内存缓存（同会话有效） |
| 回测引擎计算阻塞 UI | Web Worker 后台跑（Claude Code 注意） |
| ATR 通道策略复杂逻辑出 bug | 与手算对照至少 5 个案例验证 |
| DCA 与其他策略路径不一致 | 引擎层做适配器模式 |
| 移动端图表上箭头太密看不清 | 移动端默认放大到 30 笔交易内的窗口 |
| 用户不理解"夏普比率"等术语 | 每个指标卡片有"?" 图标，hover 显示中文解释 |

---

**版本**：v1.0  
**关联文档**：BTC Station 大局路线图 v2.0、Phase 2.2 实施策划书 v1.0  
**下一份文档**：Phase 3.1 实施策划书（届时编写）
