# BTC Station — Phase 2.1 策划文档

> 本文档是 **产品 + 技术架构** 策划，不涉及视觉设计。
>
> **工作流**：本文档 → Claude Design（读本文 + Phase 1 codebase，产出视觉）→ Claude Code（实现）
>
> **Phase 2.1 目标**：上线公开可访问的完整图表页 + 用户系统基础设施（为 Phase 3+ 做准备）。

---

## 0. Phase 2.1 范围（一句话）

**公开的完整 BTC 图表页（多周期 + 3 个核心指标） + 登录系统上线（但本阶段尚未有付费功能，登录只是铺路）。**

---

## 1. 本阶段与 Phase 1 的关系

### 1.1 Phase 1 继承不变的部分

- 技术栈：Next.js + TypeScript + Tailwind + lightweight-charts
- 设计系统：深色主题、色彩规范、字体、圆角（Claude Design 会读 Phase 1 codebase 自动继承）
- 主页 `/`：完全不动
- Footer 免责声明：不动
- 新闻 API、主页数据 API：不动

### 1.2 Phase 2.1 新增

- **Supabase 接入**（Auth + Postgres）
- **完整图表页 `/chart`**（从占位页升级）
- **真正的登录/注册页**（从占位页升级）
- **用户下拉菜单**（Header 的"登录/注册"按钮改成已登录状态的头像/菜单）
- **账户设置页 `/account`**（新）
- **保护路由中间件**（Phase 2.1 本身没有需要保护的页面，但为 Phase 3 预埋）

### 1.3 明确延后到 Phase 2.2 的部分

- 更多指标（EMA、Bollinger、Stochastic、ATR、成交量均线等）
- 画线工具（趋势线、水平线、矩形、斐波那契）
- 多图表分屏
- 指标参数自定义 UI（Phase 2.1 硬编码参数）

---

## 2. 核心架构决策（含理由）

这些决策会影响到 Phase 7，现在定好避免返工。

### 2.1 交易所 API：标准化为 **OKX**

**背景**：Phase 1 指令书写的是 Binance，但实际 Claude Code 实现用了 OKX。这很合理——**日本用户访问 Binance 有 IP 限制和合规风险，OKX 更稳定**。

**决定**：**全项目标准化为 OKX 公共 API**。
- 行情：`https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT`
- K 线：`https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar={timeframe}`
- 所有环境变量统一为 `OKX_*` 前缀

**理由**：
- 日本合规友好
- 无 IP 限制
- 免费、无需 API Key（公开数据）
- 数据质量与 Binance 相当

**风险缓解**：在 `lib/exchange.ts` 抽象一层接口，未来想切换交易所只需改一个文件。

### 2.2 认证提供商：**Supabase**

**选 Supabase 的理由**：
- Auth + Postgres + Storage 一体，不用拼三个服务
- 免费额度慷慨：50k 月活用户 + 500MB 数据库（够你用 2-3 年）
- Row Level Security（RLS）内置——行级权限策略，天然支持"用户只能看自己的数据"
- 对 Next.js App Router 有官方 SSR 适配包 `@supabase/ssr`
- Google OAuth 一键配置

**不选的替代方案**：
- NextAuth：免费但要自己搭 Postgres
- Clerk：体验好但免费额度只够 5k 月活，付费贵
- Firebase：生态好但 NoSQL 对量化数据不友好

### 2.3 Session 管理：**Supabase SSR（Server-Side Rendering Cookie）**

使用 `@supabase/ssr` 包，session 存在 HTTP-only cookie 里，服务端渲染能读到用户状态。**不用** JWT localStorage（XSS 风险）。

### 2.4 指标计算：**客户端（浏览器内）**

**Phase 2.1 的 3 个指标（MA/RSI/MACD）全部在浏览器内计算**。

**理由**：
- Phase 2.1 展示用，不是回测，不需要服务端算力
- 用 `technicalindicators` npm 包（或者直接手写，这几个公式很简单）
- 用户切换时间周期时，新数据到了立刻算，体验快
- 服务器零负担

