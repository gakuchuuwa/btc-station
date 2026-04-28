# BTC Station — 项目指令书 (Phase 1, v1.1)

> 本文件是写给 AI 编码助手（如 Claude Code）的项目规格。请严格按照本文件要求搭建项目。遇到未明确的细节按"常规最佳实践"处理，但**不要扩大 Phase 1 的范围**。
>
> **v1.1 相比 v1.0 的变化**：项目定位从"本地个人工具"改为"面向社群用户的轻量 SaaS"。Phase 1 仍然不接数据库和登录逻辑，但要**预埋架构**（部署到 Vercel、预留登录入口、明确 Phase 2 技术选型）。

---

## 0. 项目概览

**BTC Station** 是一个**只关注比特币（BTC）的轻量级量化交易平台**，定位是"专注 BTC 的 TradingView 精简版 + 强化的参数优化能力"，面向几十到几百个社群用户。

**服务定位（非常重要，代码与文案都要体现）**：本平台是**交易工具**（tool），不是**投资顾问服务**（advisory）。所有策略由用户自行编写、自行选择、自行承担盈亏。平台不主动推送交易信号、不代客理财、不托管用户资金。

**商业模式（决定 Phase 2+ 架构，Phase 1 需预留接口）**：
- **Freemium**：基础功能免费（查看行情、图表、基础回测、模拟盘），高级功能订阅付费（参数优化、无限回测、无限策略保存）
- **BYOK（Bring Your Own Key）**：AI 分析功能由用户自备 Claude / OpenAI API Key，平台不代付 AI 费用

**长期愿景（Phase 1 不实现，但架构要对得上）**：
1. Phase 1：主页 + 资讯 + 简易图表（公开）
2. Phase 2：登录系统 + 完整图表页 + 保存策略
3. Phase 3：回测引擎
4. Phase 4：参数优化（Pro 付费）+ Stripe 订阅
5. Phase 5：AI 分析（BYOK）
6. Phase 6：模拟盘
7. Phase 7：真实交易所对接（可选，API Key 仅存浏览器本地）

---

## 1. 基本约束（务必遵守）

| 项目 | 规则 |
|---|---|
| 币种 | **只做 BTC**。不添加 ETH / 其他币种 |
| 用户系统 | **Phase 1 不实现登录逻辑**，但 Header 必须有"登录 / 注册"按钮，点击跳到 `/login` 占位页 |
| 数据库 | Phase 1 不接数据库。但 README 中要注明 Phase 2 使用 **Supabase** |
| 部署 | **必须部署到 Vercel**，拿到公开 URL（免费额度够用） |
| 实时性 | **不要用 WebSocket**，用 HTTP 轮询（30 秒） |
| 图表库 | TradingView **Lightweight Charts**（免费开源），**不要**用 Advanced Charts |
| 国际化 | 中文 UI 为主，不搭 i18n 框架 |
| 文案基调 | 强调"工具"属性，**避免**使用"推荐""建议买入""跟单"等词，防止踩金融商品取引法的投資助言業红线 |

---

## 2. 技术栈（硬性要求）

**Phase 1 实际使用**：
```
- Next.js 14 或 15（App Router）
- TypeScript（严格模式）
- Tailwind CSS
- lightweight-charts（npm）
- Node.js 18+
- 部署到 Vercel
```

**Phase 2+ 已锁定（Phase 1 只需在 README 标注，不引入）**：
```
- Supabase（Auth + Postgres + Storage 一体）
- Stripe（订阅付费，Phase 4）
- Python + FastAPI + vectorbt（回测引擎，Phase 3 作为独立后端）
```

**禁止引入**：Redux / Zustand / MobX；任何 CSS-in-JS 库；shadcn/ui 之外的 UI 库。

**允许引入**：shadcn/ui（按需复制组件）、lucide-react（图标）、date-fns（日期）。

---

## 3. 目录结构

