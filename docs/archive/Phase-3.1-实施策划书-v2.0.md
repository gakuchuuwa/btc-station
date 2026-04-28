# BTC Station — Phase 3.1 实施策划书 v2.0

> **本文档用途**：Phase 3.1 可执行规格，交付给 Claude Design 出视觉，再交付给 Claude Code 实施。
>
> **前置条件**：Phase 3.0 已完成并上线（6 个客户端 JS 预设策略 + 浏览器内回测）。
>
> **预计工时**：10-14 天 AI 编码（地基重，但收益持续到 Phase 7）。
>
> **本阶段定位**：项目从"工具"升级为"平台"的关键关卡。引入 **Freqtrade 多租户后端**，用户能写真正的 Python 策略，享受永续合约精确回测能力。
>
> **版本**：v2.0（2026-04-25）
> **此前版本**：v1.0（基于 E2B + vectorbt）已废弃

---

## 0. v2.0 相比 v1.0 的核心变化

| 项目 | v1.0（已废弃） | **v2.0（当前）** |
|---|---|---|
| 沙箱方案 | E2B Sandbox | **Docker 容器**（每用户一个 Freqtrade 实例） |
| 策略 API | 自由 Python 函数 | **Freqtrade IStrategy 类规范** |
| 回测引擎 | vectorbt | **Freqtrade backtesting 子命令** |
| 永续合约处理 | 自己实现 | **Freqtrade 内置**（精确含资金费率 + 杠杆 + 强平价） |
| 后端 | FastAPI + Celery（vectorbt 调用） | **FastAPI + Docker SDK + Celery（Freqtrade 编排）** |
| 安全模型 | E2B 自带沙箱 | **Docker + 网络白名单 + 文件系统只读 + 资源限额** |

**工程意义**：Docker 编排显著增加基础设施复杂度，但换来 Phase 6 + Phase 7 的极大简化（同一份策略代码可跑回测/模拟盘/实盘，无迁移成本）。

---

## 1. Phase 3.1 范围

**Freqtrade 多租户后端 + Python 策略编辑器 + 单次回测 + 191 列 CSV 输出。**

不做：
- 参数优化（Phase 3.2）
- 模拟盘（Phase 6）
- 实盘（Phase 7）
- AI 助手（Phase 5）

---

## 2. 核心用户故事

> **小李是一个有 Python 基础的加密交易者**，已经用过 BTC Station Phase 3.0 的 6 个预设策略。他想试自己的想法："用 RSI < 30 + MACD 金叉 + 布林带下轨" 三重确认买入。
>
> 他打开 BTC Station 编辑器，从模板"MA 交叉策略"出发，改成自己的逻辑。点"运行回测"——后端启动一个 Docker 容器跑 Freqtrade，30 秒后返回完整 191 列指标 + 净值曲线 + 永续合约精确模拟（含每 8h 资金费率和强平价）。
>
> 他下载 CSV 上传到 quant-lab.org 拿到 87 分。

这是 Phase 3.1 的目标：**让用户从"挑现成策略"跨越到"写自己的策略"，并享受到永续合约精确回测的专业能力**。

---

## 3. 与 Phase 3.0 的关系

### 3.1 Phase 3.0 继承不变

- **6 个简单策略库 + 客户端 JS 回测保留**（作为入门免费体验）
- 图表页所有功能
- IndexedDB 历史数据缓存
- 用户偏好系统

### 3.2 Phase 3.1 新增

| 新增 | 位置 |
|---|---|
| 策略编辑器页 | `/strategies/editor`（新增） |
| 编辑器内的回测面板 | 编辑器右侧（不离开页面） |
| BTC Station 后端服务 | 独立部署（FastAPI） |
| Freqtrade 容器集群 | 后端 Docker 编排 |
| 191 列 CSV 转换层 | 后端工具 |
| 6 个 Phase 3.0 策略的 Freqtrade IStrategy 模板 | 后端预置 |

### 3.3 入口路径设计

**双轨并存**，不强制升级用户：

```
/strategies (Phase 3.0 策略库)
    ├─ 6 个简单策略 → 客户端回测（瞬间出结果）
    └─ "我要写自己的策略" → /strategies/editor（Phase 3.1 入口）
```

为什么保留 Phase 3.0 客户端引擎？
- 启动 Freqtrade 容器需 5-10 秒，简单策略瞬间完成体验更好
- 入门用户用不到永续合约精确模拟
- **Pro 升级钩子**：编辑器页有"切换到精确永续模拟"选项（要 Pro）

