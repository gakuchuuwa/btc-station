# BTC Station — 项目指令书 (Phase 1)

> 本文件是写给 AI 编码助手（如 Claude Code）的项目规格。请严格按照本文件要求搭建项目。遇到未明确的细节按"常规最佳实践"处理，但**不要扩大 Phase 1 的范围**。

---

## 0. 项目一句话介绍

**BTC Station** 是一个只关注比特币（BTC）的个人量化交易工作台，运行在本地或私人服务器，不对外服务。长期愿景包含：资讯 → 图表 → 策略 → 回测 → 参数优化 → AI 分析 → 对接交易所。**Phase 1 只做第一步：主页 + 资讯 + 简易图表。**

---

## 1. 基本约束（务必遵守）

| 项目 | 规则 |
|---|---|
| 币种 | **只做 BTC**。不要添加 ETH / 其他币种的任何代码或 UI |
| 用户 | 单用户、本地使用。**不要**加登录、注册、用户管理、权限 |
| 数据库 | Phase 1 不需要数据库。所有数据实时从 API 拉取 |
| 部署 | 本地开发为主。不要配置 Docker、CI/CD、云部署脚本 |
| 实时性 | **不要用 WebSocket**。用 HTTP 轮询（30 秒刷新一次足够） |
| 图表库 | 用 TradingView **Lightweight Charts**（免费开源）。**不要**使用 Advanced Charts / Charting Library（需要申请授权） |
| 国际化 | 先做中文 UI。不要搭 i18n 框架 |

---

## 2. 技术栈（硬性要求）

```
- Next.js 14 或 15（App Router，不是 Pages Router）
- TypeScript（严格模式）
- Tailwind CSS
- lightweight-charts（npm 包，TradingView 出品）
- Node.js 18+
```

**禁止引入**：Redux、Zustand、MobX、Recoil 等状态管理库（用 React hooks 就够）；shadcn 之外的 UI 组件库；任何 CSS-in-JS 库（Emotion、styled-components）。

**建议引入**：`shadcn/ui`（按需复制组件，不是依赖）、`lucide-react`（图标）、`date-fns`（日期格式化）。

---

## 3. 目录结构（固定结构）

```
btc-station/
├── app/
│   ├── layout.tsx              # 全局布局（含 Header）
│   ├── page.tsx                # 主页
│   ├── globals.css
│   ├── chart/
│   │   └── page.tsx            # 占位页：显示 "Coming in Phase 2"
│   ├── strategies/
│   │   └── page.tsx            # 占位页：显示 "Coming in Phase 3"
│   ├── backtest/
│   │   └── page.tsx            # 占位页：显示 "Coming in Phase 3"
│   └── api/
│       ├── btc/
│       │   ├── summary/route.ts    # 当前价 + 24h 数据
│       │   └── klines/route.ts     # 历史 K 线
│       └── news/route.ts           # BTC 新闻
├── components/
│   ├── Header.tsx              # 顶部导航
│   ├── PriceCard.tsx           # 主页大价格卡
│   ├── MiniChart.tsx           # 主页 7 日走势图（SVG 或 lightweight-charts）
│   ├── StatsGrid.tsx           # 4 个统计方块（24h 高/低/量/市值）
│   └── NewsFeed.tsx            # 新闻列表
├── lib/
│   ├── binance.ts              # Binance API 封装
│   └── news.ts                 # 新闻源封装
├── types/
│   └── btc.ts                  # 类型定义
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.js
└── README.md                   # 如何启动
```

---

## 4. Phase 1 必须完成的功能

### 4.1 主页 `/`

自上而下：

1. **Header**：左边 "₿ BTC Station" 标题；右边 4 个导航链接（Home / Chart / Strategies / Backtest）。当前页高亮。
2. **大价格卡**：
   - 左上：`BTC / USDT` 小字标题
   - 左下：当前价（大字，`$94,382.50` 这种格式，千位分隔）
   - 右上：24h 涨跌幅徽章（绿底涨、红底跌，含箭头）
   - 下半部分：**7 日收盘价折线图**（无坐标轴，简洁的 area chart）
   - 折线图下方两行小字：左"7 days ago" 右"Today"