```
btc-station/
├── app/
│   ├── layout.tsx              # 全局布局（Header + Footer）
│   ├── page.tsx                # 主页
│   ├── globals.css
│   ├── login/
│   │   └── page.tsx            # 占位页：Phase 2 实现
│   ├── chart/
│   │   └── page.tsx            # 占位页：Phase 2 实现（标"免费"）
│   ├── strategies/
│   │   └── page.tsx            # 占位页：Phase 2+ 实现（标"免费 + Pro"）
│   ├── backtest/
│   │   └── page.tsx            # 占位页：Phase 3 实现（标"免费 + Pro"）
│   ├── terms/
│   │   └── page.tsx            # 利用規約占位（"即将推出"）
│   ├── privacy/
│   │   └── page.tsx            # プライバシーポリシー占位
│   └── api/
│       ├── btc/
│       │   ├── summary/route.ts
│       │   └── klines/route.ts
│       └── news/route.ts
├── components/
│   ├── Header.tsx              # 顶部导航（含登录/注册按钮）
│   ├── Footer.tsx              # 页脚（含免责声明 + 利用規約链接）
│   ├── PriceCard.tsx
│   ├── MiniChart.tsx
│   ├── StatsGrid.tsx
│   └── NewsFeed.tsx
├── lib/
│   ├── binance.ts
│   ├── news.ts
│   └── format.ts               # 数字/日期格式化工具
├── types/
│   └── btc.ts
├── .env.example                # 示例环境变量（空）
├── package.json
├── tailwind.config.ts
├── tsconfig.json
├── next.config.js
├── vercel.json                 # Vercel 部署配置（如需要）
└── README.md
```

---

## 4. Phase 1 必须完成的功能

### 4.1 主页 `/`

自上而下：

1. **Header**（所有页面共用）
   - 左：`₿ BTC Station` 标题
   - 中：4 个导航 — Home / Chart / Strategies / Backtest（当前页高亮）
   - 右：**"登录 / 注册"** 按钮（次要样式，点击跳 `/login`）

2. **大价格卡**
   - 左上：`BTC / USDT` 小字标题
   - 左下：当前价（大字，千位分隔，`$94,382.50` 格式）
   - 右上：24h 涨跌幅徽章（涨绿跌红 + 箭头）
   - 中部：**7 日收盘价折线图**（area chart，无坐标轴）
   - 底部两行小字："7 days ago" 和 "Today"

3. **统计网格（4 列）**：24h High / 24h Low / 24h Volume / Market Cap

4. **新闻列表**：6–8 条 BTC 相关新闻，每条含标题 + 来源 + 相对时间。点击跳原文（新窗口）。

5. **CTA 行**
   - 主按钮 "Open full chart →" → `/chart`
   - 次按钮 "Run a strategy" → `/strategies`（若未登录可显示"需要登录"提示，Phase 1 直接跳占位页即可）

6. **Footer**（所有页面共用）
   - 左：`© 2026 BTC Station`
   - 中：小字免责声明 — **"本服务仅为交易分析工具，不构成投资建议。所有交易盈亏由用户自行承担。"**
   - 右：利用規約 / プライバシーポリシー 链接

### 4.2 占位页

每个占位页都显示：
- Header + Footer（同主页）
- 居中大字 "Coming in Phase X"
- 一句话说明（例如 `/login` 的占位："Phase 2：用户系统即将上线，届时可保存策略与回测结果"）
- 对应 Phase 和是否 Pro 功能的小标签（如 `/backtest` 标注"免费 + Pro"）

`/terms` 和 `/privacy` 占位文案：`"利用規約将在正式上线前发布。"`

### 4.3 数据刷新

- 主页价格/统计：每 30 秒轮询
- 新闻：每 5 分钟轮询或仅页面加载时刷
- 手动刷新页面也能用

---

## 5. 数据源规格

### 5.1 Binance 公共 API（无需 Key）

基础 URL：`https://api.binance.com`

**当前价 + 24h 统计**
```
GET /api/v3/ticker/24hr?symbol=BTCUSDT
```
用：`lastPrice`, `priceChangePercent`, `highPrice`, `lowPrice`, `quoteVolume`

**K 线**
```
GET /api/v3/klines?symbol=BTCUSDT&interval=1d&limit=7
```
返回二维数组 `[openTime, open, high, low, close, volume, closeTime, ...]`

**市值（Binance 不提供，用 CoinGecko）**
```
GET https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_market_cap=true
```

### 5.2 新闻源

**首选：CoinDesk RSS**（无需 Key）
```
https://www.coindesk.com/arc/outboundfeeds/rss/
```
用 `fast-xml-parser` 解析，过滤标题含 "bitcoin" / "BTC" 的条目。

**备选：CryptoPanic**（需要免费 Key，存 `.env.local`）

Phase 1 用 CoinDesk RSS 即可。

### 5.3 Next.js API 路由封装

所有外部 API 通过 Next.js API 路由代理，**前端不直接 fetch Binance / CoinGecko / CoinDesk**。

```
GET /api/btc/summary
→ { price, change24h, high24h, low24h, volume24h, marketCap }

GET /api/btc/klines?interval=1d&limit=7
→ { time, open, high, low, close, volume }[]

GET /api/news
→ { title, url, source, publishedAt }[]
```

