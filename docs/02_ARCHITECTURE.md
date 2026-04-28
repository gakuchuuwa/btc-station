# BTC Station: 技术架构与规范 (Architecture)

> **版本**：v4.0
> **架构核心**：前后端完全分离，容器化调度隔离，保证回测计算不阻塞 Web 服务。

## 一、 技术栈 (Tech Stack)

| 层级 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **前端 (Web)** | Next.js 14 App Router + Tailwind CSS | React 生态，SSR 加速首页，快速构建复杂交互面板。 |
| **图表渲染** | Lightweight Charts + Plotly / ECharts | Lightweight Charts 用于 K 线；Plotly 用于 Hyperopt 调参的可视化。 |
| **鉴权与DB** | Supabase | JWT Auth，Postgres 存储用户信息与策略代码。 |
| **后端 API** | FastAPI (Python) | 高并发，类型安全，与 Python 数据科学生态无缝对接。 |
| **任务队列** | Celery + Redis | 负责把耗时的回测/调参任务丢入后台排队，通过 WebSocket 推送进度。 |
| **回测/实盘引擎** | **Freqtrade + Docker** | (核心引擎) 每个用户的任务动态拉起独立的 Freqtrade 容器/进程执行。 |

## 二、 核心组件设计 (Core Components)

### 1. 任务调度层 (`freqtrade_runner.py` / `api_v31.py`)
*   **回测任务 (Backtest)**：用户通过 Web 提交策略代码，FastAPI 生成配置文件并写入 `user_data` 目录。Celery Worker 通过 `subprocess.run` 同步执行 `freqtrade backtesting`，执行完毕后解析 JSON/ZIP 并输出结果。
*   **常驻任务 (Live/Dry-run)**：通过 `subprocess.Popen` 异步拉起 `freqtrade trade`，将 PID 写入文件进行生命周期管理（启动、停止、状态查询）。

### 2. 数据转换工厂 (`csv_converter.py`)
*   拦截 Freqtrade 输出的复杂嵌套 JSON 结果文件。
*   将总收益、最大回撤、各笔交易明细扁平化，严格按照 TradingView Assistant 插件的 **191列 CSV 标准** 进行转换。
*   处理文件编码 (UTF-8 with BOM)，确保可以直接被 `quant-lab.org` 识别。

## 三、 API 设计原则
*   全部路由挂载在 FastAPI 下，如 `/api/strategies`, `/api/backtests`, `/api/live`。
*   所有接口强制 `user_id = Depends(current_user)` 鉴权。
*   长耗时操作（如拉取 K 线、跑大范围 Hyperopt）严禁阻塞主线程，必须走 Celery 异步或 WebSocket 流式返回。

## 四、 安全底线
*   **API Keys 不入库**：用户的 OKX API Keys（实盘用）绝对不允许存入 Supabase。只在用户请求开启实盘时，存在前端内存中，通过 HTTPS 发给后端，并立刻打包进 `config.json` 挂载到容器，后端不做任何持久化记录。
