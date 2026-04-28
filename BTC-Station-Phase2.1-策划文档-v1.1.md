# BTC Station — Phase 2.1 策划文档 (v1.1)

> **v1.1 变化**：
> 1. 全中文 UI 明确化（面向华语用户）
> 2. 登录方式确定：**邮箱 + Google**（大陆用户走邮箱）
> 3. OKX 为统一数据源
> 4. 大陆策略：**不封 IP，不主动推广**
> 5. 新增：中文邮件模板、中文字体、大陆用户友好处理

---

## 0. Phase 2.1 范围

**公开的完整 BTC 图表页（多周期 + 3 个核心指标：MA/RSI/MACD） + 登录系统基础设施。**

工作流：**本文档 → Claude Design 出视觉 → Claude Code 实施。**

---

## 1. 目标用户与定位

### 1.1 用户画像

**全球华语加密用户**，具体分布：
- 海外华人（台湾、香港、新马、北美、日本、欧洲）— **主力**
- 大陆用户（科学上网访问）— **被动接受，不主动服务**
- 非华语用户 — **不在目标范围，但不主动拒绝**

### 1.2 大陆策略细则

**不做的事**：
- 不封大陆 IP（用户能访问）
- 不检测地理位置（避免技术复杂度和误杀）
- 不做大陆推广（不投小红书、不投微博、不做备案）
- 不接人民币支付（Phase 4 收费时只接 Stripe 国际卡）
- 不接微信/QQ/微博登录（合规风险 + 加密类审核被拒）

**做的事**：
- **TOS 里明确声明**：`本服务不主动面向中国大陆居民提供。大陆用户使用本服务应自行遵守当地法律法规，相关风险由用户自行承担。`
- 登录方式保留邮箱（大陆用户 Google 不能用）
- 文案和 UI 全中文（对海外华人和大陆用户都友好）

### 1.3 语言

- **UI 全中文**（简体优先，繁体后续视用户反馈）
- **新闻原文英文保留**（CoinDesk 是英文源，翻译成本高且质量难保证）
- **相对时间、日期、数字**本地化为中文习惯
- 不搭 i18n 框架（锁定简中，避免工程复杂度）

---

## 2. 核心架构决策

### 2.1 交易所 API：**OKX**（已确立）

- 公共数据：`https://www.okx.com/api/v5/*`
- 无需 Key
- `lib/exchange.ts` 抽象 + `lib/okx.ts` 实现

### 2.2 认证：**Supabase Auth（邮箱 + Google OAuth）**

- 邮箱：全球通用底线，大陆用户唯一选项
- Google OAuth：海外华人主要方式
- **不做**：Twitter/X、Apple、微信（Phase 2.1 范围外）

### 2.3 Session：Supabase SSR Cookie

使用 `@supabase/ssr`，HTTP-only cookie，避免 XSS。

### 2.4 指标计算：客户端

Phase 2.1 的 3 个指标在浏览器内计算（用 `technicalindicators` 或手写）。

### 2.5 图表数据策略

| 周期 | 默认加载 | 缓存 |
|---|---|---|
| 1m | 500 根 | 60 秒 |
| 5m | 500 根 | 300 秒 |
| 15m | 500 根 | 600 秒 |
| 1h | 500 根 | 600 秒 |
| 4h | 500 根 | 1800 秒 |
| 1d | 500 根 | 3600 秒 |
| 1w | 全历史 | 3600 秒 |

向左滚动加载更多。

### 2.6 保护路由

| 路径 | 访问规则 |
|---|---|
| `/` 主页 | 公开 |
| `/chart` 图表页 | **公开**（免费钩子） |
| `/login`、`/signup` | 公开 |
| `/account` | 需登录 |
| `/strategies` | 需登录（Phase 2.1 仍占位，但守卫已加） |
| `/backtest` | 需登录 |

未登录访问保护路由 → 跳 `/login?next=/被保护的路径`

### 2.7 用户偏好存储

| 偏好项 | 未登录 | 登录 |
|---|---|---|
| 默认周期 | localStorage | Supabase + localStorage 缓存 |
| 启用的指标 | localStorage | Supabase |
| 主题（Phase 2.1 Dark only） | localStorage | Supabase |

