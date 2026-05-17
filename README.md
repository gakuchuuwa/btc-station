# BTC Station — 项目规矩

## 项目定位

**BTC Station 是一个面向大众开放的、完全基于 Web 的 BTC 专用在线量化平台。**

核心愿景是**让量化分析平民化**——无需配置复杂的本地环境，任何人都可以随时随地打开网页，在线编写策略、一键极速回测、使用云计算寻找最佳参数组合，并进行专业的稳健性评估。

我们的目标不是预测市场或承诺收益，而是为大众提供一条真实、透明、可复查的专业量化研究流水线：

> 随时在线编写策略 → 极速云端回测 → 寻找最佳参数组合 → 稳健性分析 → 判断参数是否可靠

本项目坚持专注与克制：只做 BTC。绝不加入山寨币市场、荐币、信号推送、行情预测、自动喊单、收益承诺等功能。

---

## 当前产品范围与页面职责

**BTC Station 是一个只研究比特币（BTC）的中文在线量化工作台。** 首页（市场前瞻）主要是比特币的相关新闻资讯和看盘行情，为用户提供宏观的前瞻性洞察。

当前正式产品包含 5 个主页面，且均采用对齐的专业四字命名：

| 页面 | 路径 | 职责 |
| ---- | ---- | ---- |
| 市场前瞻 | `/` | 专攻 BTC 的中文新闻资讯、7日趋势迷你图、实时价格监控 |
| 策略研发 | `/strategy` | Python 策略编写、单次回测（S3）、参数优化运行（S4）及 TV 格式报表一键导出 |
| 蒙特卡洛 | `/monte-carlo` | 单策略（S3）回测交易清单的多重打乱模拟（Shuffling / Bootstrapping）、破产概率计算与资金置信扇形图 |
| 参数优化 | `/report` | 对 S4 调参结果的多维稳健性分析、过滤评分与过拟合邻居法排名 |
| 形态归因 | `/pattern-report` | 结合 K 线经典形态（“六形态”等）对策略回测表现的统计归因分析 |

历史目录中可能存在 `analysis`、`chart`、`backtest`、`hyperopt`、`live`、`strategies` 等旧页面或实验页面。它们不是当前产品主线，除非明确说明，否则不要围绕这些页面继续扩展功能。

顶部导航必须保持整齐统一的专业命名：

```text
市场前瞻 · 策略研发 · 蒙特卡洛 · 参数优化 · 形态归因
```

---

## 五页业务闭环

### 1. 市场前瞻 (首页)

路径：`btc-station/app/(main)/page.tsx`

作为只研究比特币的中文量化平台的入口，主要为用户提供比特币宏观基本面和市场舆情的前瞻。

必须包含：
- BTC/USDT 实时现货价格与 24h 数据变化。
- 7日趋势迷你图表（Mini Sparkline）。
- 精选比特币中文新闻（通过 CoinDesk / CryptoPanic RSS 聚合）。
- 前往策略、优化和蒙特卡洛分析页面的快速直达通道。

不负责：
- 编写或编辑 Python 策略代码。
- 完整的量化回测计算。

### 2. 策略研发 (策略页)

路径：`btc-station/app/strategy/page.tsx`

策略研发页采用**上下分层、四区联动（S1-S4 四象限）**的极端专业化回测与调参布局，专门对标 TradingView 及专业辅助工具的工作流。

#### 四区功能划分：
*   **S1 (图表区 - 顶部)**：
    - 展示 BTC/USDT 多周期（1h/4h/1d）高精度 K 线。
    - 层叠显示由后端策略计算并输出的动态技术指标线（如双均线、通道等）。
    - 渲染 TV 风格的交易信号标记：**做多（绿色 arrowUp）**、**做空（红色 arrowDown）**、**平仓（紫色 arrow）**。
*   **S2 (代码编辑器区 - 中左)**：
    - 集成 Monaco Python 编辑器，支持完整的 VectorBT `execute(df, parameters)` 架构策略在线编写。
    - 支持一键云端保存、重置模板、加载内置模板以及我的云端策略管理。
*   **S3 (回测绩效区 - 中右/底部)**：
    - **深度对标 TradingView 绩效报告**：包含 `回测控制台`、`资金曲线`、`交易明细`、`下载报告` 四个精细化子页签。
    - **导出格式标准化**：支持一键下载 **TV 官方格式标准**的 Excel 回测报表（如 `Turtle_6-Pattern...xlsx` 格式）。导出的 XLSX 文件完美包含以下 5 张标准工作表：
      1. `表现` (Performance summary)
      2. `交易分析` (Trade Analysis)
      3. `风险调整后的表现` (Risk-adjusted ratio)
      4. `交易清单` (List of trades)
      5. `属性` (Backtest attributes)
    - **风控衔接**：配备 **「前往蒙特卡洛验证 🎲」** 一键通道，直接将明细序列送入蒙卡压力测试。