---

## 4. 后端架构

### 4.1 部署架构图

```
┌──────────────────────────────────────────────┐
│ Vercel（Next.js 前端）                         │
│ 已有：主页、图表、Phase 3.0 策略               │
│ 新增：/strategies/editor                       │
└─────────────┬────────────────────────────────┘
              │ HTTPS + JWT (Supabase)
              ↓
┌──────────────────────────────────────────────┐
│ Railway / Fly.io                              │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ BTC Station Backend (FastAPI)        │  │
│  │ - JWT 验证（Supabase 共享密钥）         │  │
│  │ - Docker SDK 编排                     │  │
│  │ - Celery 任务分发                     │  │
│  │ - CSV 转换层                          │  │
│  │ - 限额计费                            │  │
│  └──────────────────────────────────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ Redis（任务队列）                       │  │
│  └──────────────────────────────────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ Docker 主机（容器编排）                  │  │
│  │ ┌────────┐ ┌────────┐ ┌────────┐    │  │
│  │ │User A  │ │User B  │ │User C  │    │  │
│  │ │Freq容器 │ │Freq容器 │ │Freq容器 │    │  │
│  │ └────────┘ └────────┘ └────────┘    │  │
│  └──────────────────────────────────────┘  │
│                                              │
│  ┌──────────────────────────────────────┐  │
│  │ 历史数据共享卷（OHLCV 缓存）             │  │
│  │ /data/historical/BTC-USDT-SWAP/       │  │
│  └──────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
              │
              ↓
┌──────────────────────────────────────────────┐
│ Supabase                                      │
│ - 用户 / 策略 / 回测结果                       │
│ - Storage（CSV、图表截图）                     │
└──────────────────────────────────────────────┘
              │
              ↓
        OKX API（CCXT）
```

### 4.2 部署平台决策

**推荐 Railway**，理由：
- 对小项目友好（按用量计费 vs Fly.io 按机器计费）
- Docker 镜像部署一键搞定
- 内置 Redis、PostgreSQL 等托管服务
- 日本节点延迟尚可（用户在日本/中国）
- 月费起步 $5，预计 Phase 3.1 阶段每月 $30-50

**备选 Fly.io**：
- 全球部署节点更多
- 资源弹性更好
- 但学习曲线陡

最终选择在 Phase 3.1 启动时根据延迟实测决定，文档默认按 Railway。

### 4.3 历史数据管理

**核心决定：后端统一下载维护**（而非每个用户容器自己拉）。

#### 4.3.1 共享历史数据卷

```
/data/historical/
├── BTC-USDT/           # 现货
│   ├── 1m.feather
│   ├── 5m.feather
│   ├── 15m.feather
│   ├── 1h.feather
│   ├── 4h.feather
│   └── 1d.feather
└── BTC-USDT-SWAP/      # 永续
    ├── 1m.feather
    ├── 5m.feather
    ├── 15m.feather
    ├── 1h.feather
    ├── 4h.feather
    └── 1d.feather
```

#### 4.3.2 数据更新策略

- **首次部署**：后端启动定时任务拉取 BTC 5 年完整历史（每个周期一次）
- **增量更新**：每小时定时任务调用 `freqtrade download-data`，只拉最新 K 线
- **挂载方式**：每个 Freqtrade 容器**只读挂载**该卷，任何用户回测都用同一份数据

#### 4.3.3 数据下载命令

```bash
freqtrade download-data \
  --exchange okx \
  --pairs BTC/USDT BTC/USDT:USDT \
  --timeframes 1m 5m 15m 1h 4h 1d \
  --days 1825 \
  --trading-mode futures \
  --datadir /data/historical/
```

注意：Freqtrade 中 OKX 永续合约的 pair 命名是 `BTC/USDT:USDT`（不是我们之前以为的 `BTC-USDT-SWAP`，那是 OKX 自己的命名）。

#### 4.3.4 数据存储成本

5 年 BTC 全周期数据约 **150-200 MB**（feather 格式压缩好）。Railway volume 1GB 月费 $0.25，可忽略。

### 4.4 Freqtrade 容器规格

#### 4.4.1 镜像构建

基于官方 `freqtradeorg/freqtrade:stable` 镜像扩展：

