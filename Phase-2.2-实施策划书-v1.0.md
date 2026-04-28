# BTC Station — Phase 2.2 实施策划书 v1.0

> **本文档用途**：交付给 Claude Design 出视觉，再交付给 Claude Code 实施的可执行规格。
>
> **前置条件**：Phase 2.1 已完成并部署在 `https://btc-station.vercel.app`。
>
> **预计工时**：3-5 天 AI 编码（含视觉迭代时间）。

---

## 0. Phase 2.2 范围

**图表页收尾 + 永续合约支持**——把"精简版图表"升级为"完整版交易者工作台"，并修正一个重大业务方向：**用户主要交易永续合约，不是现货**。

---

## 1. 与 Phase 2.1 的关系

### 1.1 Phase 2.1 继承不变

- 整套技术栈、设计系统、字体栈、配色
- 主页 `/`、登录、注册、账户设置等所有页面
- Supabase 数据库 schema
- 所有 API 路由（除了 `/api/chart/*` 会扩展）

### 1.2 Phase 2.2 新增

- **现货 / 永续切换器**（顶部工具栏新增组件）
- **画线工具**（趋势线、水平线、矩形、斐波那契回调、文字标注）
- **扩充指标**（EMA、Bollinger Bands、Stochastic、ATR、OBV、Volume MA）
- **指标参数自定义 UI**（每个指标可改周期 / 颜色 / 显隐）
- **多图表分屏**（最多 2 个，可对比 4h + 15m）
- **图表截图导出**（PNG）
- **永续合约信息面板**（资金费率、未平仓合约量、多空比）

---

## 2. 重大业务方向修正：永续合约支持

### 2.1 为什么必须改

从用户真实 TV Assistant CSV 中发现：用户实际交易品种是 `BTCUSDT.P`（永续合约），不是 spot。整个 Phase 2.1 默认 spot 是基于错误假设。

### 2.2 处理方式

**默认显示永续，但保留切换**——尊重用户实际场景，同时不抛弃现货用户。

**顶部工具栏左侧布局**（从左到右）：
```
[ 现货 ⇄ 永续 切换器 ]  [BTC/USDT.P 标签]  [当前价]  [24h 涨跌幅]
```

切换器交互：
- 默认选中"永续"（因为是核心用户场景）
- 切换后整个图表数据源变化、永续合约信息面板显隐
- 切换状态保存到用户偏好（登录用户存 Supabase，未登录存 localStorage）

### 2.3 OKX API 调整

**现货行情**（Phase 1 已有）：
```
GET /api/v5/market/ticker?instId=BTC-USDT
GET /api/v5/market/candles?instId=BTC-USDT&bar={tf}
```

**永续合约行情**（Phase 2.2 新增）：
```
GET /api/v5/market/ticker?instId=BTC-USDT-SWAP
GET /api/v5/market/candles?instId=BTC-USDT-SWAP&bar={tf}
```

**永续合约独有数据**（Phase 2.2 新增）：
```
# 资金费率（每 8 小时刷新）
GET /api/v5/public/funding-rate?instId=BTC-USDT-SWAP

# 未平仓合约量（开仓总数）
GET /api/v5/public/open-interest?instId=BTC-USDT-SWAP

# 多空比（顶级交易员持仓）
GET /api/v5/rubik/stat/contracts/long-short-account-ratio?ccy=BTC&period=1H
```

### 2.4 `lib/exchange.ts` 抽象层扩展

```typescript
// 新增类型
export type Market = 'spot' | 'swap';

// 现有函数加 market 参数
export async function getTicker(market: Market): Promise<Ticker>
export async function getKlines(market: Market, interval: string, limit: number): Promise<Candle[]>

// 新增永续独有函数
export async function getFundingRate(): Promise<FundingRate>     // 永续 only
export async function getOpenInterest(): Promise<OpenInterest>   // 永续 only
export async function getLongShortRatio(): Promise<LongShortRatio> // 永续 only
```

### 2.5 永续合约信息面板

**位置**：图表右上角悬浮卡片（仅切换到永续时显示）