*   **S4 (参数优化区 - 底部)**：
    - **功能深度模拟 `tradingview-assistant-chrome-extension`**：将原本需要浏览器插件辅助的多轮调参工具直接原生内嵌。
    - 支持参数网格扫描（Grid Search）与启发式模拟退火算法（Simulated Annealing）进行多周期批量参数寻找。
    - 实时反馈调参进度，生成多维指标综合排行的参数组合列表。
    - 支持一键导出优化 CSV 报表，并支持 **「一键应用最优参数」** 立即返回 S3 区运行单测。

不负责：
- 稳健性分析排名的最终判定（由 **参数优化** 页面处理）。
- 单个交易的爆仓概率评估（由 **蒙特卡洛** 页面处理）。

### 3. 蒙特卡洛 (风险验证页)

路径：`btc-station/app/monte-carlo/page.tsx`

对单一策略回测表现的统计稳定性进行压力测试，评估“运气成分”。

数据来源：
- 自动：通过策略研发页回测结果直接一键 sessionStorage 传入。
- 手动：支持拖入 TradingView 格式的完整 Excel / CSV 回测报告（自动解析“交易清单”）。

必须包含：
- 历史交易记录的 Bootstrap 随机有放回重抽样（Shuffling）。
- 资金曲线置信区间扇形图（展示 P5、P50 中位数、P95 模拟区间）。
- 最大回撤频率统计直方图。
- 账户破产概率（Risk of Ruin）量化（超过用户阈值时自动标记）。
- 策略鲁棒性统计结论与风控建议。

### 4. 参数优化 (参数报告页)

路径：`btc-station/app/report/page.tsx`

对 S4 参数网格扫描生成的批量结果进行多维稳健性评估与防过拟合检验。

数据来源：
- 自动：从策略研发页调参结束后本地缓存直接提取。
- 手动：上传 TV Assistant 导出的参数网格 CSV。

必须包含：
- 数据去重与多层硬性过滤条件。
- 动态归一化评分机制与单步邻居法（防参数孤岛过拟合）。
- 帕累托前沿（Pareto Frontier）筛选与 Top 推荐参数组合。
- 收益 vs 回撤散点图（自适应坐标比例，带动态缓冲缓冲垫）。

### 5. 形态归因 (形态报告页)

路径：`btc-station/app/pattern-report/page.tsx`

主要针对“六形态”等特定 K 线形态序列交易进行统计层面的技术归因，用于甄别策略在不同技术环境下的真实赚钱效应，判断哪些形态属于“利润提款机”，哪些属于“回撤出血点”。

数据来源：
- 手动：直接拖入或选择包含进出场信号的 TradingView 格式 XLSX 或 CSV 回测报告（如 `Turtle_6-Pattern...xlsx` 格式）。

核心工作流与计算逻辑（基于 `backend/pattern_report.py`）：
1. **形态标签正则提取**：
   - 提取引擎采用正则表达式 `(P\d+)` 过滤并捕获信号名称（如从 `P1-Bullish_Breakout` 信号中提取核心标签 `P1`，对应“六形态”经典编号）。若未匹配则默认保留原始信号名称。
2. **进出场多对一合并 (Trade Merging)**：
   - 提取“进场”（含 `进场` / `Entry`）行提取形态与交易方向。
   - 提取“出场”（含 `出场` / `Exit`）行提取结转利润数据。
   - 根据主键 `交易 #`（或 `Trade #`）将进场行与出场行进行 Inner Merge 双端对齐合并，以在出场行结转绝对利润时，完美溯源其开仓时的形态类型。
3. **分形态多维指标聚合**：
   - 对合并后的各形态独立进行分组统计（Groupby），计算每个形态的：**总交易次数**、**胜率**、**总净盈亏 (USDT)**、**平均单笔净盈亏 (%)**、**盈利因子 (Profit Factor)**、**单笔最大盈利/亏损**，以及**多头/空头分布**。
4. **TradingView 宏观报表联动解析**：
   - 如果用户上传的是多 Sheet 的 Excel 报表，后端会强行模糊搜寻并提取 `表现`、`风险调整后的表现`、`交易分析` 工作表中的官方核心大盘指标（如夏普比率、平均亏损、已支付佣金、年化收益 CAGR 等），拼装进顶部的全局看板中。

不负责：
- 策略网格参数搜索（由 **策略研发** 页面处理）。
- 基于有放回重抽样的概率模拟（由 **蒙特卡洛** 页面处理）。

---

## 技术栈