```dockerfile
FROM freqtradeorg/freqtrade:stable

# 安装额外依赖（如需）
RUN pip install --no-cache-dir pandas-ta

# 创建用户目录结构
RUN mkdir -p /freqtrade/user_data/strategies /freqtrade/user_data/data

# 启动脚本由后端动态注入
ENTRYPOINT ["freqtrade"]
```

构建后推送到 Railway 容器仓库或 Docker Hub，每个用户容器从这个基础镜像启动。

#### 4.4.2 容器启动参数

每次回测时由 BTC Station 后端通过 Docker SDK 启动容器：

```python
# 伪代码示例
container = docker_client.containers.run(
    image="btcstation/freqtrade:latest",
    name=f"ft-{user_id}-bt-{task_id}",

    # 资源限额（按用户付费层级动态设置）
    mem_limit="512m",  # 免费 / Pro 2g
    cpu_quota=50000,   # 免费 0.5 核 / Pro 2 核
    cpu_period=100000,

    # 网络隔离
    network_mode="none",  # 默认无网络
    # 仅 download-data 模式需要网络（共享数据卷已下载好，回测不需要）

    # 文件系统
    volumes={
        "/data/historical": {"bind": "/freqtrade/user_data/data", "mode": "ro"},
        f"/data/users/{user_id}/strategies": {"bind": "/freqtrade/user_data/strategies", "mode": "ro"},
        f"/data/users/{user_id}/results": {"bind": "/freqtrade/user_data/backtest_results", "mode": "rw"},
    },
    read_only=True,  # 容器根文件系统只读
    tmpfs={"/tmp": "size=100m"},  # /tmp 可写但限制大小

    # 安全约束
    security_opt=["no-new-privileges:true"],
    cap_drop=["ALL"],

    # 命令
    command=[
        "backtesting",
        "--config", "/freqtrade/user_data/config.json",
        "--strategy", strategy_class_name,
        "--timeframe", timeframe,
        "--timerange", timerange,
    ],

    # 自动清理
    auto_remove=True,
    detach=True,
)
```

#### 4.4.3 安全设计要点

| 风险 | 缓解 |
|---|---|
| 用户代码逃逸容器 | Docker + 文件系统只读 + cap_drop=ALL |
| 用户代码泄露其他用户数据 | 每用户独立 volume，挂载点严格隔离 |
| 用户代码消耗服务器资源 | mem_limit + cpu_quota + 任务超时 |
| 用户代码联外网 | network_mode=none（回测不需要网络） |
| 容器逃逸到宿主 | gVisor 二级沙箱（Phase 3.1 末尾评估） |
| 用户提交大量任务刷爆服务器 | Celery 任务队列 + 用户限额 |

#### 4.4.4 任务超时策略

| 任务类型 | 免费用户 | Pro 用户 |
|---|---|---|
| 单次回测 | 5 分钟 | 30 分钟 |
| 每月回测次数 | 5 次 | 无限 |

超时后容器被强制 kill，任务标记 `failed`，错误信息友好返回前端。

### 4.5 BTC Station 后端 API 路由

#### 4.5.1 策略 CRUD

```
POST /api/strategies
  Body: { name, code, description }
  返回: { strategy_id }

GET /api/strategies
  返回: 用户的所有策略列表

GET /api/strategies/{id}
  返回: 单个策略详情（含代码）

PUT /api/strategies/{id}
  Body: { name?, code?, description? }

DELETE /api/strategies/{id}
```

存储到 Supabase `strategies` 表（已有 schema）。

#### 4.5.2 回测任务

```
POST /api/backtests
  Body: {
    strategy_id,
    timeframe,        # 1m / 5m / 15m / 1h / 4h / 1d
    timerange,        # "20210101-20260101"
    market,           # "spot" | "futures"
    initial_capital,
    leverage,         # 仅 futures 模式
    config_overrides  # 可选 Freqtrade 配置覆盖
  }
  返回: { task_id, status: "queued" }

GET /api/backtests/{task_id}
  返回: {
    status: "queued" | "running" | "completed" | "failed",
    progress: 0-100,
    result?: BacktestResult,  # 完成时
    error?: string            # 失败时
  }

WS /api/backtests/{task_id}/stream
  实时推送进度、日志、状态变更

GET /api/backtests/{task_id}/csv
  下载 191 列 TV 兼容 CSV
```

#### 4.5.3 系统状态

```
GET /api/quota
  返回当前用户的本月配额使用情况：
  {
    plan: "free" | "pro",
    backtests_used: 3,
    backtests_limit: 5,
    next_reset: "2026-05-01"
  }
```

