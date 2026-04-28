# BTC Station — 项目指令书 (Phase 1, v1.2)

> **v1.2 相比 v1.1 的变化**：
> 1. 交易所 API 从 Binance 改为 **OKX**（Phase 1 实际已用，现在文档对齐）
> 2. 产品语言从以中文为主改为 **全中文化**（面向华语用户）
> 3. 新增中文字体栈、中文文案规范
> 4. 注：本文档主要用于**订正已完成项目的规范文档**，你现有代码已是 OKX 不需动，文案需中文化

---

## 0. 项目概览

**BTC Station** 是一个**只关注比特币（BTC）的轻量级量化交易平台**，面向**全球华语用户**（不主动推广中国大陆但不封 IP），提供"专注 BTC 的 TradingView 精简版 + 强化的参数优化能力"。

**服务定位（非常重要）**：本平台是**交易工具**（tool），不是**投资顾问服务**（advisory）。所有策略由用户自行编写、自行选择、自行承担盈亏。平台不主动推送交易信号、不代客理财、不托管用户资金。

**商业模式**：
- **Freemium**：基础功能免费，高级功能订阅付费
- **BYOK（Bring Your Own Key）**：AI 功能由用户自备 API Key

**长期愿景**：
1. Phase 1：主页 + 资讯 + 简易图表（公开）
2. Phase 2.1：登录系统 + 完整图表页（精简版指标）
3. Phase 2.2：完整图表页（所有指标 + 画线工具）
4. Phase 3：策略系统 + 回测引擎
5. Phase 4：参数优化 + Stripe 订阅上线
6. Phase 5：AI 分析（BYOK）
7. Phase 6：模拟盘
8. Phase 7：真实交易所对接（API Key 仅存浏览器本地）

---

## 1. 基本约束

| 项目 | 规则 |
|---|---|
| 币种 | **只做 BTC** |
| 语言 | **全中文 UI**，不搭 i18n 框架 |
| 目标用户 | 全球华语用户（不封大陆 IP 但不主动推广） |
| 交易所数据源 | **OKX 公共 API**（已统一） |
| 用户系统 | Phase 1 不实现登录逻辑，Header 放"登录 / 注册"按钮跳占位页 |
| 数据库 | Phase 1 不接数据库，Phase 2.1 接 Supabase |
| 部署 | Vercel |
| 实时性 | HTTP 轮询（30 秒） |
| 图表库 | TradingView Lightweight Charts |
| 文案基调 | 强调"工具"属性，**避免**"推荐""建议买入""跟单"等词 |

---

## 2. 技术栈

**Phase 1 使用**：
- Next.js 14/15（App Router）
- TypeScript（严格模式）
- Tailwind CSS
- lightweight-charts
- Node.js 18+
- 部署到 Vercel

**Phase 2+ 锁定（Phase 1 只在 README 标注）**：
- Supabase（Auth + Postgres）
- Stripe（订阅付费）
- Python + FastAPI + vectorbt（回测引擎）

**禁止**：Redux / Zustand / CSS-in-JS / shadcn 之外的 UI 库

**允许**：shadcn/ui、lucide-react、date-fns、fast-xml-parser

---

## 3. 目录结构

```
btc-station/
├── app/
│   ├── layout.tsx              # 全局布局（Header + Footer）
│   ├── page.tsx                # 主页
│   ├── globals.css
│   ├── login/page.tsx          # 占位
│   ├── chart/page.tsx          # 占位
│   ├── strategies/page.tsx     # 占位
│   ├── backtest/page.tsx       # 占位
│   ├── terms/page.tsx          # 服务条款占位
│   ├── privacy/page.tsx        # 隐私政策占位
│   └── api/
│       ├── btc/
│       │   ├── summary/route.ts
│       │   └── klines/route.ts
│       └── news/route.ts
├── components/
│   ├── Header.tsx
│   ├── Footer.tsx
│   ├── PriceCard.tsx
│   ├── MiniChart.tsx
│   ├── StatsGrid.tsx
│   └── NewsFeed.tsx
├── lib/
│   ├── exchange.ts             # 交易所抽象层（Phase 1 内部实现用 OKX）
│   ├── okx.ts                  # OKX 具体实现
│   ├── news.ts
│   └── format.ts
├── types/btc.ts
├── .env.example
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.js
├── vercel.json
└── README.md
```

**架构说明**：`lib/exchange.ts` 作为抽象层，`lib/okx.ts` 作为实现。这样未来若要加备用数据源（如 Binance 做 fallback），只需新增 `lib/binance.ts` 并在 `exchange.ts` 里切换，前端和 API 路由不用改。

---

## 4. Phase 1 功能规格

### 4.1 主页 `/`

1. **Header**（全站共用）
   - 左：`₿ BTC Station` 品牌标识
   - 中：4 个导航 — **首页 / 图表 / 策略 / 回测**（当前页高亮）
   - 右：**"登录 / 注册"** 按钮（点击跳 `/login`）