| 层 | 技术 |
| ---- | ---- |
| 前端 | Next.js + React + TypeScript |
| 样式 | Tailwind CSS + 项目全局 CSS |
| 图表 | Lightweight Charts + Plotly/Canvas |
| 后端 | FastAPI + Uvicorn |
| 回测 | VectorBT + Pandas |
| 数据源 | OKX 公共 API / 本地缓存 |
| 存储 | localStorage；Supabase 只用于用户/策略持久化能力 |
| 稳健性 | `btc-station/lib/robustness.ts` |

---

## 唯一正确运行方式

必须同时启动后端和前端。不要只启动其中一个。

### 1. 启动后端

```powershell
cd "C:\Users\GAKU\Desktop\BTC Tradingview assistant\backend"
.\venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. 启动前端

新开一个终端：

```powershell
cd "C:\Users\GAKU\Desktop\BTC Tradingview assistant\btc-station"
npm run dev
```

### 3. 验证端口

```powershell
netstat -ano | Select-String ":8000"
netstat -ano | Select-String ":3000"
```

### 4. 后端健康检查

```powershell
curl http://localhost:8000/api/templates
```

### 5. 访问

```text
http://localhost:3000
```

---

## 唯一请求路径

前端访问 Python 后端只能走 `/py-api/`。

```text
浏览器
  └─ fetch('/py-api/api/xxx')
       └─ Next.js rewrite
            └─ http://localhost:8000/api/xxx
                 └─ FastAPI
```

规则：

- 所有前端到 FastAPI 的请求必须使用 `/py-api/` 前缀
- 禁止在前端写死 `http://localhost:8000`
- 禁止使用 `window.location.hostname` 判断本地/生产环境
- 禁止维护两套路由
- 如果 `/py-api/` 超时或失败，应该修代理、后端或任务设计，不要绕过代理

正确示例：

```ts
await fetch('/py-api/api/backtest/dynamic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
})
```

错误示例：

```ts
// 禁止
const url = window.location.hostname === 'localhost'
  ? 'http://localhost:8000/api/optimize'
  : '/py-api/api/optimize'
```

---

## 核心 API

后端入口：`backend/main.py`

| API | 用途 |
| ---- | ---- |
| `GET /api/templates` | 获取内置策略模板列表 |
| `GET /api/templates/{id}/code` | 获取策略模板源码 |
| `POST /api/backtest/dynamic` | 动态执行策略回测 |
| `GET /api/backtest/dynamic/csv/{token}` | 下载回测 CSV |
| `GET /api/backtest/dynamic/xlsx/{token}` | 下载回测 XLSX |
| `POST /api/optimize` | 参数优化 |
| `GET /api/optimize/export-csv` | 下载优化 CSV |
| `GET /api/candles/{timeframe}` | 获取本地缓存历史 K 线 |

---

## 关键文件

### 前端

| 文件 | 说明 |
| ---- | ---- |
| `btc-station/app/(main)/page.tsx` | 首页 |
| `btc-station/app/strategy/page.tsx` | 策略工作台 |
| `btc-station/app/report/page.tsx` | 稳健性报告 |
| `btc-station/components/Header.tsx` | 顶部导航 |
| `btc-station/components/MiniChart.tsx` | 策略页 K 线图 |
| `btc-station/components/StrategyTesterPanel.tsx` | 回测/资金曲线/交易/优化/导出面板 |
| `btc-station/lib/robustness.ts` | 稳健性分析核心算法 |
| `btc-station/next.config.js` | `/py-api/*` rewrite |

### 后端

| 文件 | 说明 |
| ---- | ---- |
| `backend/main.py` | FastAPI 入口和核心 API |
| `backend/dynamic_runner.py` | 动态执行用户策略代码 |
| `backend/data_feeder.py` | OKX 数据获取和缓存 |
| `backend/xlsx_exporter.py` | 回测结果导出 XLSX |
| `backend/csv_converter.py` | 结果转 TradingView 兼容 CSV |
| `backend/strategies/` | 内置策略模板源码 |

---

## 开发规矩

### 产品边界

- 只做 BTC
- 不做市场预测
- 不做信号推送
- 不承诺收益
- 不引入多币种资产管理
- 不把首页做成营销落地页，首页必须是可用的 BTC 工具入口
- 当前主线只围绕：首页、策略、报告

### 回测边界

- 回测主线使用 VectorBT + Pandas
- 用户策略通过 `execute(df, parameters)` 执行
- 前端只负责展示，不在前端计算策略指标
- 买卖点、指标线、资金曲线、交易明细应由后端结果驱动

### 参数优化边界

- 策略页执行优化
- 报告页判断稳健性
- 优化结果通过 `localStorage` 传给报告页
- CSV 兼容 TradingView / TV Assistant / Quant Lab 工作流

### UI 边界

- 三个主页面要清晰分工
- 不要把报告页功能塞回策略页
- 不要把策略编辑器塞到首页
- 不要为了展示效果添加虚假的收益、信号或预测