### 4.6 CSV 转换层

#### 4.6.1 Freqtrade JSON 输出结构

Freqtrade backtesting 完成后输出 `.zip` 文件，含 `.json` 详细结果。关键字段：

```json
{
  "strategy": { ... },
  "results_per_pair": [{
    "key": "BTC/USDT:USDT",
    "trades": 86,
    "profit_total": 0.36138579,
    "profit_total_abs": 361385.79,
    "max_drawdown_account": 0.106,
    "wins": 47, "losses": 39,
    "winrate": 0.5465,
    "profit_factor": 18.283,
    "expectancy": 0.4202,
    "sharpe": 0.128,
    "sortino": ... ,
    "calmar": ... ,
    "trades_per_day": 0.047,
    "duration_avg": "2 days",
    ...
  }],
  "trades": [
    {
      "pair": "BTC/USDT:USDT",
      "open_date": "2024-01-15 04:00:00",
      "close_date": "2024-01-17 12:00:00",
      "open_rate": 42500,
      "close_rate": 43200,
      "amount": 0.5,
      "profit_abs": 350,
      "profit_ratio": 0.0165,
      "is_short": false,
      "leverage": 1.0,
      ...
    }
  ]
}
```

#### 4.6.2 转换为 191 列 CSV

后端 `csv_converter.py` 模块负责转换：

```python
def freqtrade_json_to_tv_csv(
    json_result: dict,
    user_params: dict,
    config: dict
) -> str:
    """
    将 Freqtrade 输出转换为 TV Strategy Tester 兼容 191 列 CSV
    """
    # Step 1: 从 results_per_pair 提取核心指标
    # Step 2: 从 trades 数组按 is_short 分组计算 :Long/:Short 子集
    # Step 3: 拼接元数据（_setTime_ / _parseTime_ / _duration_ / comment）
    # Step 4: 拼接参数列（用户 IStrategy 类的 Parameter 字段）
    # Step 5: 输出 UTF-8 BOM 编码 CSV
```

详细字段映射见路线图 v3.0 附录 B。

#### 4.6.3 自检逻辑

转换后立即用 `pandas.read_csv()` 反向加载验证：
- 总列数正确
- 数据类型正确
- 必填字段非空

失败则任务标记 `failed` 并写错误日志。

---

## 5. Freqtrade IStrategy 编辑器（前端）

### 5.1 页面布局 `/strategies/editor`

```
┌────────────────────────────────────────────────────────────────────┐
│ Header（继承全站）                                                  │
├────────────────────────────────────────────────────────────────────┤
│                          ┌────────────────────┐                    │
│ ┌────────────────────┐   │ 模板选择 / 加载已保存 │                    │
│ │                    │   ├────────────────────┤                    │
│ │   Monaco Editor    │   │ 回测配置             │                    │
│ │   (Python 代码)    │   │ - 周期选择          │                    │
│ │                    │   │ - 时间范围          │                    │
│ │                    │   │ - 现货 / 永续        │                    │
│ │   60% 宽度         │   │ - 杠杆（仅永续）     │                    │
│ │                    │   │ - 初始资金          │                    │
│ │                    │   ├────────────────────┤                    │
│ │                    │   │ [运行回测]          │                    │
│ │                    │   │ [保存策略]          │                    │
│ │                    │   ├────────────────────┤                    │
│ │                    │   │ 回测进度            │                    │
│ │                    │   │ ▓▓▓▓▓░░ 60%       │                    │
│ │                    │   ├────────────────────┤                    │
│ │                    │   │ 回测结果（完成后展开） │                    │
│ │                    │   │ - 4 核心指标         │                    │
│ │                    │   │ - 净值曲线          │                    │
│ │                    │   │ - 交易记录          │                    │
│ │                    │   │ - 下载 CSV          │                    │
│ └────────────────────┘   └────────────────────┘                    │
└────────────────────────────────────────────────────────────────────┘
```

### 5.2 Monaco Editor 集成

#### 5.2.1 选型

`@monaco-editor/react` —— React 版本，社区主流。

#### 5.2.2 配置

```typescript
<Editor
  height="100%"
  defaultLanguage="python"
  defaultValue={DEFAULT_STRATEGY_TEMPLATE}
  theme="vs-dark"
  options={{
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    tabSize: 4,
    wordWrap: 'on',
    automaticLayout: true,
  }}
/>
```