**内容**（紧凑布局，类似 OKX 永续页右上角）：
```
当前资金费率：+0.012%（下次扣费 04:35:22）
未平仓合约量：48,392 BTC ($3.6B)
多空比：1.23（多头优势）
```

**配色规则**：
- 资金费率正值（多头付空头）= 绿色
- 资金费率负值（空头付多头）= 红色
- 多空比 > 1 偏绿，< 1 偏红

---

## 3. 画线工具

### 3.1 工具列表

固定在图表左侧的画线工具栏（从上到下）：

| 工具 | 图标参考 | 行为 |
|---|---|---|
| 选择光标 | `mouse-pointer` | 默认状态，点击线条可编辑 |
| 趋势线 | `move-diagonal` | 点两次确定起止点 |
| 水平线 | `minus` | 点一次确定 y 值，水平延伸 |
| 矩形 | `square` | 点两次确定对角 |
| 斐波那契回调 | `git-branch` | 点两次确定起止价位，自动画 0/0.236/0.382/0.5/0.618/0.786/1 |
| 文字标注 | `type` | 点一次定位，弹出输入框 |
| 删除 | `trash-2` | 选中线条后点此删除（或键盘 Delete） |
| 清空所有 | `eraser` | 二次确认后清空 |

### 3.2 技术实现

**lightweight-charts 不内置画线工具**，需要在 Canvas 上自己实现一层：

```typescript
// 新建 components/Chart/DrawingLayer.tsx
// - 一个绝对定位的 <canvas> 覆盖在 lightweight-charts 上
// - 监听鼠标事件，画线条
// - 同步图表的 timeScale 和 priceScale 来计算屏幕坐标
// - 用户画的线存入 state（每条线: 类型 + 时间戳/价格 坐标）
// - 图表缩放 / 平移时重绘所有线
```

**保存策略**：
- 画线状态实时保存到 localStorage（按 timeframe + market 区分 key）
- 登录用户额外保存到 Supabase `user_preferences.preferences.drawings`
- 切换 timeframe 或 market 时分别加载对应集合的画线

### 3.3 状态结构

```typescript
type Drawing =
  | { id: string; type: 'trendline'; p1: { time: number; price: number }; p2: { time: number; price: number }; color: string; width: number }
  | { id: string; type: 'horizontal'; price: number; color: string; width: number }
  | { id: string; type: 'rectangle'; p1: {...}; p2: {...}; color: string; fill: string }
  | { id: string; type: 'fibonacci'; p1: {...}; p2: {...} }
  | { id: string; type: 'text'; pos: {...}; content: string; color: string };

type DrawingsByContext = {
  [key: `${Market}_${Timeframe}`]: Drawing[]
};
```

---

## 4. 扩充指标

### 4.1 完整指标列表（Phase 2.1 + 2.2 合计）

| 指标 | Phase | 类型 | 默认参数 |
|---|---|---|---|
| MA | 2.1 ✅ | 主图叠加 | (20, 50) |
| RSI | 2.1 ✅ | 子图 | 14 |
| MACD | 2.1 ✅ | 子图 | (12, 26, 9) |
| **EMA** | 2.2 | 主图叠加 | (20, 50) |
| **Bollinger Bands** | 2.2 | 主图叠加 | (20, 2.0) |
| **Stochastic** | 2.2 | 子图 | (14, 3, 3) |
| **ATR** | 2.2 | 子图 | 14 |
| **OBV** | 2.2 | 子图 | — |
| **Volume MA** | 2.2 | 成交量子图叠加 | 20 |

**注**：成交量子图 Phase 2.1 已存在但未叠加 MA，Phase 2.2 加上 Volume MA 线。

### 4.2 计算实现

继续用 **客户端 JavaScript 计算**（Phase 2.1 已确立的方案），用 `technicalindicators` npm 包：

```typescript
import {
  EMA, BollingerBands, Stochastic, ATR, OBV
} from 'technicalindicators';

// 例：EMA
const emaInput = { period: 20, values: closePrices };
const emaResult = EMA.calculate(emaInput);
```

### 4.3 指标参数自定义 UI

**入口**：每个已启用指标的右上角"齿轮"图标，点击弹出小面板。