---

## 给未来 AI 的防坑指南

### 1. 严格遵循五页四字导航架构

项目已收敛为统一整齐的五页四字工作流导航，严禁随意添加或修改为其他零散页面（如历史遗留的 `analysis`、`chart` 等）：

```text
市场前瞻 · 策略研发 · 蒙特卡洛 · 参数优化 · 形态归因
```

### 2. 不要绕过 `/py-api/`

发现前端存在 `localhost:8000` 或 `window.location.hostname` 分支时，应改成 `/py-api/`。

### 3. 不要把策略来源复制成多份

内置策略源码的唯一真实来源是：

```text
backend/strategies/*.py
```

不要在前端或后端再维护一份内嵌字符串副本。

### 4. 不要在前端计算策略指标

MA、RSI、MACD 等策略相关指标由后端策略执行后返回。前端只渲染结果。

### 5. 不要把稳健性分析和回测混成一个功能

策略页回答：

```text
这个策略和参数在历史上跑出来什么结果？
```

报告页回答：

```text
这些参数是否稳健，还是只是过拟合孤峰？
```

### 6. 不要加入“当前市场环境判断”

项目哲学是不预测市场。不要添加“当前牛市/熊市/震荡市识别”“买入建议”“做多概率”等伪确定性功能。

### 7. 不要引入复杂任务系统，除非明确重构

当前主线是简单、可运行、可维护。不要随意引入 Celery、Redis、Docker 调度、WebSocket 任务流，除非先完成正式架构升级。

### 9. 海量历史 K 线加载方案 (20,000 根+)

当需要加载深达数年的 K 线（如 20,000 根）用于回测时，禁止一次性同步请求。

**正确方案：**
1.  **首屏秒开**：先拉取最近 500 根数据立即渲染。
2.  **异步追溯**：在后台启动循环请求，利用 `before` 参数分批向前追溯（每批 100-300 根），将数据存入 `Map<number, Candle>` 结构去重合并。
3.  **静默更新**：全部加载完成后再执行一次全量 `setData`，避免频繁重绘导致图表闪烁或滚动条异常。

### 10. 图表重置与缩放 (TradingView 体验)

对于 `lightweight-charts`，"重置" 不应直接使用 `fitContent()`，因为海量数据会导致 K 线缩得太小。

**正确方案：**
1.  通过 `onContextMenu` 拦截原生右键，弹出自定义菜单。
2.  重置操作应手动设置 `timeScale: { barSpacing: 8, rightOffset: 5 }` 以保证 K 线放大倍数适中。
3.  紧接着调用 `scrollToRealTime()` 回到最新数据，并对价格轴执行 `autoScale: true`。

### 11. MiniChart (Lightweight Charts v5) 渲染崩溃防坑指南

这是本项目踩过的最隐蔽的坑，症状是：数据正常到达，控制台无 React 报错，但图表一片空白。

#### 根本原因：Lightweight Charts 会"静默崩溃"

一旦传入的数据违反以下任何规则，图表 Canvas 渲染引擎会直接关闭，既不抛错也不提示。

**雷区 1：时间戳单位混用（毫秒 vs 秒）**

OKX 返回 13 位毫秒（如 `1700000000000`），VectorBT 返回 10 位秒（如 `1700000000`）。两者同时进入图表，X 轴会试图同时显示"2019 年"和"公元 55000 年"，所有数据被压缩到一个像素，图表看起来是空白的。

**正确做法：在 setData 之前统一转换**

```ts
const t = raw.time > 1e12 ? Math.floor(raw.time / 1000) : raw.time
```

**雷区 2：同一时间戳存在两个 Marker**

Lightweight Charts 绝对不允许同一根 K 线上有两个交易标记。同时触发开仓和平仓（或同一根 K 线的买卖信号）时，`setMarkers` 会直接拉闸，导致整条 K 线序列消失。

**正确做法：用 Map 合并同一时间戳的 Marker**

```ts
const uniqueMap = new Map<number, Marker>()
markers.forEach(m => {
  if (uniqueMap.has(m.time)) {
    uniqueMap.get(m.time)!.text += `/${m.text}`  // 合并文字
    uniqueMap.get(m.time)!.color = '#FFD700'      // 冲突时高亮
  } else {
    uniqueMap.set(m.time, { ...m })
  }
})
```

**雷区 3：OHLC 数据中混入 NaN 或 null**

VectorBT/Pandas 合并数据时会产生空值。只要有一根 K 线的 open/high/low/close 是 `NaN`，Y 轴自动缩放会计算出 `-Infinity ~ +Infinity`，图表瞬间缩成不可见的点。

**正确做法：渲染前过滤**

```ts
.filter(c => isFinite(c.open) && isFinite(c.high) && isFinite(c.low) && isFinite(c.close))
```