#### 5.2.3 Freqtrade IStrategy 智能补全

通过自定义 Monaco language service 注入 Freqtrade API 类型定义：
- `IStrategy` 类的方法（`populate_indicators`、`populate_entry_trend` 等）
- `talib` 常用函数（`SMA`、`EMA`、`RSI`、`MACD`、`BBANDS` 等）
- `qtpylib` 常用函数（`crossed_above`、`crossed_below` 等）
- `IntParameter` / `DecimalParameter` / `BooleanParameter` / `CategoricalParameter`

类型定义文件 `freqtrade.d.ts` 由我们维护（约 200 行）。

### 5.3 策略模板库

编辑器顶部下拉"模板"，加载内置模板：

#### 5.3.1 内置模板（来自 Phase 3.0 6 个策略的 Freqtrade IStrategy 重写版）

1. `MaCrossStrategy` — MA 双均线交叉
2. `RsiStrategy` — RSI 超买超卖
3. `MacdStrategy` — MACD 金叉死叉
4. `BollingerBreakoutStrategy` — 布林带突破
5. `DcaStrategy` — DCA 定投（用 Freqtrade `adjust_trade_position` 回调实现）
6. `AtrChannelStrategy` — ATR 通道 + 止损

每个模板代码 < 100 行，注释详尽（中文）。

#### 5.3.2 一个完整模板示例

```python
"""
MA 双均线交叉策略 - BTC Station 内置模板

逻辑：
  - 快线上穿慢线 → 买入
  - 快线下穿慢线 → 卖出（平多）
  - 适合中长期趋势行情

提示：
  - 修改 fast_period / slow_period 试试不同周期组合
  - Pro 版可启用 hyperopt 自动找最优参数
"""
from freqtrade.strategy import (
    IStrategy, IntParameter, CategoricalParameter
)
from pandas import DataFrame
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib


class MaCrossStrategy(IStrategy):
    INTERFACE_VERSION = 3

    # 时间周期（用户可在前端覆盖）
    timeframe = '4h'

    # 资金管理
    stake_currency = 'USDT'
    minimal_roi = {"0": 100}  # 不限收益，靠信号触发卖出
    stoploss = -0.99           # 几乎不止损，靠信号
    trailing_stop = False
    process_only_new_candles = True

    # 可优化参数（hyperopt 会找最优）
    fast_period = IntParameter(5, 100, default=20, space='buy')
    slow_period = IntParameter(10, 200, default=50, space='buy')
    ma_type = CategoricalParameter(['SMA', 'EMA'], default='SMA', space='buy')

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """计算指标"""
        ma_func = ta.SMA if self.ma_type.value == 'SMA' else ta.EMA
        dataframe['fast_ma'] = ma_func(dataframe, timeperiod=self.fast_period.value)
        dataframe['slow_ma'] = ma_func(dataframe, timeperiod=self.slow_period.value)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """买入信号：快线上穿慢线"""
        dataframe.loc[
            qtpylib.crossed_above(dataframe['fast_ma'], dataframe['slow_ma']),
            'enter_long'
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """卖出信号：快线下穿慢线"""
        dataframe.loc[
            qtpylib.crossed_below(dataframe['fast_ma'], dataframe['slow_ma']),
            'exit_long'
        ] = 1
        return dataframe
```

### 5.4 回测配置面板

| 字段 | 默认值 | 选项 | Pro 限制 |
|---|---|---|---|
| 时间周期 | `4h` | `1m / 5m / 15m / 1h / 4h / 1d` | 免费仅 `1h / 4h / 1d` |
| 时间范围 | "近 1 年" | "近 3 月 / 6 月 / 1 年 / 3 年 / 5 年 / 自定义" | 免费最多 1 年 |
| 市场 | `永续` | `现货 / 永续` | **现货所有用户**；**永续 Pro only** |
| 杠杆 | `1` | 1-50 | 仅永续模式可用 |
| 初始资金 | 10000 USDT | 1000-1000000 | — |
| 手续费 | 0.05% | 0.01-0.5% | — |

### 5.5 回测进度展示

#### 5.5.1 状态机

```
queued (排队中)
   ↓
starting (容器启动中)  // 5-10 秒
   ↓
running (回测中)        // 10-60 秒，进度条
   ↓
completed | failed
```

#### 5.5.2 WebSocket 推送

前端建立 WebSocket 连接到 `/api/backtests/{task_id}/stream`，后端实时推送：