---

## 3. 数据库 Schema（Supabase Postgres）

**一次性把所有阶段的表建好，Phase 2.1 只用 profiles 和 user_preferences。**

### 3.1 `profiles`

```sql
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  avatar_url text,

  plan text not null default 'free' check (plan in ('free', 'pro')),
  plan_expires_at timestamptz,
  stripe_customer_id text,

  ai_provider text check (ai_provider in ('claude', 'openai')),
  ai_key_encrypted text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;
create policy "Users can view own profile" on profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);
```

### 3.2 `user_preferences`

```sql
create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- 示例结构：
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
create policy "Users can manage own preferences" on user_preferences
  for all using (auth.uid() = user_id);
```

### 3.3 `strategies`（Phase 3 启用，Phase 2.1 建表不用）

```sql
create table public.strategies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  code text not null,
  params jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_strategies_user on strategies(user_id);
alter table strategies enable row level security;
create policy "Users can manage own strategies" on strategies
  for all using (auth.uid() = user_id);
create policy "Anyone can view public strategies" on strategies
  for select using (is_public = true);
```

### 3.4 `backtests`（Phase 3 启用）

```sql
create table public.backtests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  config jsonb not null,
  metrics jsonb not null,
  trades jsonb,
  start_date timestamptz not null,
  end_date timestamptz not null,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create index idx_backtests_user on backtests(user_id);
create index idx_backtests_strategy on backtests(strategy_id);
alter table backtests enable row level security;
create policy "Users can manage own backtests" on backtests
  for all using (auth.uid() = user_id);
```

### 3.5 `parameter_optimizations`（Phase 4 Pro 功能）

```sql
create table public.parameter_optimizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  strategy_id uuid not null references strategies(id) on delete cascade,
  param_ranges jsonb not null,
  results_csv_path text,
  best_params jsonb,
  best_metrics jsonb,
  status text not null check (status in ('pending', 'running', 'completed', 'failed')),
  total_combinations integer,
  completed_combinations integer default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index idx_opt_user on parameter_optimizations(user_id);
alter table parameter_optimizations enable row level security;
create policy "Users can manage own optimizations" on parameter_optimizations
  for all using (auth.uid() = user_id);
```

### 3.6 触发器

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

## 4. Phase 2.1 功能规格

### 4.1 完整图表页 `/chart`（公开访问）

#### 页面结构（自上而下）

1. **顶部工具栏**（固定悬浮）
   - 左：`BTC/USDT` 标签 + 当前价 + 24h 涨跌幅
   - 中：**周期选择器**（`1分` / `5分` / `15分` / `1时` / `4时` / `1日` / `1周`）
   - 右：**指标按钮**（点开弹出面板勾选 MA / RSI / MACD）

2. **主图表**（60%）
   - K 线（涨绿跌红）
   - MA 叠加（若启用）
   - 十字光标：悬停显示 OHLC + 时间

3. **成交量子图**（15%）
   - 成交量柱状图，颜色跟随涨跌

4. **RSI 子图**（12%，若启用）
   - 0-100，30/70 水平线
   - 右侧当前 RSI 值

5. **MACD 子图**（12%，若启用）
   - DIF / DEA 线 + 柱状图
   - 右侧当前三值

#### 默认参数（硬编码）

- MA：周期 20 和 50
- RSI：周期 14
- MACD：(12, 26, 9)

#### 中文标签对照

| 英文 | 中文 |
|---|---|
| Timeframe | 周期 |
| Indicators | 指标 |
| Open / High / Low / Close | 开 / 高 / 低 / 收 |
| Volume | 成交量 |
| 1m / 5m / 15m / 1h / 4h / 1D / 1W | 1分 / 5分 / 15分 / 1时 / 4时 / 1日 / 1周 |

#### 交互行为

- 切换周期：立即重新拉数据
- 鼠标滚轮：缩放
- 拖拽：平移
- 向左滚到头：加载更多历史
- 开关指标：即时显隐
- 登录用户偏好自动保存（debounce 2s），未登录存 localStorage

#### 数据更新