**服务端缓存**（Vercel 的 `revalidate` 或 in-memory）：
- summary：10 秒
- klines：60 秒
- news：300 秒

注意：Vercel Serverless Functions 的 in-memory 缓存只在同一个 cold instance 内有效，跨请求不保证命中。Phase 1 能用就行，Phase 2 再引入 Redis 或 Supabase 做持久缓存。

---

## 6. 设计规范

### 6.1 色彩（深色主题默认，Phase 1 硬编码深色即可）

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
| 登录按钮（次要） | 边框 `rgba(255,255,255,0.2)`、透明底、hover 浅色底 |

### 6.2 字体
- `'Inter', system-ui, -apple-system, sans-serif`
- 数字 `font-variant-numeric: tabular-nums`

### 6.3 圆角与间距
- 卡片 `12px`
- 按钮 `8px`
- 主内容区最大宽度 `1100px` 居中
- 左右留白：mobile 16px / desktop 24px

### 6.4 响应式
- 桌面优先
- `< 768px`：统计网格 4 列 → 2 列；Header 导航折叠成汉堡菜单；CTA 按钮堆叠

---

## 7. 代码质量要求

- 所有组件 TypeScript + 显式类型（禁止大量 `any`）
- 数字显示统一用 `lib/format.ts`（`formatUsd`、`formatPercent`、`formatVolume`、`formatRelativeTime`）
- API 路由要 try/catch，失败返回合理 fallback 而不是白屏
- 外部 URL 集中在 `lib/binance.ts` 和 `lib/news.ts`
- 所有展示文案**避免**"推荐""建议买入""必涨"等词，改用"查看""测试""分析"

---

## 8. 不要做的事

- ❌ 不要添加其他币种
- ❌ 不要实现登录逻辑（Phase 1 只放按钮）
- ❌ 不要用 WebSocket
- ❌ 不要搭数据库
- ❌ 不要做 i18n
- ❌ 不要写单元测试
- ❌ 不要做自定义 K 线指标
- ❌ 不要做回测
- ❌ 不要引入 Redux / Zustand
- ❌ 不要做 PWA / 离线
- ❌ 不要配置 Docker
- ❌ 不要接 Stripe / Supabase（Phase 2+ 才接）

---

## 9. 部署与运行

### 9.1 本地开发
```bash
npm install
npm run dev
# 浏览器打开 http://localhost:3000
```

### 9.2 部署到 Vercel
```bash
# 方式一：Vercel CLI
npm i -g vercel
vercel

# 方式二：GitHub 连接
# 1. 把代码 push 到 GitHub
# 2. Vercel 网页端 Import Project，选仓库
# 3. 环境变量留空（Phase 1 不需要）
```

### 9.3 环境变量（`.env.example` 预留占位，Phase 2+ 用）
```env
# Phase 1 不需要任何环境变量，但请预留文件结构：

# Phase 2 will add:
# NEXT_PUBLIC_SUPABASE_URL=
# NEXT_PUBLIC_SUPABASE_ANON_KEY=
# SUPABASE_SERVICE_ROLE_KEY=

# Phase 4 will add:
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=

# Phase 5 (optional, backup):
# CRYPTOPANIC_TOKEN=
```

---

## 10. 验收标准

- [ ] `npm install && npm run dev` 一次性能跑起来，无报错
- [ ] `http://localhost:3000` 主页按规格呈现
- [ ] 价格是**真实 BTC 实时价**，不是假数据
- [ ] 24h 涨跌幅颜色正确
- [ ] 7 日折线图显示真实 7 天收盘价
- [ ] 新闻列表有 6+ 条 BTC 真实新闻，点击跳原文
- [ ] Header 登录按钮存在且点击跳 `/login` 占位页
- [ ] 所有占位页（login / chart / strategies / backtest / terms / privacy）都能正常访问
- [ ] Footer 免责声明文案准确（"仅为交易分析工具，不构成投资建议"）
- [ ] 手机宽度下布局不错乱
- [ ] 30 秒后价格自动刷新
- [ ] **成功部署到 Vercel**，拿到类似 `btc-station.vercel.app` 的公开 URL
- [ ] Vercel 部署的页面行为与本地一致
- [ ] 所有 API 路由返回 JSON 结构符合第 5.3 节规格

---

## 11. 后续阶段规划（Phase 1 不做，但架构要兼容）