```typescript
type StreamMessage =
  | { type: 'status', value: 'queued' | 'starting' | 'running' | 'completed' | 'failed' }
  | { type: 'progress', percent: number }
  | { type: 'log', line: string, level: 'info' | 'warning' | 'error' }
  | { type: 'result', result: BacktestResult }
  | { type: 'error', message: string };
```

UI 展示：状态徽章 + 进度条 + 实时日志（折叠展开）。

### 5.6 回测结果展示

继承 Phase 3.0 的回测结果组件（`Report.tsx` / `EquityCurve.tsx`），但加上：

#### 5.6.1 永续合约新增指标卡片

仅永续模式下显示：
- **杠杆使用** （avg / max）
- **资金费率成本** （总额 / % 占收益）
- **强平次数**
- **margin call 次数**

#### 5.6.2 高级指标

Phase 3.0 只展示 4 个核心，Phase 3.1 完整展示 191 列里有意义的 ~30 个：

```
基础: Total P&L / Total P&L % / Initial capital / Open P&L
胜率: Win Rate / Total Trades / Winning / Losing
分布: Avg Winning / Avg Losing / Largest Winning / Largest Losing
风险: Max Drawdown / Sharpe / Sortino / Calmar
多空: Long P&L / Short P&L / Long Win Rate / Short Win Rate
对照: Buy & Hold Return / Outperformance
```

#### 5.6.3 下载 CSV 按钮

点击触发 `GET /api/backtests/{task_id}/csv`，下载文件名格式：

```
BTC-USDT-SWAP_4h_MaCrossStrategy_20260425.csv
```

可直接上传 quant-lab.org 验证。

---

## 6. 数据库 Schema 调整

### 6.1 `strategies` 表（已建，使用约定调整）

不变更 schema，但 Phase 3.1 起 `code` 字段存内容形式：

| 起始字符 | 类型 | Phase |
|---|---|---|
| `{` 开头 | Phase 3.0 JSON 配置（保留） | Phase 3.0 |
| `# python` 或 `from` 等 Python 代码起始 | **Phase 3.1 IStrategy 类代码** | **Phase 3.1（新）** |

通过 `code` 起始字符判断策略类型，影响：
- 列表页显示的"策略类型"标签
- 详情页用哪种回测接口
- 是否显示"切换到精确永续模拟"按钮

### 6.2 `backtests` 表（已建）

Phase 3.1 启用所有字段：
- `config`：含 timeframe、timerange、market、leverage、initial_capital
- `metrics`：完整 Freqtrade JSON 关键字段（不只是 4 核心）
- `trades`：完整交易记录
- `status`：从 `queued` → `starting` → `running` → `completed` 完整状态机
- `error_message`：失败时填

### 6.3 新增 `freqtrade_jobs` 表（运维）

```sql
create table public.freqtrade_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  backtest_id uuid references backtests(id) on delete set null,

  -- Docker 容器信息
  container_id text,
  container_name text,

  -- 资源使用
  cpu_seconds float,
  memory_peak_mb integer,
  duration_seconds integer,

  -- 状态
  status text not null check (status in ('queued', 'starting', 'running', 'completed', 'failed', 'killed')),
  exit_code integer,

  -- 时间戳
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index idx_ft_jobs_user on freqtrade_jobs(user_id);
create index idx_ft_jobs_status on freqtrade_jobs(status);

alter table freqtrade_jobs enable row level security;
create policy "Users can view own jobs" on freqtrade_jobs
  for select using (auth.uid() = user_id);
```

这张表用于运维监控、计费、滥用检测。用户能看到自己的任务历史，但不能改写。

---

## 7. UI 字符串增量

| 中文 |
|---|
| 策略编辑器 |
| Python 策略 / IStrategy |
| 加载模板 / 保存为模板 |
| 永续合约（精确模拟）/ 现货 |
| 杠杆 |
| 资金费率成本 |
| 强平次数 |
| 排队中 / 容器启动中 / 回测运行中 / 已完成 / 已失败 |
| 实时日志 |
| 升级到 Pro 解锁永续合约精确模拟 |
| 任务超时（5 分钟）/ 升级 Pro 享 30 分钟回测时长 |

---

## 8. 性能与体验要求

