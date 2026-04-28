# BTC Station - 开发进度与任务清单 (v4.0 Real-State)

> **同步说明**：此文件为 AI 与专属程序员之间的“唯一进度对齐点”。
> 程序员每次完成任务后，请将对应的 `[ ]` 修改为 `[x]`。遇到阻碍可直接在对应项下写备注。AI 接手任务时将优先读取此文件。

## ✅ 阶段 1-3.2：底层架构与全栈闭环 (已完成)

- `[x]` **前端基石**：Next.js App Router 搭建，Tailwind CSS + 响应式布局
- `[x]` **用户体系**：Supabase Auth 集成 (注册、登录、找回密码)
- `[x]` **策略引擎中枢 (Phase 3.1)**
  - `[x]` `api_v31.py` 策略 CRUD 接口
  - `[x]` `freqtrade_runner.py` 后台静默下载数据、拉起 Freqtrade 容器
  - `[x]` 健壮解析 Freqtrade 回测结果文件 (JSON/ZIP)
- `[x]` **任务流与实时通讯**
  - `[x]` Celery + Redis 异步任务队列落地
  - `[x]` WebSocket 回测进度与日志流式推送
- `[x]` **数据兼容层 (Phase 3.2 核心)**
  - `[x]` `csv_converter.py` 将 Freqtrade 结果转换为 191 列 TV 兼容 CSV

## 🚧 阶段 6 & 7：Freqtrade 实盘与模拟盘重构 (当前高优)

> **背景**：当前的 `live_engine.py` 仍为基于 Pandas 的旧版自研引擎。需要统一并入 Freqtrade 架构。

- `[ ]` **后端接口改造**
  - `[ ]` 废弃旧版 `live_engine.py` 的自研逻辑
  - `[ ]` 新增 `/api/live/start` 和 `/api/live/stop` 接口
  - `[ ]` 使用 `subprocess` 拉起 Freqtrade 容器，执行 `freqtrade trade` 命令 (分别处理 `dry-run: true` 和 `dry-run: false`)
- `[ ]` **前端实盘工作台**
  - `[ ]` 搭建独立的实盘/模拟盘管理页面
  - `[ ]` 通过 Freqtrade REST API 定时轮询当前持仓状态、未结盈亏 (PnL) 并渲染

## 💳 阶段 4：商业化与支付流 (Stripe Integration)

- `[ ]` **前端计费页**
  - `[ ]` 开发 `/pricing` 页面，展示 Free / Pro 计划及对应权限对比
- `[ ]` **后端支付对接**
  - `[ ]` 对接 Stripe Checkout Session API
  - `[ ]` 实现 Stripe Webhook 监听
  - `[ ]` 支付成功后自动更新 Supabase 中 `profiles.plan` 的状态
- `[ ]` **权限与配额拦截**
  - `[ ]` 在 `api_v31.py` 中强制限制 Free 用户的回测次数 (例如每月 5 次)
  - `[ ]` 限制 Free 用户的 Hyperopt Epoch 上限

## 🧠 阶段 3.3：Hyperopt 高级调参可视化

- `[ ]` **前端可视化面板**
  - `[ ]` 在策略详情页/回测页新增“智能调参”面板
  - `[ ]` 引入 React-Plotly 或 ECharts
- `[ ]` **数据渲染**
  - `[ ]` 解析 Hyperopt 结果并生成 2D 热力图或散点图
  - `[ ]` 展示“Top 10 参数组合”表格

## 🤖 阶段 5：AI 辅助系统 (BYOK 模式)

- `[ ]` **API Key 安全存储**
  - `[ ]` 数据库增加字段安全存储用户提供的 OpenAI / Claude API Key
- `[ ]` **策略开发辅助**
  - `[ ]` Monaco Editor 侧边栏集成 AI 对话窗口
  - `[ ]` 实现代码查错、指标写法指导等 Prompt 工程
- `[ ]` **回测报告解读**
  - `[ ]` 将 Freqtrade JSON 摘要传入大模型，生成文字版盈利/风险分析报告