| Phase | 内容 | 关键技术 | 付费层级 |
|---|---|---|---|
| **2** | Supabase Auth 接入、完整 TV 风格图表页（多周期、内置指标、画线） | Supabase、lightweight-charts 进阶用法 | 免费 |
| **3** | 策略系统 + 回测引擎（Python + FastAPI + vectorbt，独立服务） | FastAPI、vectorbt、Celery | 免费（有限次数） + Pro（无限） |
| **4** | 参数优化 + 热力图 + CSV 导出 + **Stripe 订阅** 上线 | vectorbt 批量回测、Stripe Checkout | **Pro 核心功能** |
| **5** | AI 分析（策略逻辑解读 / 参数建议 / 回测报告总结）**BYOK** | Claude / OpenAI API，用户自填 Key | 免费（用户付 AI 费） |
| **6** | 模拟盘（真实行情 + 虚拟资金） | Binance 行情 + 本地账本 | 免费 |
| **7** | 真实交易所对接（可选功能）API Key **仅存浏览器 localStorage** | Binance / OKX 现货 API | 免费（但用户自担风险） |

**架构兼容性要求**（Phase 1 要做的铺垫）：
- API 路由层要易于改造成**代理层**（Phase 3 时转发到 Python 后端）
- 组件解耦要好（`MiniChart` 将来能平滑替换为完整 `TradingViewChart`）
- `lib/` 下的数据封装要预留"从缓存/DB 读取"的入口（Phase 2 接 Supabase 时不用大改）
- 文案层明确区分"免费"和"Pro"标签（占位页已体现）

---

## 附录 A：给 Claude Code 的第一条指令（复制粘贴用）

```
我要搭一个叫 BTC Station 的 BTC 量化交易平台（轻量 SaaS，面向几十到几百社群用户）。

请严格按《BTC Station 项目指令书 Phase 1 v1.1》搭建。
指令书文件：[把本 md 拖进会话]

请你：
1. 先完整读完指令书
2. 列出你准备创建的文件清单给我确认
3. 我确认后，一次性搭好脚手架 + 所有页面 + 组件 + API 路由
4. 告诉我：
   (a) 本地怎么跑
   (b) 如何一步步部署到 Vercel
5. 验收标准在指令书第 10 节，做完自查一遍

要求：
- 严格遵守第 1 节"基本约束"和第 8 节"不要做的事"
- 不要问我色号、字号这类已在指令书定好的问题
- 不要擅自加登录、数据库、多币种、Stripe、Supabase（Phase 2+ 才用）
- 文案要避免"推荐""建议买入"等投資助言暗示性用语
- 如果觉得指令书哪里不合理，先跟我讨论再改，不要自作主张

准备好了告诉我。
```

---

## 附录 B：你（用户）的工作流

1. **装 Claude Code**
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **`cd` 到你想放项目的目录**（比如桌面的 `BTC Tradingview assistant` 文件夹）

3. **启动 Claude Code**：终端输入 `claude`

4. **粘贴附录 A 的指令**，把本 md 文件拖进会话

5. **让 Claude Code 跑完**，按它提示的命令启动

6. **本地打开 `localhost:3000`** 验证

7. **部署到 Vercel**
   - 注册 Vercel（GitHub 登录最方便）
   - 把项目 push 到 GitHub
   - Vercel 页面 Import，一键部署
   - 拿到公开 URL，分享给几个朋友试试第一反应

8. **迭代**：看哪里不满意，跟 Claude Code 说"把 XX 改成 YY"

9. **完成 Phase 1 后**回来找我，我们写 Phase 2 指令书（登录 + 完整图表页）

---

## 附录 C：给用户的合规提醒（非法律建议）

你在日本（千叶浦安），做 SaaS 给日本用户提供，以下几点做起来前需要你自己或通过行政書士/弁護士确认：

1. **平台定位**：全站文案、TOS、宣传材料都要明确 "交易分析工具" 而非 "投資助言"、"荐股/荐币服务"。涉嫌投資助言業可能需要 **金融商品取引法 投資助言業登録**

2. **用户资金**：任何阶段都**不托管用户资金**、不替用户下单（Phase 7 也只做"用户在自己浏览器内用自己的 Key 下单"模式）

3. **上线收费必备文件**：
   - 利用規約（TOS）
   - プライバシーポリシー（PIPA / GDPR 友好版）
   - 特定商取引法に基づく表記（日本要求的商户信息披露）
   - 免責事項（明确"本服务仅为工具，不构成投资建议，盈亏自负"）

4. **Stripe 日本**：Stripe 支持日本，用 Stripe Japan 账户即可，JCB / Konbini 支付可以后加

---

**版本历史**
- v1.0 — 定位为本地个人工具
- **v1.1（当前）** — 改为面向社群的轻量 SaaS，Freemium + BYOK，预埋 Supabase / Vercel / Stripe 选型