| 项目 | 要求 |
|---|---|
| 容器冷启动 | < 10 秒 |
| 单次回测（5 年 4h） | < 60 秒 |
| 单次回测（1 年 1h） | < 30 秒 |
| 容器从启动到第一个进度推送 | < 15 秒（避免用户怀疑卡死） |
| WebSocket 进度推送间隔 | 1-3 秒 |
| CSV 下载（191 列，500 行） | 立即（< 100ms） |

### 性能优化关键

- **预热容器池**：维持 2-3 个空闲容器，新任务直接复用（启动 < 1 秒）
- **共享数据卷**：所有容器只读挂载，避免重复拉数据
- **Celery worker 并发**：Pro 用户优先队列，免费用户排队

---

## 9. 不做的事

- ❌ 参数优化 hyperopt（Phase 3.2）
- ❌ 模拟盘（Phase 6）
- ❌ 实盘（Phase 7）
- ❌ AI 助手（Phase 5）
- ❌ FreqAI 机器学习（Phase 5）
- ❌ Telegram 通知（Phase 6 起）
- ❌ 多用户共享策略 / 公开策略库
- ❌ 策略代码版本历史（先简化，未来加）
- ❌ 协作编辑
- ❌ 在线 Python REPL
- ❌ 容器内访问外部 API（除 OKX 数据，已在共享卷）

---

## 10. 验收标准

### 后端
- [ ] FastAPI 后端部署到 Railway，公开 URL 可访问
- [ ] Docker 镜像构建成功，推到 Railway 仓库
- [ ] BTC 5 年 6 个周期数据下载完成（150-200 MB）
- [ ] 后端定时任务每小时增量更新
- [ ] Docker SDK 能成功启停容器
- [ ] 容器资源限额生效（mem / cpu / 网络隔离 / 文件系统只读）
- [ ] Celery + Redis 任务队列工作正常
- [ ] 单次回测 6 个内置模板均跑通
- [ ] 191 列 CSV 转换层输出正确，能 pandas 反向加载

### 前端
- [ ] `/strategies/editor` 路由可访问
- [ ] Monaco Editor 加载流畅，Python 语法高亮正确
- [ ] 6 个模板可一键加载
- [ ] 提交回测后状态机正确流转
- [ ] WebSocket 进度实时推送
- [ ] 完整结果展示正确（4 核心 + 30 个高级指标）
- [ ] 永续模式新增的杠杆/资金费率/强平统计显示
- [ ] CSV 下载文件能 quant-lab.org 上传成功

### 安全
- [ ] 用户 A 不能访问用户 B 的容器或数据
- [ ] 容器内代码无法联外网（除挂载好的数据卷）
- [ ] 容器内代码无法读写宿主机文件
- [ ] 容器超时被强制 kill
- [ ] 滥用检测：同一用户短时间提交多个任务被排队

### 商业
- [ ] 免费用户限额生效（5 次/月，5 分钟超时，1 年范围）
- [ ] 永续模式仅 Pro 可用，前端显示"升级 Pro"
- [ ] 系统降级时优先保 Pro 用户任务

---

## 11. 工作流交付

### Step 1: 本文档 → Claude Design

```
我有一个 BTC 量化交易网站 BTC Station，Phase 3.0 已上线
（部署在 [Vercel URL]）。现在做 Phase 3.1：Freqtrade 策略编辑器。

请：
1. 读 Phase 1-3.0 的 codebase（继承设计系统）
2. 读 Phase 3.1 实施策划书 v2.0（附件）
3. 产出以下高保真 mockup（全中文）：
   - /strategies/editor 主页面（Monaco 编辑器 + 右侧回测面板）
   - 模板选择下拉
   - 回测配置面板（含永续/现货切换、杠杆调整）
   - 回测进度状态（排队/启动/运行/完成/失败）
   - 完整回测结果展示（含永续合约独有指标）
   - 实时日志面板（折叠展开）
   - 永续模式 Pro 升级提示
   - 移动端布局（编辑器在移动端怎么处理）

要求：
- 全中文文案
- 深色主题延续
- Monaco Editor 主题与全站协调
- 永续合约相关 UI 要专业但不诱导
- 进度反馈要让用户"知道在干什么"，避免怀疑卡死
```

### Step 2: 策划 + 视觉 → Claude Code