**EMA / MA 面板**：
- 周期 1：数字输入（默认 20，范围 5-200）
- 周期 2：数字输入（默认 50，范围 5-500，可禁用）
- 周期 3：数字输入（默认禁用，范围 5-1000）
- 颜色 1/2/3：色板选择
- "应用"按钮 + "恢复默认"按钮

**Bollinger Bands 面板**：
- 周期：数字（默认 20）
- 标准差倍数：数字（默认 2.0，0.5-4.0 步长 0.5）
- 上轨颜色 / 中轨颜色 / 下轨颜色
- 填充透明度

**RSI 面板**：
- 周期：数字（默认 14）
- 超买线：数字（默认 70）
- 超卖线：数字（默认 30）

**MACD 面板**：
- 快线周期、慢线周期、信号线周期

**Stochastic 面板**：
- %K 周期、%K 平滑、%D 周期

**ATR 面板**：
- 周期

**OBV 面板**：
- 无参数（仅显隐切换）

### 4.4 参数持久化

每个指标的自定义参数存到 `user_preferences.preferences.indicators[indicatorName]`，覆盖 Phase 2.1 的硬编码默认值。

---

## 5. 多图表分屏

### 5.1 范围

**最多 2 个图表，左右排列**。两个图表可独立选 timeframe，但**共享 market**（都是永续或都是现货，避免视觉混乱）。

**典型用法**：左 4h（主时间框架）+ 右 15m（精确入场）。

### 5.2 入口

主图右上角"分屏"按钮（图标 `columns-2`）。点击后页面变为左右两个图表。再点变回单图。

### 5.3 限制

- 移动端 < 768px：分屏不可用，按钮禁用并 tooltip 解释
- 分屏模式下，每个图表的画线工具独立（不共享）
- 分屏模式下，每个图表的指标设置独立

### 5.4 状态保存

`user_preferences.preferences.layout = 'single' | 'split'`
`user_preferences.preferences.split_timeframes = ['4h', '15m']`

---

## 6. 图表截图导出

### 6.1 入口

主图右上角"下载"按钮（图标 `download`）。

### 6.2 行为

- 点击后截图当前图表（含画线、指标）
- 自动添加水印 "BTC Station — `日期`"（左下角小字，浅色）
- 文件名格式：`BTC-USDT-SWAP_4h_2026-04-25.png`
- 直接触发浏览器下载

### 6.3 技术实现

用 `html2canvas` 或 `lightweight-charts` 自带的 `takeScreenshot()` API（推荐后者，更原生）。

水印通过 Canvas 二次绘制添加。

---

## 7. UI 字符串增量（Phase 2.1 中文规范的扩展）

| 英文 | 中文 |
|---|---|
| Spot | 现货 |
| Perpetual / Swap | 永续 |
| Funding rate | 资金费率 |
| Open interest | 未平仓合约量 |
| Long/Short ratio | 多空比 |
| Trend line | 趋势线 |
| Horizontal line | 水平线 |
| Rectangle | 矩形 |
| Fibonacci retracement | 斐波那契回调 |
| Text annotation | 文字标注 |
| Clear all drawings | 清空所有画线 |
| Split view | 分屏视图 |
| Take screenshot | 保存截图 |
| Indicator settings | 指标设置 |
| Period | 周期 |
| Color | 颜色 |
| Restore defaults | 恢复默认 |

---

## 8. API 路由变更

### 8.1 修改：`/api/chart/klines`

```diff
GET /api/chart/klines
?interval={tf}
&limit={n}
&before={ts}
+ &market={spot|swap}
```

`market` 参数默认 `swap`（永续优先）。

### 8.2 修改：`/api/chart/ticker`

同样加 `market` 参数。

### 8.3 新增：`/api/chart/perpetual-info`

```
GET /api/chart/perpetual-info
→ {
    fundingRate: { current: number, nextSettleAt: timestamp },
    openInterest: { contracts: number, usdValue: number },
    longShortRatio: number
  }
```

缓存 30 秒（资金费率每 8 小时变，无需高频）。

### 8.4 修改：`/api/preferences`