**Phase 3 的回测会用 Python + vectorbt 做服务端计算**，但那是另一套系统，不影响这里的选择。

### 2.5 图表数据策略

| 时间周期 | 默认加载历史长度 | 缓存时长 |
|---|---|---|
| 1m | 500 根（约 8 小时） | 60 秒 |
| 5m | 500 根（约 1.7 天） | 300 秒 |
| 15m | 500 根（约 5 天） | 600 秒 |
| 1h | 500 根（约 3 周） | 600 秒 |
| 4h | 500 根（约 3 个月） | 1800 秒 |
| 1d | 500 根（约 1.4 年） | 3600 秒 |
| 1w | 全历史（约 13 年） | 3600 秒 |

**"500 根默认 + 向左滚动加载更多"** 是 TV 的做法，够用。

缓存放在 Next.js API 路由的 in-memory（Vercel serverless 冷启动会丢，Phase 3 引入 Supabase 做持久缓存）。

### 2.6 保护路由策略

**Phase 2.1 的实际保护清单**：
- `/account` — 需登录
- `/chart` — **公开访问**（按最初商业计划，图表免费）
- `/strategies`、`/backtest` — Phase 2.1 仍是占位页，但**已加登录守卫**（为 Phase 3 做准备）
- 未登录用户访问 `/strategies` → 跳 `/login?next=/strategies`，登录后回来

实现方式：Next.js `middleware.ts` + Supabase SSR，在请求进入前判断 session。

### 2.7 用户偏好存储策略

| 偏好项 | 未登录用户 | 登录用户 |
|---|---|---|
| 默认时间周期 | localStorage | Supabase + localStorage 缓存 |
| 开启的指标 | localStorage | Supabase + localStorage 缓存 |
| 主题 | localStorage | Supabase + localStorage 缓存 |

**同步策略**：登录时，Supabase 数据 覆盖 localStorage；未登录时修改，只存 localStorage；登录后第一次修改偏好，会把 localStorage 内容上传到 Supabase。

---

## 3. 数据库 Schema 设计（Supabase Postgres）

**⚠️ 非常重要**：Phase 2.1 **现在就把所有 Phase 2-7 需要的表都建好**，避免后面反复改 schema。只要在 Phase 2.1 阶段不往里写数据就行。

### 3.1 `profiles` 表（用户资料）

由 Supabase `auth.users` 自动触发创建（用 database trigger）。

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  avatar_url text,

  -- 付费相关（Phase 4 启用，现在都默认 free）
  plan text not null default 'free' check (plan in ('free', 'pro')),
  plan_expires_at timestamptz,
  stripe_customer_id text,

  -- AI BYOK（Phase 5 启用）
  ai_provider text check (ai_provider in ('claude', 'openai')),
  ai_key_encrypted text,  -- 加密后存储

  -- 元数据
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: 用户只能看/改自己的 profile
alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
```

### 3.2 `user_preferences` 表（偏好设置）

```sql
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- 用 JSONB 给未来扩展留空间，不用每次加字段
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 示例 preferences 结构（应用层约定，DB 不强校验）：
-- {
--   "default_timeframe": "1h",
--   "indicators": {
--     "ma": { "enabled": true, "periods": [20, 50] },
--     "rsi": { "enabled": false, "period": 14 },
--     "macd": { "enabled": false }
--   },
--   "theme": "dark"
-- }