**雷区 4：v5 不再用 `setMarkers`，要用 `createSeriesMarkers` 插件**

Lightweight Charts v5 中，交易标记通过插件管理，不是直接调用 series 的方法。

```ts
// ❌ 错误（v4 写法，v5 中 series 上没有这个方法）
candleSeries.setMarkers([...])

// ✅ 正确（v5 插件写法）
import { createSeriesMarkers } from 'lightweight-charts'
const markerPlugin = createSeriesMarkers(candleSeries, [])
// 后续更新：
markerPlugin.setMarkers([...])
```

#### 正确的 useEffect 拆分结构

将 K 线、指标线、交易标记分成三个独立的 `useEffect`，避免 `candles` 更新时连带触发 `markers` 的重复渲染：

```ts
useEffect(() => { /* 只渲染 K 线 */ }, [candles])
useEffect(() => { /* 只渲染指标线 */ }, [strategyLines])
useEffect(() => { /* 只渲染交易标记 */ }, [markers, candles])
```

---

### 12. Windows NTFS 数据文件坑：回测笔数异常少

**症状**：回测只有 2～3 笔交易，日志显示"已加载 15998 根历史 K 线"，但实际后端只读到 300 行数据。

**根本原因**：Windows NTFS 不支持冒号 `:` 作为文件名。`data_feeder.py` 以 `BTC/USDT:USDT` 为 symbol 写文件时，系统把 `BTC_USDT:USDT_4h.csv` 解析为 `BTC_USDT` 文件的 **备用数据流（Alternate Data Stream, ADS）**，只写入了 300 行。后续读取 ADS 流，拿到的是这 300 行（≈50天数据），策略只能产生 2～3 笔交易。

**修复方案**（已实施）：在 `data_feeder.py` 的 `get_local_data` 和 `fetch_ohlcv` 里用 `symbol.split(':')[0]` 剥离永续后缀，统一指向 `BTC_USDT_4h.csv`。

**验证命令**：
```python
# 在 backend/ 目录下运行
from data_feeder import DataFeeder
fd = DataFeeder('okx')
print(len(fd.get_local_data('BTC/USDT:USDT', '4h')))  # 应输出 ~15998
```

**排查顺序**：回测笔数异常少时，先跑上面的验证，确认数据量是否正常，再排查策略逻辑。

---

### 13. VectorBT `lock_cash` 砍单坑：资金曲线诡异、回撤虚高

**症状**：
- 回测显示最大回撤 50%+，但翻看交易明细，单笔最大亏损只有几百美元，93 笔交易最差累计回撤算下来不到 2%。
- 资金曲线在 2021 年初等 BTC 暴涨段出现"暴涨后立刻断崖跌回"或"幽灵反手单"导致的离谱波动。
- `pf.trades.records_readable` 里出现策略代码里压根没下过的反向单（明明是平多仓，VBT 解读成"平多 + 反手开空"）。
- 已实现 PnL 总和（trades 求和）与 `pf.value().iloc[-1]` 差出几万甚至十几万美元。

**根本原因**：
1. 策略按"固定 `real_capital`（如 10000）"算仓位，模拟的是 **杠杆/合约账户**（保证金交易）。
2. 但 `vbt.Portfolio.from_orders` 默认是 **现货账户**：`init_cash=10000` 只能买不到 1 BTC。
3. 当策略发出加仓单（比如又要买 0.556 BTC）时，账户里现金不够，`lock_cash=True` 会把订单 **砍成"现金允许的最大值"**（可能从 0.556 砍到 0.089）。
4. 后续平仓单按策略意图发出 `-1.786` BTC，但 VBT 实际持仓只有 `1.318` BTC，多出来的 `0.467` 被解读为 **反手开空**。
5. BTC 暴涨时这些"幽灵空头"产生巨额浮亏 → 制造出虚假的 50%+ 回撤。

**典型表现**：策略 trades 列表显示 93 笔正常交易，但 VBT 内部 `pf.trades` 显示 94+ 笔，其中混入了你从未下单的 Short。

**修复方案**（已实施于 `backend/strategies/TurtleSslDualStrategy.py`）：
```python
# 给 VBT 海量现金确保所有订单 100% 按策略意图成交
_vbt_huge_cash = 1e10
pf = vbt.Portfolio.from_orders(
    close, size=order_size, size_type="amount", direction="both",
    price=order_price, init_cash=_vbt_huge_cash, fees=fees, freq="4h",
    # 注意：移除 lock_cash、min_size、size_granularity
)
# 起点校准：把净值序列拉回真实初始资金
pf = pf.replace(init_cash=init_cash)
```