`preferences` JSON 结构扩充：
```json
{
  "default_timeframe": "1h",
  "default_market": "swap",
  "indicators": {
    "ma": { "enabled": true, "periods": [20, 50], "colors": ["#26A17B", "#F7931A"] },
    "ema": { "enabled": false, "periods": [20, 50] },
    "bollinger": { "enabled": false, "period": 20, "stdDev": 2.0 },
    "rsi": { "enabled": false, "period": 14, "overbought": 70, "oversold": 30 },
    "macd": { "enabled": false, "fast": 12, "slow": 26, "signal": 9 },
    "stochastic": { "enabled": false, "k_period": 14, "k_smooth": 3, "d_period": 3 },
    "atr": { "enabled": false, "period": 14 },
    "obv": { "enabled": false },
    "volume_ma": { "enabled": false, "period": 20 }
  },
  "drawings": {
    "swap_4h": [...],
    "swap_15m": [...],
    "spot_1h": [...]
  },
  "layout": "single",
  "split_timeframes": ["4h", "15m"],
  "theme": "dark"
}
```

---

## 9. 不做的事（防跑偏）

- ❌ 不做 3 个以上图表分屏
- ❌ 不做画线模板分享 / 导入导出
- ❌ 不做 Pine Script 兼容（永远不做）
- ❌ 不做警报系统（Alert）
- ❌ 不做永续合约的杠杆调整 UI（那是 Phase 7）
- ❌ 不做现货 / 永续之外的市场（如期权、合约期货）
- ❌ 不做指标的"叠加另一个指标到指标"组合（如 MA of RSI）
- ❌ 不做策略系统（那是 Phase 3）
- ❌ 不做画线的精确数学输入（"画一条从 $80,000 到 $95,000 的线"）

---

## 10. 验收标准

### 10.1 功能验收

#### 现货 / 永续切换
- [ ] 切换器在 Header 工具栏左侧显眼位置
- [ ] 默认选中"永续"
- [ ] 切换后图表数据源正确变化（K 线、价格、涨跌幅都更新）
- [ ] 永续模式下显示资金费率 / 未平仓量 / 多空比信息面板
- [ ] 现货模式下隐藏永续信息面板
- [ ] 切换状态登录用户保存到 Supabase，未登录到 localStorage

#### 画线工具
- [ ] 6 种工具（趋势线、水平线、矩形、斐波那契、文字、删除）全部可用
- [ ] 选中线条后可拖动 / 删除
- [ ] 画线后切换 timeframe 仍保留（按 market+timeframe 分别管理）
- [ ] "清空所有画线"二次确认后生效
- [ ] 登录用户画线持久化到 Supabase
- [ ] 图表缩放平移时画线跟随正确

#### 扩充指标
- [ ] EMA / Bollinger / Stochastic / ATR / OBV / Volume MA 全部可启用
- [ ] 与 TradingView 对照计算结果，误差 < 0.1%
- [ ] 每个指标的"齿轮"按钮可弹出参数面板
- [ ] 参数修改后即时生效（无需刷新）
- [ ] "恢复默认"按钮工作正常
- [ ] 参数持久化到偏好

#### 多图表分屏
- [ ] 单图 / 分屏切换流畅
- [ ] 两个图表 timeframe 独立
- [ ] 两个图表共享 market（同时永续或同时现货）
- [ ] 移动端禁用并提示

#### 截图导出
- [ ] PNG 文件下载正常
- [ ] 含画线和指标
- [ ] 文件名包含 market + timeframe + 日期
- [ ] 含 BTC Station 水印

### 10.2 技术验收

- [ ] 所有新增 API 路由 JSON 结构符合规格
- [ ] OKX swap 端点返回数据正确（特别是 `BTC-USDT-SWAP` 不要写错）
- [ ] 偏好 JSON 结构向后兼容（Phase 2.1 已存的偏好不会因 schema 变化丢失）
- [ ] 画线 Canvas 性能流畅（30+ 条画线时拖动图表无卡顿）
- [ ] Vercel 部署成功，公开 URL 验证通过
- [ ] Supabase RLS 策略仍生效（偏好读写权限正确）

