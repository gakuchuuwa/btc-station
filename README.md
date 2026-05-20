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
- 手动：支持拖入 TradingView 格式的完整 Excel / CSV 回测报告（自动解析“交易清单 / List of trades”工作表）。

> 文件兼容性（线上地址：[quant-lab.org/monte-carlo](https://quant-lab.org/monte-carlo)）
> - ✅ BTC Station S3 导出的中文版 XLSX（含 `表现` / `交易分析` / `风险调整后的表现` / `交易清单` / `属性` 5 张中文 sheet）
> - ✅ TradingView 网站原生导出的英文版 XLSX（含 `Performance` / `Trades analysis` / `List of trades` ... 等英文 sheet）
> - 解析器对 sheet 名大小写不敏感；利润列同时识别中文 `净损益 USDT` 与英文 `Net P&L USDT`

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
- 不做市场预测——不添加"当前牛市/熊市/震荡市识别"、"买入建议"、"做多概率"等任何形式的伪确定性功能
- 不做信号推送
- 不承诺收益
- 不引入多币种资产管理
- 不把首页做成营销落地页，首页必须是可用的 BTC 工具入口
- 产品页面/导航以 README 顶部「当前产品范围与页面职责」为唯一真相源；新增主功能或修改导航前先核对该处

### 架构边界

- **前后端通信只走 `/py-api/`**：禁止前端写死 `http://localhost:8000`，禁止 `window.location.hostname === 'localhost'` 分支判断
- **策略源码唯一来源是 `backend/strategies/*.py`**：不要在前端或后端再维护内嵌字符串副本
- **不引入复杂任务系统**：Celery、Redis、Docker 调度、WebSocket 任务流等，除非先完成正式架构升级
- **历史目录视为遗留代码**：`analysis`、`chart`、`backtest`、`hyperopt`、`live` 等不在 README 主架构里的目录，不要继续围绕它们加功能

### 回测边界

- 回测主线使用 VectorBT + Pandas
- 用户策略通过 `execute(df, parameters)` 执行
- 前端只负责展示，不在前端计算策略指标（MA / RSI / MACD 等指标由后端策略执行后返回）
- 买卖点、指标线、资金曲线、交易明细应由后端结果驱动

### 参数优化边界

- 回测和稳健性分析是两个不同性质的功能，分页面承载，不要为了"方便"塞到同一页
  - **回测**回答：这个策略和这组参数在历史上跑出来什么结果？
  - **稳健性分析**回答：这组参数是真的好，还是只是过拟合孤峰？
- 优化结果通过 `localStorage` 在页面间传递
- CSV 兼容 TradingView / TV Assistant / Quant Lab 工作流

### UI 边界

- 各页面要清晰分工
- 不要把稳健性分析功能塞回回测页
- 不要把策略编辑器塞到首页
- 不要为了展示效果添加虚假的收益、信号或预测


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