**验证命令**：
```python
realized = sum(t['PnL'] for t in trades)        # 策略已实现 PnL
vbt_end  = pf.value().iloc[-1] - init_cash      # VBT 末值 - 初始
# 两者差额应该 < 当前持仓浮盈（通常几百美元）
# 若差额 > 1000 美元，几乎可以确定 VBT 砍单了
```

**排查顺序**：当回测回撤明显高于交易明细推算值时：
1. 先按上面公式比对 `realized` 与 `vbt_end`，差额大就是砍单。
2. 检查 `pf.trades.records_readable` 是否出现策略没下过的反向单。
3. 看 `pf.orders.records_readable` 的 Size 列，对比策略发出的 size——如果 VBT 成交量小于策略意图，就是 lock_cash 砍了单。

**写策略时的预防**：
- 模拟合约/杠杆账户的策略（按风险百分比固定算 BTC 数量），VBT 调用必须用海量 `init_cash`，再用 `replace()` 校准。
- 模拟现货账户的策略（按"当前可用现金的 X%"算仓位），可以保留 `lock_cash=True`，但要保证策略内部 `_calc_qty` 也用实时 cash，不能用固定值。
- 永远不要让"策略内部算的 size"和"VBT 实际可成交 size"脱节。

---

### 8. 不要让旧页面继续扩大

`analysis`、`chart`、`backtest`、`hyperopt`、`live` 等目录如果还在，只视为历史代码或实验代码。新增主功能必须先判断能否归入五页四字架构中。

---

### 14. 蒙特卡洛 (Monte Carlo) 压力测试避坑指南

蒙特卡洛主要用于单策略（S3）回测交易清单的鲁棒性极限评估，通过打乱交易顺序或有放回抽样重新拼装资金曲线，暴露“运气带来的过拟合”。

**开发与维护防坑准则：**
1. **数据源结构对齐**：
   - 提取的必须是“出场”记录（类型含 `出场` 或 `Exit`），因为交易的利润只在出场时结算。
   - 净盈亏字段取值按优先级匹配：`净损益 USDT` -> `Net Profit USDT` -> `净损益 USD` -> `Net Profit USD` -> `净损益` -> `Net Profit`。
   - 支持解析多 sheet 的 XLSX（定位 `交易清单`）或单 sheet 的 CSV（默认读取第一张工作表以支持 TV 简易 CSV 导出）。
2. **ECharts 渲染优化**：
   - **权益路径扇形图**：为防止上万条资金曲线导致 Canvas 渲染卡死崩溃，**只能筛选前 100 条曲线进行实际曲线绘制**，而对于 P5 (悲观置信度)、P50 (中位数)、P95 (乐观置信度) 则应在海量抽样完成后，对每个步长（Step）的数据单独排序并计算分位数进行绘制。
   - **回撤频率直方图**：分桶区间应在 0-100% 之间（例如分 20 个桶，每 5% 一个桶）。超过用户设定的“破产阈值”（如 30%）的桶，直方图柱体**必须强行着色为红色（#ef5350）**以示高危预警。
3. **S3 与蒙特卡洛的高速缓存传递桥梁**：
   - 使用 `sessionStorage.setItem('mc_trades_cache', ...)` 传递精简后的 `{ id: number; profitUSDT: number }[]` 数组。
   - 蒙特卡洛页面加载时，必须在 `useEffect` 中优先读取并自动载入该缓存（载入后应立即销毁该缓存，防止刷新时反复加载）。

---

### 15. 参数优化 (Parameter Optimization) 散点图与数据处理避坑指南

该页面（原报告页）主要承载对 S4 网格/退火调参后海量数据的鲁棒性筛选。

**开发与维护防坑准则：**
1. **收益 vs 回撤散点图 (ScatterPlot) 动态轴缩放**：
   - **禁止强行把坐标轴原点锁死在 0**：因为海量优质参数的收益可能集中在高位，回撤集中在极小区间。如果强行把轴限制为 `0` 起点，所有散点会被极度压缩挤在一起，完全失去可视化对比意义。
   - **自适应 Nice Ticks 计算**：必须使用科学的 `niceTicks` 算法，根据所有样本的实际 `Min / Max` 动态推算轴边界，并在首尾两端自动预留 **5% 的 Padding / 缓冲空间**。
   - **界面高度预算**：散点图容器高度必须克制，通常控制在 **400px** 左右（过高会导致页面信息密度低，用户体验差）。
2. **数据去重与过滤逻辑防缩水**：
   - **坚决杜绝硬编码过滤上限**：历史版本中曾出现过因为去重硬编码导致前端只显示 48 条参数的恶性 Bug。去重和评分机制必须对全量扫描出的 Epoch 结果负责，不可以用任何硬上限进行粗暴过滤。
   - **邻居法（防参数孤岛）**：计算某个参数的稳健性评分时，必须检查其周围邻居（如快均线 +2/-2 步长）的绩效，剔除因为行情巧合形成的”孤峰”参数。