- 当前周期最后一根 K 线每 10 秒轮询

### 4.2 认证系统

#### 4.2.1 注册页 `/signup`

**字段与文案**：
- `邮箱` / `密码（至少 8 位）` / `确认密码`
- `[ ] 我已阅读并同意《服务条款》和《隐私政策》`（默认不勾）
- 主按钮：`注册`
- 分隔线："或"
- Google 登录按钮：`使用 Google 账号继续`
- 底部：`已有账号？立即登录`

**流程**：
- 邮箱注册 → 发中文验证邮件 → 点击链接验证 → 自动登录 → 跳首页
- Google OAuth → 一键授权 → 自动建 profile → 跳首页

#### 4.2.2 登录页 `/login`

- 字段：`邮箱` / `密码`
- 主按钮：`登录`
- 分隔线："或"
- Google 登录按钮
- 底部：`忘记密码？` 和 `还没账号？立即注册`

登录成功 → 跳 `/`（或 `?next=` 指定路径）

#### 4.2.3 忘记密码

- `/forgot-password`：填邮箱 → 发中文重置邮件
- `/reset-password?token=xxx`：填新密码 → 跳登录页

#### 4.2.4 登出

Header 头像菜单 → `退出登录` → 清除 session → 跳 `/`

#### 4.2.5 Header 动态状态

**未登录**：
- 右上：`登录` 和 `注册` 按钮

**已登录**：
- 右上：头像（Google 头像 或 邮箱首字母）
- 下拉菜单：
  - 用户名 + 邮箱（灰色）
  - `账户设置` → `/account`
  - `我的策略` → `/strategies`（Phase 3 启用）
  - 分隔线
  - `退出登录`

#### 4.2.6 中文邮件模板

Supabase 默认邮件是英文，Phase 2.1 必须在 Supabase Dashboard 自定义中文模板。

**邮件验证模板**：
```
主题：验证你的 BTC Station 账户

你好，

感谢注册 BTC Station。请点击下方链接完成邮箱验证：

{{ .ConfirmationURL }}

如果这不是你本人的操作，请忽略此邮件。

—— BTC Station 团队
```

**密码重置模板**：
```
主题：重置你的 BTC Station 密码

你好，

我们收到了你的密码重置请求。请点击下方链接设置新密码：

{{ .ConfirmationURL }}

此链接 1 小时内有效。如果这不是你本人的操作，请忽略此邮件并考虑修改密码。

—— BTC Station 团队
```

**Magic Link 模板**（若启用）：
```
主题：BTC Station 登录链接

你好，

点击下方链接即可直接登录 BTC Station：

{{ .ConfirmationURL }}

此链接 1 小时内有效。

—— BTC Station 团队
```

### 4.3 账户设置页 `/account`

三个 tab：

#### Tab 1: 个人资料
- 头像（可上传，存 Supabase Storage）
- `昵称`（可改）
- `邮箱`（只读 + 验证状态徽章："已验证" / "未验证 [重发]"）
- `注册时间`

#### Tab 2: 偏好设置
- `默认周期`（下拉）
- `默认启用的指标`（checkbox 组）
- `主题：深色`（Phase 2.1 Dark only，预留 UI）

#### Tab 3: 账号安全
- `修改密码`（仅邮箱用户可见）
- `删除账号`（二次确认，Phase 2.1 可占位 "功能即将上线"）

#### 未启用 tab（隐藏不渲染）
- 订阅管理（Phase 4）
- AI 密钥管理（Phase 5）
- 交易所连接（Phase 7）

---

## 5. API 路由

### 5.1 Phase 1 保留
- `GET /api/btc/summary`
- `GET /api/btc/klines`
- `GET /api/news`

### 5.2 Phase 2.1 新增

```
GET /api/chart/klines?interval={tf}&limit={n}&before={ts}
  参数：interval (1m/5m/15m/1h/4h/1d/1w), limit (默认 500), before (分页)
  返回：{ candles: [{time, open, high, low, close, volume}], hasMore }

GET /api/chart/ticker
  返回当前价 + 最后一根未完成 K 线
  缓存 5 秒

POST /api/preferences (需登录)
  Body: { preferences: {...} }
  返回更新后偏好

GET /api/preferences (需登录)
  返回当前用户偏好
```