2. **价格卡片**
   - 左上：`BTC / USDT` 小字标题
   - 左下：当前价（大字，千位分隔：`$77,843.60`）
   - 右上：24h 涨跌幅徽章（涨绿跌红）
   - 中部：**7 日收盘价折线图**（area chart，无坐标轴）
   - 底部两行小字：`7 天前` 和 `今天`

3. **统计网格（4 列）**：
   - `24h 最高` / `24h 最低` / `24h 成交额` / `市值`

4. **新闻列表**：6–8 条 BTC 新闻，标题 + 来源 + 相对时间（"2 小时前"、"昨天"等中文相对时间）。点击跳原文（新窗口）。

5. **底部 CTA 行**
   - 主按钮：`打开完整图表 →` → `/chart`
   - 次按钮：`运行策略` → `/strategies`

6. **Footer**（全站共用）
   - 左：`© 2026 BTC Station`
   - 中：免责声明小字 — **"本服务仅为交易分析工具，不构成投资建议。所有交易盈亏由用户自行承担。"**
   - 右：服务条款 / 隐私政策 链接

### 4.2 占位页

每个占位页显示：
- Header + Footer
- 居中大字 "敬请期待 Phase X"
- 一句话说明（中文）
- 对应 Phase 和付费层级标签（如：`免费`、`免费 + Pro`）

占位页文案（中文）：
- `/login`：`Phase 2.1：用户系统即将上线，届时可保存策略与回测结果`
- `/chart`：`Phase 2.1：完整图表页即将上线（多周期 + 技术指标）`
- `/strategies`：`Phase 3：策略系统即将上线（编辑、保存、分享）`
- `/backtest`：`Phase 3：回测引擎即将上线（含 Pro 版参数优化）`
- `/terms`：`服务条款将在正式上线前发布。`
- `/privacy`：`隐私政策将在正式上线前发布。`

### 4.3 数据刷新

- 主页价格/统计：每 30 秒轮询
- 新闻：每 5 分钟轮询
- 手动刷新页面也支持

---

## 5. 数据源规格

### 5.1 OKX 公共 API（无需 Key）

基础 URL：`https://www.okx.com`

**当前价 + 24h 统计**
```
GET /api/v5/market/ticker?instId=BTC-USDT
```
响应字段用到：`last`（当前价）、`open24h`、`high24h`、`low24h`、`volCcy24h`（成交额，USD 计）

计算 24h 涨跌幅：`(last - open24h) / open24h * 100`

**K 线**
```
GET /api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=7
```
响应：每条 `[ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]`

**市值**（OKX 不提供，用 CoinGecko）
```
GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true
```

### 5.2 新闻源

**首选：CoinDesk RSS**（无需 Key）
```
https://www.coindesk.com/arc/outboundfeeds/rss/
```
用 `fast-xml-parser` 解析，过滤标题含 "bitcoin" / "BTC" 的条目。**新闻原文保持英文，但 UI 上"X 小时前"等相对时间要中文**。

**备选**（Phase 2+ 再考虑）：
- CryptoPanic（需要 Key）
- 金色财经 / 巴比特（中文，但没有公开 API，需爬）

### 5.3 Next.js API 路由封装

所有外部请求通过自家 API 路由代理：

```
GET /api/btc/summary
→ { price, change24h, high24h, low24h, volume24h, marketCap }

GET /api/btc/klines?interval=1D&limit=7
→ { time, open, high, low, close, volume }[]

GET /api/news
→ { title, url, source, publishedAt }[]
```

**服务端缓存**：
- summary：10 秒
- klines：60 秒
- news：300 秒

---

## 6. 设计规范

### 6.1 色彩（深色主题默认）

| 用途 | 颜色 |
|---|---|
| 背景 | `#0B0E11` |
| 卡片 | `#161A1E` |
| 主文字 | `#EAECEF` |
| 次文字 | `#848E9C` |
| 边框 | `rgba(255,255,255,0.08)` |
| 涨（绿） | `#26A17B` |
| 跌（红） | `#E84C3D` |
| 图表线 | `#26A17B` |
| 图表填充 | `rgba(38, 161, 123, 0.12)` |

### 6.2 字体（中文友好字体栈）

```css
font-family: 'Inter', 'PingFang SC', 'Microsoft YaHei',
             'Noto Sans SC', system-ui, -apple-system, sans-serif;
font-variant-numeric: tabular-nums;
```

**说明**：
- Inter 负责英文字符（品牌名、数字、技术文案）
- PingFang SC 是 Mac 默认中文字体
- Microsoft YaHei 是 Windows 默认
- Noto Sans SC 兜底
- 数字等宽避免跳动

### 6.3 圆角与间距

- 卡片 `12px`
- 按钮 `8px`
- 主内容最大宽度 `1100px` 居中
- 左右留白：mobile `16px` / desktop `24px`

### 6.4 响应式

- 桌面优先
- `< 768px`：统计 4 列 → 2 列；Header 导航折叠汉堡；CTA 按钮堆叠

### 6.5 中文文案规范