---

### 16. OKX 历史 K 线只拉到几个月：`history-candles` vs `candles` 接口区别

**症状**：Railway 后端日志打印 `Fetching 18000 candles ... (may take a while)` 但下一行立即 `Saved 300 rows`。前端 K 线只显示最近一两个月。

**根本原因**：OKX REST 有**两个**历史 K 线接口，CCXT 根据参数自动路由：
| 接口 | 数据深度 | 触发方式 |
|---|---|---|
| `/api/v5/market/candles` | **仅最近约 8 个月** | 不传 `since`，或传 `until/params` |
| `/api/v5/market/history-candles` | **从交易对上线日起的全部历史** | 传 `since`（不传 `until`） |

如果分页用 `params={'until': earliest_ms}` 反向拉，CCXT 路由到第一个接口，最多只能拿到 ~1440 根（8 个月）。

更糟的是：如果 `since = now - limit * tf_ms` 设得**太早**（比如 limit=18000 + 4h = 起点 2018-02，但 OKX 永续 BTC/USDT:USDT 2019-11 才上线），首批返回空 → 循环 break → fallback 到”最近 300 根”。

**修复方案**（已实施于 `backend/data_feeder.py`）：反向分页用 `since` 而非 `until`：

```python
# 第一批：不带 since，OKX 返回最近 300 根
batch = self.exchange.fetch_ohlcv(symbol, timeframe, limit=300)
all_ohlcv = list(batch) if batch else []

# 后续批次：用最早时间戳算 since 反向往前拉（走 history-candles 接口）
while all_ohlcv and len(all_ohlcv) < limit:
    earliest_ms = all_ohlcv[0][0]
    next_since = earliest_ms - 300 * tf_ms
    older = self.exchange.fetch_ohlcv(symbol, timeframe, since=next_since, limit=300)
    if not older:
        break  # 到达交易对最早数据
    existing_ts = {row[0] for row in all_ohlcv}
    new_rows = [row for row in older if row[0] not in existing_ts]
    if not new_rows:
        break
    all_ohlcv = sorted(new_rows + all_ohlcv, key=lambda r: r[0])
    time.sleep(self.exchange.rateLimit / 1000.0)
```

**验证命令**（本地或 Railway 部署后）：
```bash
curl -s “https://btc-station-backend-production.up.railway.app/api/candles/4h” | \
  python -c “import sys,json,datetime; d=json.load(sys.stdin)['candles']; \
    print(len(d), datetime.datetime.fromtimestamp(d[0]['time'],datetime.UTC).date(), '->', \
    datetime.datetime.fromtimestamp(d[-1]['time'],datetime.UTC).date())”
# 期望：14068 2019-12-16 -> <今天>（4h 周期 BTC/USDT:USDT 全历史）
```

**排查顺序**：当 K 线显示明显偏少时，先用上面 curl 看后端返回多少根。如果 < 1000 根，就是这个 bug；如果 14000+ 而前端少，就是前端缓存或渲染问题（Ctrl+Shift+R 强刷）。

---

### 17. Railway 部署：Builder 必须显式设为 Dockerfile，否则用 Railpack 自选 Python 版本

**症状**：明明 `backend/Dockerfile` 第一行 `FROM python:3.11-slim` 写死了 Python 版本，构建日志却显示 `Cannot install on Python version 3.14.3; only versions >=3.10,<3.14 are supported`，numba/vectorbt 编译失败。或者部署”成功”但实际跑的是 Caddy 静态服务器（HTTP 502，Deploy Logs 出现 `using config from file file: Caddyfile`）。

**根本原因**：Railway 默认 Builder 是 **Railpack**（Railway 自研自动构建器），它**不读 Dockerfile**：
- 看到根目录有 `index.html` → 当成静态网站，跑 Caddy
- 看到 Python 项目 → 自己选 Python 版本（默认拉最新版，如 3.14）

`backend/Dockerfile` 完全被忽略。

**修复方案**（一次性配置，永久生效）：
1. 在 Railway 服务的 **Settings → Build → Builder** 卡片，从 `Railpack` 切换到 **`Dockerfile`**
2. **Dockerfile Path** 填 `Dockerfile`（相对 Root Directory，已经是 `/backend`）
3. 保存后会自动触发新部署

**排查顺序**：Railway 构建日志里如果出现 `cp314` / `cp313`（说明用了高版本 Python）、或 Deploy Logs 里出现 `Caddyfile` / `admin endpoint disabled`（说明在跑 Caddy），第一时间检查 Builder 设置，**不要去改 Dockerfile**，因为根本没在用它。

---

### 18. PyPI 包名规范化与新版 `pandas-ta` 陷阱