3. **统计网格（4 列）**：24h High / 24h Low / 24h Volume / Market Cap
4. **新闻列表**：显示 6–8 条最新 BTC 新闻，每条包含标题 + 来源 + 相对时间（"2h ago"）。点击跳转原文。
5. **底部 CTA 行**：
   - 左按钮（主按钮）"Open full chart →" → 跳 `/chart`
   - 右按钮（次按钮）"Run a strategy" → 跳 `/strategies`

### 4.2 占位页

`/chart`、`/strategies`、`/backtest` 都只显示：
- Header（同主页）
- 居中大字"Coming in Phase X"
- 一句话说明本阶段会做什么

### 4.3 数据刷新

主页数据每 30 秒自动轮询一次，手动也可以刷新页面。新闻可以每 5 分钟刷一次（或仅页面加载时刷）。

---

## 5. 数据源规格

### 5.1 Binance 公共 API（无需 API Key）

基础 URL：`https://api.binance.com`

**当前价 + 24h 统计**
```
GET /api/v3/ticker/24hr?symbol=BTCUSDT
```
返回字段用到：`lastPrice`, `priceChangePercent`, `highPrice`, `lowPrice`, `quoteVolume`。

**K 线**
```
GET /api/v3/klines?symbol=BTCUSDT&interval=1d&limit=7
```
返回二维数组，每条 `[openTime, open, high, low, close, volume, closeTime, ...]`。

**市值**：Binance 不提供市值。用 CoinGecko 免费 API：
```
GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true
```

### 5.2 新闻源

**首选：CoinDesk RSS**（无需 API Key）
```
https://www.coindesk.com/arc/outboundfeeds/rss/
```
用 `fast-xml-parser` 解析。只保留标题含 "bitcoin" 或 "BTC" 的条目。

**备选：CryptoPanic**（需要免费 API Key，写在 `.env.local`）
```
GET https://cryptopanic.com/api/v1/posts/?auth_token=XXX&currencies=BTC
```

Phase 1 用 CoinDesk RSS 即可，不需要注册。

### 5.3 Next.js API 路由封装

所有数据都通过 Next.js 自己的 API 路由代理，**不要让前端直接 fetch Binance**（避免浏览器 CORS 问题和 API 限制分散）。

```
GET /api/btc/summary
→ { price: number, change24h: number, high24h: number, low24h: number, volume24h: number, marketCap: number }

GET /api/btc/klines?interval=1d&limit=7
→ { time: number, open: number, high: number, low: number, close: number, volume: number }[]

GET /api/news
→ { title: string, url: string, source: string, publishedAt: string }[]
```

API 路由要做**服务端缓存**（Next.js 的 `revalidate` 或简单的 in-memory cache）：
- summary：缓存 10 秒
- klines：缓存 60 秒
- news：缓存 300 秒（5 分钟）

避免频繁打 Binance / CoinGecko 被限流。

---

## 6. 设计规范

### 6.1 色彩

**默认深色主题**（可选浅色切换，Phase 1 可以不做切换，硬编码深色即可）：

| 用途 | 颜色 |
|---|---|
| 背景 | `#0B0E11`（深黑蓝） |
| 卡片背景 | `#161A1E` |
| 主要文字 | `#EAECEF` |
| 次要文字 | `#848E9C` |
| 边框 | `rgba(255,255,255,0.08)` |
| 涨（绿） | `#26A17B` |
| 跌（红） | `#E84C3D` |
| 图表线（涨） | `#26A17B` |
| 图表填充（涨） | `rgba(38, 161, 123, 0.12)` |

### 6.2 字体

- 无衬线：`'Inter', system-ui, -apple-system, sans-serif`
- 数字可以用 `font-variant-numeric: tabular-nums` 防止跳动

### 6.3 圆角与间距

- 卡片圆角 `12px`
- 按钮圆角 `8px`
- 页面左右留白（mobile 16px / desktop 24px）
- 主内容区最大宽度 `1100px`，居中

### 6.4 响应式

桌面优先。手机端（< 768px）：统计网格 4 列变 2 列；按钮行堆叠。

---

## 7. 代码质量要求

- 所有组件用 TypeScript + 显式类型（不要大量用 `any`）
- 数字显示统一用工具函数（`formatUsd`、`formatPercent`、`formatVolume`），放在 `lib/format.ts`
- API 路由要 try/catch，失败时返回合理的 fallback（比如上次缓存值或 0），不要让前端白屏
- 所有外部 URL 不要硬编码在组件里，集中在 `lib/binance.ts` 和 `lib/news.ts`