| 英文原文 | 中文 |
|---|---|
| Home | 首页 |
| Chart | 图表 |
| Strategies | 策略 |
| Backtest | 回测 |
| Login / Sign up | 登录 / 注册 |
| Open full chart | 打开完整图表 |
| Run a strategy | 运行策略 |
| 24h high / low | 24h 最高 / 最低 |
| 24h volume | 24h 成交额 |
| Market cap | 市值 |
| Latest BTC news | BTC 最新资讯 |
| Coming in Phase X | 敬请期待 Phase X |
| 7 days ago / Today | 7 天前 / 今天 |

**禁用词**（踩金商法投資助言業红线）：
- ❌ 推荐、建议买入、必涨、稳赚、荐币、跟单
- ✅ 查看、测试、分析、模拟、回测

---

## 7. 代码质量要求

- TypeScript 严格模式，禁止大量 `any`
- 数字格式化统一用 `lib/format.ts`（`formatUsd`、`formatPercent`、`formatVolume`、`formatRelativeTimeCN`）
- 相对时间中文化：`刚刚` / `X 分钟前` / `X 小时前` / `昨天` / `X 天前` / `X 周前`（超过 30 天显示完整日期 `2026-04-24`）
- API 路由 try/catch，失败返回合理 fallback
- 外部 URL 集中在 `lib/okx.ts` 和 `lib/news.ts`
- 展示文案避免投資助言暗示性用语

---

## 8. 不要做的事

- ❌ 不做其他币种
- ❌ 不做登录逻辑（Phase 1 只放按钮）
- ❌ 不用 WebSocket
- ❌ 不搭数据库
- ❌ 不搭 i18n 框架
- ❌ 不写单元测试
- ❌ 不做自定义指标
- ❌ 不做回测
- ❌ 不引入状态管理库
- ❌ 不做 PWA
- ❌ 不配 Docker
- ❌ 不接 Stripe / Supabase（Phase 2+ 才接）
- ❌ 不封 IP，不做地理限制检测
- ❌ 不接入人民币支付（未来收费也只 Stripe 国际卡）

---

## 9. 部署

### 本地开发
```bash
npm install
npm run dev
```

### Vercel 部署
```bash
# CLI 方式
npm i -g vercel
vercel

# 或 GitHub 连接 Vercel 自动部署
```

### 环境变量（`.env.example`）
```env
# Phase 1 不需要任何环境变量

# Phase 2.1 will add:
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_ROLE_KEY=

# Phase 4 will add:
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=

# Optional:
# CRYPTOPANIC_TOKEN=
```

---

## 10. 验收标准

- [ ] `npm install && npm run dev` 无报错
- [ ] 主页按规格呈现
- [ ] 价格是 OKX 实时真实数据
- [ ] 24h 涨跌幅颜色正确
- [ ] 7 日折线图真实数据
- [ ] 新闻 6+ 条真实条目
- [ ] Header 登录按钮跳 `/login` 占位页
- [ ] 所有占位页可访问，文案中文
- [ ] Footer 免责声明文案准确
- [ ] 手机宽度布局不错乱
- [ ] 30 秒自动刷新
- [ ] **全站 UI 中文**（除 BTC 新闻原文和品牌名）
- [ ] 中文字体显示正确（Mac Safari / Chrome、Windows Chrome / Edge 都测过）
- [ ] 相对时间中文化（"2 小时前"而非"2h ago"）
- [ ] 部署到 Vercel 拿到公开 URL

---

## 11. Phase 1 已完成状态（截止 2026-04-24）

- ✅ 本地功能全部完成
- ✅ OKX 实时数据正常
- ✅ CoinDesk 新闻正常
- ⚠️ 未完成：部署到 Vercel（用户决定延后）
- ⚠️ 待订正：部分英文文案需中文化（`Home`/`Chart` 等导航文字、`7 days ago`、`Coming in Phase X` 等）

---

## 附录 A：Phase 1 v1.2 订正给 Claude Code 的指令

```
BTC Station Phase 1 已经跑起来了（OKX 数据 + 新闻都真实），但有两处需要订正：

1. 文档上写的是 Binance，实际用的是 OKX。请同步更新所有注释、README、
   变量名到 OKX，对应 lib/ 目录重组为 lib/exchange.ts (抽象) + lib/okx.ts (实现)

2. 产品面向华语用户，需要把所有 UI 文字中文化。
   参考《BTC Station Phase 1 指令书 v1.2》第 6.5 节文案对照表。

不要改：
- 业务逻辑
- 数据源
- 布局结构
- 色彩

只改：
- 注释、文档
- UI 显示文字（按钮标签、导航、占位页说明）
- 字体栈（加中文字体）
- 相对时间格式化（中文化）

做完后本地验证清单见第 10 节验收标准。
```

---

**版本历史**
- v1.0 — 定位为本地个人工具
- v1.1 — 改为面向社群 SaaS
- **v1.2（当前）** — 确立 OKX 为数据源、全中文化、面向华语用户