alter table user_preferences enable row level security;
create policy "Users can manage own preferences" on user_preferences for all using (auth.uid() = user_id);
```

### 3.3 `strategies` 表（Phase 3 启用，Phase 2.1 建表但不用）

```sql
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  -- 策略代码（Phase 3 决定用什么语言——暂定受限 JavaScript DSL）
  code text not null,
  -- 策略参数（可被参数优化覆盖）
  params jsonb not null default '{}'::jsonb,
  -- 是否公开（未来可能做策略分享）
  is_public boolean not null default false,
  -- 元数据
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_strategies_user on strategies(user_id);
alter table strategies enable row level security;
create policy "Users can manage own strategies" on strategies for all using (auth.uid() = user_id);
create policy "Anyone can view public strategies" on strategies for select using (is_public = true);
```

### 3.4 `backtests` 表（Phase 3 启用）

```sql
create table public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  -- 回测配置快照
  config jsonb not null,
  -- 回测结果（夏普比、回撤、胜率、总收益等）
  metrics jsonb not null,
  -- 交易记录
  trades jsonb,
  -- 时间段
  start_date timestamptz not null,
  end_date timestamptz not null,
  -- 状态
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_backtests_user on backtests(user_id);
create index idx_backtests_strategy on backtests(strategy_id);
alter table backtests enable row level security;
create policy "Users can manage own backtests" on backtests for all using (auth.uid() = user_id);
```

### 3.5 `parameter_optimizations` 表（Phase 4 启用，Pro 功能）

```sql
create table public.parameter_optimizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  -- 参数扫描配置（每个参数的 [start, end, step]）
  param_ranges jsonb not null,
  -- 扫描结果 CSV（存 Supabase Storage 的路径）
  results_csv_path text,
  -- 最优参数组
  best_params jsonb,
  best_metrics jsonb,
  -- 状态
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  total_combinations integer,
  completed_combinations integer default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_opt_user on parameter_optimizations(user_id);