---

## 8. 不要做的事（防止跑偏）

- ❌ 不要添加其他币种
- ❌ 不要加用户登录
- ❌ 不要用 WebSocket
- ❌ 不要搭数据库（PostgreSQL / SQLite / MongoDB 都不要）
- ❌ 不要做国际化（i18n）
- ❌ 不要写单元测试（Phase 1 不做测试，后面再补）
- ❌ 不要做深度定制的 K 线指标（这是 Phase 2 的事）
- ❌ 不要做回测（这是 Phase 3 的事）
- ❌ 不要引入 Redux / Zustand 等状态管理
- ❌ 不要做 PWA / 离线支持
- ❌ 不要配置 Docker

---

## 9. 启动方式

README.md 必须写清楚：

```bash
# 安装
npm install

# 开发
npm run dev
# 浏览器访问 http://localhost:3000

# 可选：创建 .env.local 填入 CryptoPanic API Key
# CRYPTOPANIC_TOKEN=xxx
```

---

## 10. 验收标准（完成判断）

- [ ] `npm install && npm run dev` 一次性能跑起来，无报错
- [ ] `http://localhost:3000` 显示主页，所有区块按规格呈现
- [ ] 价格是**真实的 BTC 实时价**（从 Binance 拉），不是假数据
- [ ] 24h 涨跌幅颜色正确（涨绿跌红）
- [ ] 7 日折线图显示真实 7 天收盘价，形状合理
- [ ] 新闻列表有 6+ 条 BTC 相关真实新闻，点击能跳原文
- [ ] 4 个导航链接都能点，占位页显示 "Coming in Phase X"
- [ ] 手机宽度下布局不错乱
- [ ] 30 秒后价格会自动刷新
- [ ] 所有 API 路由返回的 JSON 结构符合第 5.3 节的规格

---

## 11. 后续阶段预告（只是让架构预留空间，不要现在做）

- **Phase 2**：完整的 TradingView 风格图表页 `/chart`，含多种时间周期、内置指标（MA/EMA/RSI/MACD/布林带）、画线工具
- **Phase 3**：策略系统（`/strategies` 列表、新建、编辑）+ 回测引擎。届时会引入 Python 后端（FastAPI + vectorbt）。**Phase 1 的 Next.js API 路由架构要方便以后改成代理转发到 Python 服务**。
- **Phase 4**：参数优化（网格扫描 + 热力图 + CSV 导出 + 最优参数推荐）
- **Phase 5**：Claude/GPT 接入分析策略 + 交易所 API（Binance / OKX）模拟盘 → 实盘

---

## 附录 A：给 Claude Code 的第一条指令（复制粘贴用）

```
我要搭一个叫 BTC Station 的个人 BTC 交易工作台。

请严格按照我提供的《BTC Station 项目指令书 Phase 1》搭建项目。
指令书文件在：[把本 md 文件拖进 Claude Code 的会话，或粘贴路径]

请你：
1. 先读完整份指令书
2. 列出你准备创建的文件清单给我确认
3. 我确认后，你一次性把项目脚手架 + 所有页面 + 组件 + API 路由都写好
4. 最后告诉我怎么跑起来

要求：
- 严格遵守第 1 节的"基本约束"和第 8 节"不要做的事"
- 不要问我太多细枝末节的问题（比如色号、间距），按指令书定的来
- 如果你认为指令书有地方不合理，先跟我讨论再改，不要自作主张

准备好了告诉我。
```

---

## 附录 B：你（用户）的工作流

1. **安装 Claude Code**（`npm install -g @anthropic-ai/claude-code`，然后 `claude` 启动）
2. 在终端 `cd` 到你想放项目的目录（比如桌面的 `BTC Tradingview assistant` 文件夹）
3. 启动 Claude Code，粘贴附录 A 的指令
4. 把本 md 文件拖进会话
5. Claude Code 跑完后，按它提示的命令启动
6. 浏览器打开 `http://localhost:3000`
7. 有不满意的地方，继续跟 Claude Code 对话调整（比如"把价格字体再大 20%"、"新闻列表改成卡片样式"）
8. 都满意后，我们再写 Phase 2 指令书

---

**版本**：v1.0（Phase 1）
**下一版本**：v2.0（Phase 2 图表页）