### 10.3 合规验收

- [ ] 切换到永续时**不显示**永续高风险提示（那是 Phase 4 + 6 + 7 才需要）
- [ ] 资金费率显示**不带**任何"建议做多/做空"语言
- [ ] 多空比展示**不带**"跟随大户"等暗示性文案
- [ ] 永续合约 UI 文案保持中性（如"做多""做空"是中性术语，"建议做多"是禁用语）

---

## 11. 工作流交付

### Step 1: 本文档 → Claude Design

**指令模板**：
```
我有一个 BTC 量化交易网站 BTC Station，Phase 2.1 已上线
（部署在 https://btc-station.vercel.app）。
现在要做 Phase 2.2，重点是：

1. 加现货/永续切换
2. 画线工具（6 种）
3. 扩充指标（6 个）
4. 多图表分屏
5. 截图导出

请：
1. 读 Phase 1 + 2.1 的 codebase（继承设计系统）
2. 读 Phase 2.2 实施策划书（附件）
3. 产出以下高保真 mockup（全中文）：
   - 完整图表页（永续模式 + 永续信息面板）
   - 画线工具栏（6 种工具的图标和高亮状态）
   - 指标参数面板（每种指标的设置弹窗）
   - 多图表分屏布局
   - 现货/永续切换器组件
   - 移动端布局（< 768px，需明确画线工具如何响应）

要求：
- 全中文文案
- 深色主题延续
- 保持比 TradingView 更克制干净的风格
- 永续合约相关 UI 不要使用引导性视觉（如箭头指向"开多")
- 画线工具栏在移动端的处理方案要明确给出
```

### Step 2: 策划 + 视觉 → Claude Code

**指令模板**：
```
为 BTC Station 实施 Phase 2.2。
- 项目现状：[btc-station.vercel.app + GitHub 仓库]
- 实施策划书：[本附件]
- 视觉设计：[Claude Design 输出]

按以下顺序实施：
1. lib/exchange.ts 扩展（加 market 参数 + 永续独有函数）
2. API 路由扩展（klines / ticker 加 market 参数 + 新增 perpetual-info）
3. UI 顶部工具栏（现货/永续切换器 + 永续信息面板）
4. 扩充指标（EMA / Bollinger / Stochastic / ATR / OBV / Volume MA）
5. 指标参数自定义面板（齿轮按钮 + 弹窗）
6. 画线工具（Canvas overlay + 6 种工具）
7. 画线持久化（localStorage + Supabase）
8. 多图表分屏
9. 截图导出
10. 偏好 schema 升级

每步做完告知我本地验证后再下一步。
最后部署 Vercel。

严禁扩大范围（参见第 9 节）。
特别注意：不要做警报系统、不要做策略系统、不要做实盘交易，那是后续 Phase。
```

---

## 12. 项目负责人实操清单

1. **把本文档丢给 Claude Design**，要求按 Step 1 指令产出视觉
2. **审视觉**，反复迭代到满意
3. **把策划 + 视觉打包丢给 Claude Code**，按 Step 2 指令实施
4. **每步本地验证**（按第 10 节验收清单逐条过）
5. **部署 Vercel**，找朋友测试
6. **Phase 2.2 验收通过** → 回来找我写 **Phase 3.0 实施策划书**

---

## 13. 风险清单

| 风险 | 缓解措施 |
|---|---|
| OKX `BTC-USDT-SWAP` 端点限流 | 与现货端点共享缓存层，避免重复请求 |
| 资金费率数据过期 | 每 8 小时刷新一次足够，缓存 30 秒不会有问题 |
| 画线 Canvas 性能 | 限制单图最多 50 条画线，超过提示用户清理 |
| 多图表分屏数据请求翻倍 | 共享 OKX 缓存，请求量影响有限 |
| 用户偏好 JSON 字段过多 | Supabase `jsonb` 字段无大小限制（实际 1MB 内）；前端用增量更新 |
| 截图水印影响美观 | 水印做得克制（小字、半透明、左下角） |

---

**版本**：v1.0（Phase 2.2 首版）  
**关联文档**：BTC Station 大局路线图 v2.0
