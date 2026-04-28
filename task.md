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

- `[x]` **后端接口改造**
  - `[x]` 废弃旧版 `live_engine.py` 的自研逻辑（已由 `live_runner.py` 取代）
  - `[x]` 新增 `/api/live/start`、`/api/live/stop`、`/api/live/status` 接口
  - `[x]` 使用 `subprocess.Popen` 拉起 `freqtrade trade`，PID 文件管理生命周期，支持 `dry_run: true/false`
- `[x]` **后端安全代理层 (api_v31.py)**
  - `[x]` 新增 `GET /api/live/metrics` 接口
  - `[x]` 引入 `httpx`，后端携带内部 credentials 将请求转发给 Freqtrade 内部 API (获取 profit, status 等)
- `[x]` **前端实盘工作台 (Next.js)**
  - `[x]` 搭建独立大屏：包含启停控制表单 (选择策略、投资额、输入API Key)
  - `[x]` 轮询 `/api/live/metrics`，渲染 PnL (未结盈亏)、胜率等数据大盘
  - `[x]` 基于 `log_tail` 渲染黑客风日志终端

## 🧊 阶段 4：商业化与支付流 (暂缓：全部免费开放)

> **当前策略**：为避免项目初期过度复杂，所有付费墙、Stripe 对接、免费/Pro 配额拦截逻辑全部搁置。核心功能写完前不考虑钱的事。

- `[ ]` *(暂缓)* 前端计费页展示
- `[ ]` *(暂缓)* 后端 Stripe 对接与 Webhook
- `[ ]` *(暂缓)* API 接口的配额拦截与权限校验

## 🧠 阶段 3.3：Hyperopt 高级调参可视化

- `[x]` **后端 Hyperopt 引擎 (backend/hyperopt_runner.py)**
  - `[x]` 新增 `hyperopt_runner.py`，封装 `freqtrade hyperopt` 命令
  - `[x]` 优先解析 `--export-csv` 产出的 `epochs.csv` 结果，流式提取参数与收益数据
- `[x]` **后端路由扩展 (api_v31.py)**
  - `[x]` 新增 `POST /api/hyperopt/start`，校验参数并提交后台任务
  - `[x]` 新增 `GET /api/hyperopt/{task_id}` 轮询进度与获取绘图数据
- `[x]` **前端可视化面板 (Next.js)**
  - `[x]` 独立 /hyperopt 页面，含调参表单 (Loss 函数、Space 多选、Epochs)
  - `[x]` react-plotly.js scattergl (WebGL) 渲染 2D 散点图，气泡大小=交易数，颜色=回撤，1000+ epoch 不卡
  - `[x]` Top 10 参数组合表格，一键应用参数；实时进度条；最优参数汇总卡片

## 🤖 阶段 5：AI 辅助系统 (BYOK 模式)

- `[ ]` **API Key 安全存储**
  - `[ ]` 数据库增加字段安全存储用户提供的 OpenAI / Claude API Key
- `[ ]` **策略开发辅助**
  - `[ ]` Monaco Editor 侧边栏集成 AI 对话窗口
  - `[ ]` 实现代码查错、指标写法指导等 Prompt 工程
- `[ ]` **回测报告解读**
  - `[ ]` 将 Freqtrade JSON 摘要传入大模型，生成文字版盈利/风险分析报告