```
为 BTC Station 实施 Phase 3.1。
- 项目现状：[GitHub 仓库]
- 实施策划书 v2.0：[本附件]
- 视觉设计：[Claude Design 输出]

按以下顺序实施：

阶段 A - 后端基础（5-7 天）：
1. FastAPI 项目脚手架，部署到 Railway 并通公网
2. Supabase JWT 验证集成
3. Docker 镜像构建（基于 freqtradeorg/freqtrade:stable）并推送 Railway
4. 历史数据下载脚本（一次性 + 定时增量）
5. Docker SDK 容器编排
6. Celery + Redis 任务队列
7. CSV 转换层（freqtrade JSON → 191 列）

阶段 B - 后端 API（2-3 天）：
8. 策略 CRUD API
9. 回测任务 API（POST / GET / WebSocket）
10. 6 个 Freqtrade IStrategy 模板内置

阶段 C - 前端（3-4 天）：
11. /strategies/editor 页面
12. Monaco Editor 集成 + IStrategy 类型补全
13. 模板下拉与加载
14. 回测配置面板
15. WebSocket 进度展示
16. 完整结果展示
17. CSV 下载

阶段 D - 验收（1 天）：
18. 安全测试（容器隔离、资源限额）
19. 性能测试（冷启动 / 6 个模板回测）
20. quant-lab.org 兼容性测试

每阶段完成告知我本地验证后再下一阶段。

特别注意：
- 容器安全是底线，宁可慢不可漏
- WebSocket 推送频率不要太高（避免后端压力）
- 永续合约的杠杆默认值固定为 1（保守）
- 滑点和资金费率用 Freqtrade 默认配置（精确）
```

---

## 12. 项目负责人实操清单

1. **本文档存好**，等 Phase 3.0 上线 + 用户反馈良好后启动
2. **Phase 3.0 完成时**回来找我，可能要根据真实用户反馈微调本文档
3. **启动 Phase 3.1 之前**：
   - 注册 Railway 账号
   - 在 Railway 创建项目并连 GitHub
   - 准备月费预算（$30-50/月）
4. **本文档丢给 Claude Design**，要求按 Step 1 出视觉
5. **审视觉**，反复迭代到满意
6. **策划 + 视觉打包给 Claude Code**，按 Step 2 阶段 A→D 执行
7. **每阶段本地验证**（按第 10 节验收清单）
8. **找 1-2 个有 Python 经验的朋友测试**，让他们写一个真实策略并跑回测
9. **Phase 3.1 验收通过后**，回来找我写 Phase 3.2 实施策划书（hyperopt 参数优化 + Pro 商业化前奏）

---

## 13. 风险清单

| 风险 | 缓解 |
|---|---|
| Railway 免费额度耗尽 | 监控 Dashboard；预算 $50/月 |
| Docker 容器逃逸 | gVisor 二级沙箱评估（Phase 3.1 末尾） |
| Freqtrade 版本升级破坏兼容 | 锁定 stable 版本，每月手动升级 |
| 用户写恶意代码 | 网络隔离 + 文件系统只读 + 资源限额 |
| 历史数据下载失败 | 多次重试 + 失败告警 |
| OKX 永续 pair 命名歧义 | 文档明确 `BTC/USDT:USDT`，前端隐藏内部命名 |
| 用户期望"立即出结果" | UI 用进度条 + 状态描述管理预期 |
| Monaco Editor 性能问题 | 限制单个策略文件 < 200 行，超出提示 |
| Pro 用户跑长任务挤占免费用户 | 任务队列分优先级 |
| WebSocket 连接不稳定 | 客户端自动重连 + 失败回退到轮询 |

---

## 14. Phase 3.1 上线后的关键指标（KPI）

跟踪以下指标，决定 Phase 3.2 启动节奏：

| 指标 | 关注阈值 |
|---|---|
| Phase 3.1 周活用户 | 至少 50（说明有需求） |
| 平均每用户每月回测次数 | 5+ |
| 永续模式使用率 | > 30%（验证永续是核心场景） |
| 升级 Pro 询问数 | > 10/月（说明可以启动 Phase 4） |
| 容器冷启动均值 | < 10 秒 |
| 任务失败率 | < 2% |
| 用户保留率（7 天） | > 40% |

如果这些指标达标，**直接启动 Phase 3.2**（参数优化 + Pro 订阅前奏）。
如果指标不达标，**回头优化 Phase 3.1**（可能是 UX 问题或速度问题）再推进。

---

**版本**：v2.0  
**关联文档**：BTC Station 大局路线图 v3.0、Phase 3.0 实施策划书 v1.0  
**下一份文档**：Phase 3.2 实施策划书（hyperopt 参数优化 + Pro 商业化前奏，届时编写）