alter table parameter_optimizations enable row level security;
create policy "Users can manage own optimizations" on parameter_optimizations for all using (auth.uid() = user_id);
```

### 3.6 触发器：新用户自动建 profile

```sql
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  insert into public.user_preferences (user_id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## 4. Phase 2.1 功能详细规格

### 4.1 完整图表页 `/chart`（公开访问）

#### 页面结构（自上而下）

1. **顶部工具栏**（固定）
   - 左侧：`BTC/USDT` 标签 + 当前价 + 24h 涨跌幅
   - 中间：**时间周期选择器**（1m / 5m / 15m / 1h / 4h / 1D / 1W）
   - 右侧：**指标按钮**（点开弹出面板，可勾选 MA / RSI / MACD）

2. **主图表区**（占页面 60%）
   - K 线（candlestick），涨绿跌红
   - MA 指标叠加在主图上（若启用）
   - 十字光标：鼠标悬停显示该 K 线的 OHLC + 时间

3. **成交量子图**（占 15%）
   - 成交量柱状图，颜色跟随 K 线涨跌
   - 始终显示（不算在"3 个指标"里，是标配）

4. **RSI 子图**（占 12%，若启用）
   - 0-100 范围，30/70 水平线标注超买超卖
   - 右侧显示当前 RSI 值

5. **MACD 子图**（占 12%，若启用）
   - DIF / DEA 两条线 + 柱状图
   - 右侧显示当前三个值

#### 默认参数（Phase 2.1 硬编码，Phase 2.2 可自定义）

- MA：20 和 50 两条均线
- RSI：周期 14
- MACD：(12, 26, 9)

#### 交互行为

- 切换时间周期：立即重新拉数据，图表重绘
- 鼠标滚轮：缩放时间范围
- 拖拽图表：平移
- 向左滚到头：自动加载更多历史数据
- 开关指标：即时显示/隐藏子图（不重新拉数据）
- 登录用户：切换周期/指标时，自动保存为偏好（debounce 2s）
- 未登录用户：保存到 localStorage

#### 数据更新

- 当前周期的"最后一根 K 线" 每 10 秒轮询更新（模拟实时）
- 历史 K 线不变，不需要反复拉

### 4.2 用户认证系统

#### 4.2.1 注册流程

**页面 `/signup`**：
- 字段：邮箱、密码（最少 8 位）、确认密码
- 下方：Google OAuth 按钮
- 下方：服务条款 / 隐私政策 同意勾选框（默认不勾，必须勾才能注册）
- 底部：已有账号？→ `/login`

**邮箱注册**：
- 提交后发验证邮件（Supabase 内置）
- 提示 "请检查邮箱完成验证"
- 验证后自动登录并跳 `/`

**Google OAuth**：
- 一键跳 Google 授权
- 授权后回调到 `/auth/callback`
- 自动建 profile（通过 trigger），自动登录
- 跳 `/`

#### 4.2.2 登录流程

**页面 `/login`**：
- 字段：邮箱、密码
- 下方：Google 登录按钮
- 底部：忘记密码？→ `/forgot-password`
- 底部：没有账号？→ `/signup`

登录成功 → 跳 `/`（或 `?next=` 参数指定的页面）

#### 4.2.3 忘记密码流程

**页面 `/forgot-password`**：
- 填邮箱 → Supabase 发重置链接
- 链接点进来 → `/reset-password` 填新密码
- 重置后跳 `/login`

#### 4.2.4 登出

- Header 右上头像菜单 → 登出
- 清除 session → 跳 `/`

#### 4.2.5 Header 动态状态

**未登录**：
- 右上显示"登录"和"注册"两个按钮

**已登录**：
- 右上显示头像（有就用 Google 头像，没就用首字母）
- 点击下拉菜单：
  - 用户名（上面 email）
  - `Account settings` → `/account`
  - `My strategies` → `/strategies`（Phase 3 启用）
  - 分隔线
  - `Sign out`

### 4.3 账户设置页 `/account`

**分三个 tab**：

#### Tab 1: Profile
- 头像（可上传，存 Supabase Storage）
- Display name（可改）
- Email（只读，显示验证状态）
- 注册时间（只读）

#### Tab 2: Preferences
- 默认时间周期（下拉选择）
- 默认启用的指标（checkbox 组）
- 主题：Dark / Light（Phase 2.1 Dark only，Light 灰置不可选，预留）

#### Tab 3: Security
- 修改密码（仅邮箱注册用户可见，Google 用户隐藏）
- 删除账号（二次确认，Phase 2.1 可占位）

#### 未启用的 tab（留位不显示）
- Subscription（Phase 4）
- AI Keys（Phase 5）
- Exchange Connections（Phase 7）

---

## 5. API 路由变更

### 5.1 Phase 1 保留

- `GET /api/btc/summary` — 不变
- `GET /api/btc/klines` — 不变（主页用）
- `GET /api/news` — 不变

### 5.2 Phase 2.1 新增

```
GET /api/chart/klines?interval={tf}&limit={n}&before={ts}
  - 参数：interval (1m/5m/15m/1h/4h/1d/1w), limit (默认500), before (分页游标)
  - 返回：{ candles: [{time, open, high, low, close, volume}], hasMore }
  - 缓存时长见 2.5 节

GET /api/chart/ticker
  - 返回当前价 + 最后一根未完成 K 线（用于实时更新）
  - 缓存 5 秒

POST /api/preferences (需登录)
  - Body: { preferences: {...} }
  - 写 Supabase user_preferences
  - 返回更新后完整偏好

GET /api/preferences (需登录)
  - 返回当前用户偏好
```

### 5.3 Supabase Auth 相关

**不需要自己写 API 路由**，用 Supabase 客户端 SDK 直接处理（`signInWithPassword`、`signInWithOAuth`、`signOut` 等）。

唯一需要的是 `/auth/callback` 路由处理 OAuth 回调（`@supabase/ssr` 文档有标准模板）。

---

## 6. 速率限制与安全

### 6.1 OKX 公共 API 速率限制

OKX 公共端点：20 req/2s/IP（代理后所有用户共享服务器 IP，要小心）。

**对策**：
- 服务端缓存（见 2.5）大幅减少外部请求
- 若超限，返回缓存的旧数据而不是报错
- Vercel 部署时留意：每个 serverless instance 有独立 IP，冷启动后缓存失效可能短时间打高

### 6.2 自家 API 速率限制

Phase 2.1 暂不做用户级 rate limiting（几百用户规模用不到）。Phase 3 回测启动会加。

### 6.3 环境变量

```env
# Supabase (Phase 2.1 启用)
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...
SUPABASE_SERVICE_ROLE_KEY=ey...  # 仅服务端用

# OKX (公共 API 无需 Key，但预留)
OKX_API_BASE=https://www.okx.com

# Google OAuth (配置在 Supabase dashboard，无需环境变量)

# Phase 4+
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
```

### 6.4 安全检查清单

- [ ] Supabase Service Role Key **绝不** 出现在 `NEXT_PUBLIC_*` 变量
- [ ] 所有 DB 表启用 RLS
- [ ] Google OAuth redirect URL 在 Supabase 和 Google Console 两边都配
- [ ] Password 最少 8 位（Supabase 默认 6，提到 8）
- [ ] 邮箱注册必须验证后才能登录（Supabase 设置里打开）
- [ ] CORS：API 路由只允许同源请求

---

## 7. 本阶段不做的事（避免跑偏）

- ❌ 不做 Stripe / 付费（Phase 4）
- ❌ 不做策略系统（Phase 3）
- ❌ 不做回测（Phase 3）
- ❌ 不做 AI 分析（Phase 5）
- ❌ 不做模拟盘（Phase 6）
- ❌ 不做真实交易所对接（Phase 7）
- ❌ 不做画线工具（Phase 2.2）
- ❌ 不做除 MA/RSI/MACD 之外的指标（Phase 2.2）
- ❌ 不做多币种
- ❌ 不做多语言
- ❌ 不做推送通知
- ❌ 不做 WebSocket（用轮询）
- ❌ 不做移动端 App
- ❌ 不做支付/订阅 UI（即使占位也不放，防止用户以为要收费）

---

## 8. Phase 2.2 预告（2.1 做完后再启动）

| 功能 | 说明 |
|---|---|
| 扩充指标 | EMA、Bollinger Bands、Stochastic、ATR、OBV、Volume MA |
| 画线工具 | 趋势线、水平线、矩形、斐波那契回调、文字标注 |
| 指标参数面板 | 每个指标参数可用户自定义，存偏好 |
| 多图表分屏 | 同时看两个时间周期（1h 主图 + 15m 副图） |
| 图表截图分享 | 一键下载 PNG |

---

## 9. 验收标准

### 功能验收
- [ ] `/chart` 公开可访问（无需登录），显示完整 BTC K 线
- [ ] 7 个时间周期切换正常，数据正确
- [ ] MA/RSI/MACD 三个指标均可开关，数值计算正确（和 TV 对比误差 < 0.1%）
- [ ] 十字光标显示 OHLC，格式统一
- [ ] 向左滚动可加载更多历史
- [ ] 最后一根 K 线每 10 秒刷新
- [ ] 邮箱注册 + 验证邮件流程完整
- [ ] 邮箱登录正常
- [ ] Google OAuth 登录正常
- [ ] 忘记密码流程完整
- [ ] 已登录用户 Header 显示头像菜单
- [ ] 登出后状态清除
- [ ] `/account` 三个 tab 内容正确
- [ ] 修改偏好后刷新页面仍保留
- [ ] 未登录用户偏好存 localStorage，登录后首次变更同步到 DB

### 技术验收
- [ ] 所有 Supabase 表建好，RLS 策略生效
- [ ] 新用户注册自动创建 profile 和 preferences
- [ ] 环境变量正确分离 public/server
- [ ] middleware.ts 正确处理保护路由
- [ ] Vercel 部署成功，公开 URL 可访问
- [ ] 图表交互流畅（60fps，无明显卡顿）
- [ ] 移动端 viewport 下布局不崩

### 合规验收
- [ ] 注册必须勾选同意服务条款才能继续
- [ ] Footer 免责声明保留
- [ ] 服务条款 / 隐私政策 占位页仍在（即使内容未定稿）
- [ ] 全站无"推荐""建议买入"等投資助言语汇

---

## 10. 工作流交接

### Step 1：本文档 → Claude Design

**给 Claude Design 的指令**（供参考）：

```
我有一个 BTC 量化交易网站 BTC Station，Phase 1 已上线（主页 + 资讯 + 简易图表），
代码在我的仓库里：[仓库链接或上传 ZIP]。

请你：
1. 先读 Phase 1 的 codebase，继承其设计系统（颜色、字体、圆角、间距）
2. 读 Phase 2.1 策划文档（附件）
3. 产出以下页面的视觉设计：
   - /chart 完整图表页（重点）
   - /login 登录页
   - /signup 注册页
   - /forgot-password 忘记密码页
   - /account 账户设置页（三个 tab）
   - Header 的已登录状态（头像菜单）

视觉目标：
- 整体比一般 TradingView 更干净、更克制
- 图表页保持信息密度但不杂乱
- 保留 BTC Station 品牌感（可适度用橙色作点缀，但不铺满）

产出形式：
- 每个页面一张高保真 mockup
- 关键交互状态（hover、active、error）
- 可直接交给 Claude Code 的设计 tokens（color/spacing/shadow 变量）
```

### Step 2：策划 + 设计 → Claude Code

**给 Claude Code 的指令模板**：

```
我要为 BTC Station 做 Phase 2.1。
1. 项目现状：[Phase 1 仓库链接]
2. 策划文档：[附件：本 md 文件]
3. 视觉设计：[附件：Claude Design 输出]

请你：
1. 先完整读策划和设计
2. 列出文件变更清单给我确认
3. 按以下顺序实施：
   a. Supabase 项目搭建 + schema（第 3 节）
   b. 认证系统（第 4.2 节）
   c. 完整图表页（第 4.1 节）
   d. 账户设置页（第 4.3 节）
   e. Middleware 保护路由（第 2.6 节）
4. 每做完一步告诉我，我本地验证通过再下一步
5. 最后部署到 Vercel 验收

严禁擅自扩大范围（第 7 节）。
```

---

## 11. 你（项目负责人）的 Phase 2.1 实操清单

按顺序做：

1. **开 Supabase 账号**（免费）
   - [supabase.com](https://supabase.com) 注册 → 新建项目（Region 选 Tokyo 最近）
   - 记下 URL 和两个 Key
   - Dashboard → Authentication → Providers → 启用 Google（需要先去 Google Cloud Console 建 OAuth 凭证）

2. **把本策划文档丢给 Claude Design** → 迭代出满意的视觉

3. **把策划 + 视觉丢给 Claude Code** → 实施

4. **本地跑通**所有功能点（按第 9 节清单自测）

5. **部署到 Vercel**
   - 环境变量在 Vercel Dashboard 里配置（Supabase URL / Key）
   - Google OAuth 回调 URL 要加上你的 Vercel 域名

6. **找 2-3 个朋友测一轮**（让他们注册、登录、看图表、汇报 bug）

7. **Phase 2.1 验收通过** → 回来找我启动 Phase 2.2 或 Phase 3

---

## 12. 风险与已知问题

| 风险 | 缓解措施 |
|---|---|
| OKX API 限流 | 服务端缓存 + 失败回落到旧数据 |
| Supabase 免费额度用完 | 监控 Dashboard；几百用户远用不完 |
| Vercel serverless 冷启动慢 | 主要影响是首屏加载，用户能接受；Pro 化后可升 Vercel Pro 消除 |
| Google OAuth 审核 | 日本个人开发者可直接建，用户 < 100 时不需要 verification |
| 用户邮箱验证邮件进垃圾箱 | Supabase 默认用自己的发件域名，小概率；重要用户可手动 resend |
| 图表性能（500 根 K 线 × 3 指标子图） | lightweight-charts 官方 benchmark 可处理 1M+ candles，完全够用 |

---

**版本**：v1.0（Phase 2.1）
**下一版本**：v2.0（Phase 2.2 - 扩充指标 + 画线工具）
**更新日期**：2026-04-24