### 5.3 认证路由

由 Supabase SDK 直接处理，仅需 `/auth/callback` 路由处理 OAuth 回调。

---

## 6. Google OAuth 配置（实操细节）

因为这是 Phase 2.1 最容易卡住的地方，单列一节：

### 6.1 Google Cloud Console

1. 访问 [console.cloud.google.com](https://console.cloud.google.com)
2. 新建项目 "BTC Station"
3. `APIs & Services` → `OAuth consent screen`：
   - User Type：**External**
   - App name：`BTC Station`
   - User support email：你的邮箱
   - Authorized domains：你的 Vercel 域名 + Supabase 域名
   - Developer contact：你的邮箱
4. `APIs & Services` → `Credentials` → `Create Credentials` → `OAuth 2.0 Client ID`：
   - Application type：**Web application**
   - Authorized JavaScript origins：
     - `http://localhost:3000`（开发）
     - `https://你的vercel域名.vercel.app`
   - Authorized redirect URIs：
     - `https://你的supabase项目.supabase.co/auth/v1/callback`
5. 保存 Client ID 和 Client Secret

### 6.2 Supabase 配置

1. Supabase Dashboard → `Authentication` → `Providers` → `Google`
2. 填入 Client ID 和 Client Secret
3. 保存

### 6.3 常见问题

- **redirect_uri_mismatch**：Google Console 的 redirect URI 必须精确匹配 Supabase 的 callback URL
- **App 未验证提示**：用户 < 100 不需要 Google 验证，会显示"此应用未经验证"警告但可以继续
- **本地测试 OAuth**：本地用 `http://localhost:3000`，Google Console 也要加这个 origin

---

## 7. 速率限制与安全

### 7.1 OKX 速率限制

公共端点 20 req/2s/IP。Vercel 每个 serverless 实例独立 IP，冷启动缓存失效短时打高风险可控。

**对策**：服务端缓存、失败回落旧数据、API 失败用户侧显示"数据暂时无法获取，请稍候"（中文）。

### 7.2 环境变量

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...
SUPABASE_SERVICE_ROLE_KEY=ey...

# OKX（公共 API 无需 Key，但预留）
OKX_API_BASE=https://www.okx.com

# Phase 4+
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
```

### 7.3 安全清单

- [ ] `SUPABASE_SERVICE_ROLE_KEY` 绝不出现在 `NEXT_PUBLIC_*`
- [ ] 所有 DB 表启用 RLS
- [ ] Google OAuth redirect URL 两边匹配
- [ ] 密码最少 8 位
- [ ] 邮箱必须验证后才能登录
- [ ] API 路由同源检查

---

## 8. 不做的事（防跑偏）

- ❌ Stripe / 付费（Phase 4）
- ❌ 策略系统（Phase 3）
- ❌ 回测（Phase 3）
- ❌ AI 分析（Phase 5）
- ❌ 模拟盘（Phase 6）
- ❌ 交易所对接（Phase 7）
- ❌ 画线工具（Phase 2.2）
- ❌ 更多指标（Phase 2.2）
- ❌ 多币种
- ❌ i18n 多语言框架
- ❌ WebSocket
- ❌ 移动端 App
- ❌ 付费 UI（即使占位，防用户以为要收费）
- ❌ IP 地理限制
- ❌ 微信/QQ 登录
- ❌ 人民币支付

---

## 9. 验收标准

### 功能验收
- [ ] `/chart` 公开访问
- [ ] 7 个周期切换正常
- [ ] MA/RSI/MACD 指标开关正常，数值与 TV 对比误差 < 0.1%
- [ ] 十字光标 OHLC 中文标签
- [ ] 向左滚动加载更多
- [ ] 最后一根 K 线 10 秒刷新
- [ ] 邮箱注册 + 中文验证邮件流程完整
- [ ] 邮箱登录正常
- [ ] Google OAuth 正常
- [ ] 忘记密码流程完整（中文邮件）
- [ ] Header 已登录/未登录状态切换正确
- [ ] `/account` 三个 tab 正常
- [ ] 修改偏好持久化
- [ ] 未登录偏好 localStorage，登录后同步 DB
- [ ] 全站 UI 中文
- [ ] 中文邮件模板已配置

### 技术验收
- [ ] 所有 Supabase 表建好，RLS 生效
- [ ] 新用户自动创建 profile + preferences
- [ ] 环境变量正确分离
- [ ] middleware.ts 处理保护路由
- [ ] Vercel 部署公开可访问
- [ ] 图表交互流畅
- [ ] 移动端布局不崩

### 合规验收
- [ ] 注册必须勾选服务条款
- [ ] Footer 免责声明保留
- [ ] 服务条款 / 隐私政策 占位页保留
- [ ] 全站无投資助言暗示性用语
- [ ] 服务条款中声明不主动面向大陆提供服务

---

## 10. 工作流

### Step 1: 本文档 → Claude Design

**指令模板**：
```
我有一个 BTC 量化交易网站 BTC Station，Phase 1 已完成（主页 + 资讯 + 简易图表），
目标用户是全球华语用户，全中文 UI。

请：
1. 读 Phase 1 的 codebase：[仓库/ZIP]（继承设计系统）
2. 读 Phase 2.1 策划文档（附件）
3. 产出以下页面高保真 mockup（全中文）：
   - /chart 完整图表页（重点）
   - /login 登录页
   - /signup 注册页
   - /forgot-password 忘记密码页
   - /account 账户设置页（三个 tab）
   - Header 已登录状态（头像菜单）

要求：
- 全中文文案
- 深色主题
- 中文字体清晰（PingFang SC / Microsoft YaHei）
- 比一般 TradingView 更干净克制
- 输出可直接给 Claude Code 的设计 tokens
```

### Step 2: 策划 + 视觉 → Claude Code

**指令模板**：
```
为 BTC Station 做 Phase 2.1。
- 项目现状：[Phase 1 仓库]
- 策划文档：[附件]
- 视觉设计：[Claude Design 输出]

按顺序实施：
1. Supabase 项目 + schema（第 3 节）
2. 认证系统 + Google OAuth（第 4.2、第 6 节）
3. 完整图表页（第 4.1 节）
4. 账户设置页（第 4.3 节）
5. middleware 保护路由（第 2.6 节）
6. 中文邮件模板（第 4.2.6 节）

每步做完告知我本地验证后再下一步。
最后部署 Vercel 验收。

严禁扩大范围（第 8 节）。
```

---

## 11. 项目负责人实操清单

1. **开 Supabase 账号**（Region 选 Tokyo）
   - 记录 URL、anon key、service role key
2. **Google Cloud Console 配 OAuth**（第 6.1 节）
3. **Supabase 配 Google provider**（第 6.2 节）
4. **Supabase Dashboard 改邮件模板**（第 4.2.6 节）
5. **把本文档 + Phase 1 仓库** → Claude Design
6. **策划 + 视觉** → Claude Code 实施
7. **本地验证**（第 9 节清单）
8. **Vercel 部署**
   - 所有环境变量在 Vercel Dashboard 配置
   - Google OAuth redirect URL 添加 Vercel 域名
9. **找 2-3 个华语朋友测试**
10. **验收通过后回来启动 Phase 2.2 或 Phase 3**

---

## 12. 风险清单

| 风险 | 缓解 |
|---|---|
| OKX API 限流 | 服务端缓存 + 失败回落 |
| Supabase 免费额度 | 监控 Dashboard |
| Vercel serverless 冷启动 | 影响首屏，可接受 |
| Google OAuth 审核 | 用户 < 100 不需 verification |
| 中文邮件被垃圾箱 | Phase 4 有预算后用自定义发件域 |
| 大陆用户 Google 登录失败 | UI 引导用邮箱，错误提示友好 |
| 中文字体在不同系统显示不一致 | 字体栈覆盖 Mac/Windows/Linux |
| 繁体中文用户体验 | Phase 2.1 只做简中，后续看反馈 |

---

**版本历史**
- v1.0 — Phase 2.1 初稿
- **v1.1（当前）** — 全中文化、OKX 统一、大陆策略、登录方式确定