**症状 A**：`requirements.txt` 写 `pandas_ta`，pip 报 `Could not find a version that satisfies the requirement pandas_ta`。
**症状 B**：改成 `pandas-ta` 后，Python 3.11 下仍然 `No matching distribution found`，但 Python 3.12 装得上。

**根本原因**：
1. **PyPI 包名只用连字符**：`pandas_ta`（下划线）不是合法的 PyPI 名，Python `import` 时才写下划线。两者的对应关系是 PyPI 内部的”规范化”机制——`pip install pandas-ta` 后 `import pandas_ta` 才能用。
2. **PyPI 上 `pandas-ta` 已易主**：原作者 Twopirllc 的老 `pandas_ta` 兼容 Python 3.7+，但**当前 PyPI `pandas-ta` 名下的包是新作者重写的 0.4.x 版本**，`requires_python >=3.12`。Python 3.11 完全装不上。

**修复方案**（已实施）：
- `requirements.txt` 写 `pandas-ta`（连字符）
- `backend/Dockerfile` 用 `FROM python:3.12-slim`（不能再用 3.11）
- 由于新版 API 跟老版 pandas_ta 可能不完全一致，调用 pandas_ta 的代码（如 `vbt_optimizer.py`）必须在升级后跑一遍单元测试或冒烟测试

**备选方案**（如果新版 API 不兼容）：requirements.txt 改用 `git+https://github.com/twopirllc/pandas-ta.git` 直接从作者仓库装老版本，绕开 PyPI。

**排查顺序**：装包失败时，先用 `curl https://pypi.org/pypi/<pkg>/json | python -c “import sys,json; d=json.load(sys.stdin); print(d['info']['version'], d['info'].get('requires_python'))”` 确认包名拼写正确和 Python 版本要求。

---

### 19. FastAPI 用了表单/文件上传必须装 `python-multipart`

**症状**：FastAPI 应用启动时崩溃，Deploy Logs 出现：
```
RuntimeError: Form data requires “python-multipart” to be installed.
You can install “python-multipart” with: pip install python-multipart
```

**根本原因**：任何路由用了 `Form(...)`、`File(...)`、`UploadFile` 等表单/文件上传参数，FastAPI 都会在**应用启动时**（不是运行时）检查 `python-multipart` 是否已装。本项目 `backend/pattern_report.py` 的 `/pattern-report/analyze` 路由用了表单上传。

**修复方案**（已实施）：`requirements.txt` 添加 `python-multipart`。

**注意**：FastAPI 文档里 `python-multipart` 是 “Optional Dependency”，不在 `pip install fastapi` 默认装的列表里，需要手动加。

---

## 验证记录

### 2026-05-09

MA 双均线 · 4h · 16500 根 K 线 · 10000 USD 初始资金

```text
净收益 +496.97%
最大回撤 68.74%
胜率 37.2%
交易 192 笔
Sharpe 0.78
Sortino 1.12
盈利因子 1.24
```

### 2026-05-11 (K 线加载与图表优化)

ATR 通道策略 · 4h · 20,000 根 K 线（追溯至 2017 年）

```text
净收益 +994.32%
回测稳定性：极高 (背景异步加载)
UI 交互：已添加右键重置 (TradingView 风格)
```

### 2026-05-11 (下载格式标准化)

为了对标专业量化流程，规范了各层级的数据导出：

- **S3 层 (单策略回测)**：导出详细的 XLSX 报表，包含 5 个 Sheet（表现、交易分析、风险调整、交易清单、属性），格式与 TradingView 导出完全一致。
- **S4 层 (参数优化)**：导出 CSV 报表，记录所有优化 Epoch 的参数组合及其绩效指标，方便横向对比。

### 2026-05-11 (产品架构收敛)

产品范围收敛为：
- 首页 (行情前瞻) / 策略 (开发与参数优化) / 报告 (稳健性分析)

后续开发以本 README 为准。

### 2026-05-18 (蒙特卡洛上线与五页四字架构收敛)

为了实现从策略研发到极端风控的无缝衔接，进行了平台级大重构：
- **五页四字命名对齐**：全站路由收敛为 `市场前瞻` | `策略研发` | `蒙特卡洛` | `参数优化` | `形态归因`，界面视觉美感与汉字节奏感极大提升。
- **蒙特卡洛风控页上线**：完全在前端实现高性能 Bootstrap 重抽样。引入 ECharts 专业级权益路径扇形图（置信区间）与回撤频率直方图，一键算出破产概率（Risk of Ruin）。
- **S3 至蒙特卡洛一键直达**：在 S3 回测绩效看板头部加入「前往蒙特卡洛验证 🎲」按钮，利用 sessionStorage 极速打通交易明细传递通道。

---

## 免责声明

本项目仅供量化技术研究与学习使用，不构成投资建议。任何基于本系统的真实资金交易，风险由使用者自行承担。
