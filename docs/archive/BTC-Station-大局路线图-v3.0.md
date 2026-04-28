# BTC Station 大局路线图 v3.0

> **本文档用途**：项目整体战略蓝图，给项目负责人 + 研发团队提供"全局视角"。每个 Phase 详细策划在该 Phase 启动时另写。
>
> **版本**：v3.0（2026-04-25）
> **重大更新**：底层回测/实盘引擎从 `vectorbt` 全面切换为 **Freqtrade**
> **此前版本**：v2.0 已废弃

---

## 0. v3.0 相比 v2.0 的核心变化

### 0.1 一句话变化

**底层引擎**从"自研 + vectorbt"切换为"Freqtrade 包装层"。

### 0.2 影响范围

| 领域 | v2.0（已废弃） | **v3.0（当前）** |
|---|---|---|
| 回测引擎 | vectorbt | **Freqtrade backtesting 子命令** |
| 参数优化 | vectorbt + 5 种自研算法 | **Freqtrade hyperopt（贝叶斯智能优化）** |
| 策略沙箱 | E2B Sandbox | **Docker 容器（每用户一个 Freqtrade 实例）** |
| 模拟盘 | 自研常驻服务 | **Freqtrade dry-run 模式（开箱即用）** |
| 实盘 | 自研 OKX 对接 | **Freqtrade live trade（CCXT 100+ 交易所）** |
| AI/ML | 自研 BYOK | **FreqAI + BYOK** |
| Telegram 通知 | 不计划 | **Freqtrade 内置（送）** |
| Phase 6 工时 | 10-14 天 | **3-5 天** |
| Phase 7 工时 | 14-21 天 | **5-7 天** |
| Phase 3.2 性能 | 暴力穷举极速 | **贝叶斯智能优化（10 倍-30 倍速 vs TV）** |

### 0.3 不变的部分

- 产品定位、商业模式、Pro 价格 ¥99/月
- BYOK 模式
- TradingView 兼容 191 列 CSV 导出（用转换脚本实现）
- 全中文 UI、中文邮件
- Supabase 作为唯一 Auth + DB
- 不主动推广中国大陆策略
- 7 大铁律完全保留

---

## 1. 产品核心定位（v2.0 继承不变）

**专注 BTC 永续合约的量化工作台 — Python 策略 + 智能参数优化 + 一键模拟盘/实盘 + 完全 TradingView 兼容的 CSV 导出。**

### 与 v2.0 卖点的微调

| v2.0 卖点 | **v3.0 修订卖点** |
|---|---|
| "100 倍速度"（vectorbt 极致速度） | "**贝叶斯智能优化**——10 分钟跑出 TV 一周的工作量" |
| "0 错误率"（实测 TV 16.5%） | **保留**（Freqtrade 同样 0 错误率） |
| "零封号风险" | **保留** |
| "完全 CSV 兼容" | **保留**（写 Freqtrade JSON → 191 列 CSV 转换层） |
| "专注 BTC" | **保留** |

**v3.0 新增卖点**：
- **从研究到实盘一条龙**——同一份策略代码可跑回测、模拟盘、实盘，无需迁移
- **OKX 永续直连**——通过 Freqtrade 的 CCXT 集成原生支持
- **Telegram / WebUI 双管道通知**——Pro 用户标配

---

## 2. 七大铁律（保留 v2.0）

| # | 铁律 |
|---|---|
| 1 | 只做 BTC |
| 2 | 永续优先，现货次要 |
| 3 | CSV 191 列完整复刻 |
| 4 | **Freqtrade 作为唯一回测/实盘引擎**（v3.0 修订） |
| 5 | 不做交易所托管（API Key 仅存浏览器） |
| 6 | 不做投资助言 |
| 7 | quant-lab.org 不碰 |

---

## 3. 多租户 Freqtrade 架构（v3.0 核心创新）

Freqtrade 设计是**单机单用户**——一个 Freqtrade 进程对应一份配置 + 一份策略 + 一个交易所账号。要把它变成多用户 SaaS 的基础设施，必须解决进程隔离与资源调度。

### 3.1 架构图

```
┌──────────────────────────────────────────────────────────┐
│  BTC Station Web UI (Next.js)                             │
│  - 主页 / 图表 / 策略编辑器 / 回测结果可视化                  │
└──────────────────────────┬────────────────────────────────┘
                           │ REST + WebSocket
                           ↓
┌──────────────────────────────────────────────────────────┐
│  BTC Station 后端 (FastAPI)                               │
│  - 用户认证（与 Supabase JWT 集成）                          │
│  - Freqtrade 实例编排（启停/路由/限额）                       │
│  - 任务队列（Celery + Redis）                                │
│  - CSV 转换层（Freqtrade JSON → 191 列）                     │
└──────────────────────────┬────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ↓            ↓            ↓
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │User A    │ │User B    │ │User C    │
        │Freqtrade │ │Freqtrade │ │Freqtrade │
        │Container │ │Container │ │Container │
        └──────────┘ └──────────┘ └──────────┘
              │            │            │
              └────────────┴────────────┘
                           │
                           ↓
                    ┌─────────────┐
                    │ OKX (CCXT)  │
                    └─────────────┘
```

### 3.2 关键设计决策

#### 决策 1：每用户一个 Freqtrade Docker 容器

**为什么**：
- Freqtrade 进程隔离不好（共享数据库、端口冲突）
- Docker 容器开销小（< 100MB 内存）
- 用户被 ban 也不影响其他人
- 配置文件、策略文件、日志全部隔离

**实现**：
- 用 Docker SDK for Python 在 FastAPI 后端动态启停容器
- 每个容器命名为 `ft-{user_id}-{purpose}`（如 `ft-abc123-backtest` / `ft-abc123-live`）
- 容器内挂载用户专属 volume：`/data/users/{user_id}/`
- 容器对外暴露 Freqtrade REST API（端口动态分配）

#### 决策 2：实例生命周期管理

| 用途 | 启动时机 | 关闭时机 |
|---|---|---|
| 回测/Hyperopt | 任务提交 | 任务完成（自动） |
| 模拟盘 | 用户主动启动 | 用户主动关闭 / 24h 无操作 |
| 实盘 | 用户主动启动 | 用户主动关闭（Pro 用户可常驻） |

**资源限额**（按层级）：

| 资源 | 免费 | Pro |
|---|---|---|
| 单次回测最大持续时间 | 5 分钟 | 30 分钟 |
| 单次 hyperopt 最大 epoch | 200 | 5000 |
| 同时运行的模拟盘数量 | 1 | 5 |
| 同时运行的实盘数量 | 0 | 3 |
| 容器内存上限 | 512MB | 2GB |
| 容器 CPU 限制 | 0.5 核 | 2 核 |

#### 决策 3：策略代码安全

Freqtrade 用户写的 IStrategy 类**仍然是 Python 代码**，理论上能调用任意系统调用。Docker 隔离能挡住外部攻击，但要进一步：
- 容器禁用网络出站（除了 OKX API 域名白名单）
- 只读文件系统（除了 `/tmp` 和 `/data/{user_id}/`）
- Drop 危险 capabilities（`CAP_SYS_ADMIN` 等）
- gVisor / Kata Containers 二级沙箱（Phase 3.1 时评估）

### 3.3 部署成本估算

| 服务 | 月成本 |
|---|---|
| Vercel（前端） | 免费层 / Pro $20 |
| **后端服务器**（Railway/Fly.io，主 FastAPI 进程） | $20-30 |
| **Worker 集群**（跑用户容器，按用量） | **$50-150（动态）** |
| Supabase | 免费层（500 用户内） |
| Redis（任务队列） | $5（Railway 内置） |
| 域名 | $1（年付摊销） |
| **总计** | **$80-200/月** |

**与 v2.0 对比**：服务器成本上升约 50%，但**省掉了 Phase 6 + Phase 7 自研的 20-30 天工时**——一次性收益远大于持续成本。

---

## 4. Phase 路线图（v3.0 全面调整）

### Phase 1 ✅ 已完成
主页 + 资讯 + 简易图表

### Phase 2.1 ✅ 已完成
登录系统 + 完整图表页（精简版）

### Phase 2.2 ✅ 已完成
图表收尾 + 永续/现货切换 + 画线 + 扩充指标 + 多图表分屏

### Phase 3.0 — 简单策略与轻量回测（按原计划进行）

**重要**：这一阶段**不依赖 Freqtrade**，仍用客户端 JS 引擎做 6 个预设策略的回测。

为什么不一开始就用 Freqtrade？
- Freqtrade 启动一次容器约 5-10 秒，对"用户首次体验"太慢
- 6 个简单策略的回测在浏览器内完全够用（< 1 秒）
- 用户从"挑策略 → 点回测 → 看结果"全流程应该是丝滑的
- Phase 3.1 才引入 Freqtrade 处理用户自定义策略

**预计工时**：5-7 天（按 Phase 3.0 策划书 v1.0）

### Phase 3.1 — Freqtrade 策略编辑器与单次回测 ⭐架构关键关卡⭐

**核心新增**：
- 引入 Freqtrade 后端（每用户一个 Docker 容器）
- Monaco Editor 嵌入（写 IStrategy 类）
- Freqtrade 单次回测（精确永续模拟，含资金费率 + 杠杆 + 强平价）
- 完整 191 列 CSV 输出（Freqtrade JSON → 转换层）
- Phase 3.0 的 6 个策略转换为 IStrategy 类作为模板
- 多用户进程编排（FastAPI + Docker SDK）

**Phase 3.1 不做**：
- 参数优化（Phase 3.2）
- 模拟盘（Phase 6）
- 实盘（Phase 7）

**预计工时**：10-14 天（地基重，但收益持续到 Phase 7）

**详细见**：`Phase-3.1-实施策划书-v2.0.md`

### Phase 3.2 — Hyperopt 参数优化（Pro 核心商业价值）

**核心新增**：
- Freqtrade hyperopt 子命令封装为异步任务
- 优化算法：贝叶斯（默认）/ 随机 / 顺序（hyperopt 内置）
- 优化目标：14+ 损失函数（Sharpe / Sortino / Calmar / OnlyProfit / OmegaRatio 等）
- 实时进度推送（WebSocket）
- 结果表格 + 排序 + CSV 导出（191 列 TV 兼容）
- Pro 限额：5000 epoch / 50 次月

**预计工时**：7-10 天（不像 v2.0 的 14-21 天，因为 hyperopt 是现成的）

### Phase 3.3 — 优化结果可视化与 quant-lab.org 对接

**核心新增**：
- 2D 热力图、3D 曲面图、散点矩阵
- 帕累托前沿（多目标优化）
- "Top 10 参数组合" 卡片
- 一键导出最佳参数为 IStrategy 默认值
- 与 quant-lab.org 兼容性自检

**预计工时**：5-7 天

### Phase 4 — Stripe 订阅上线

**核心新增**：
- Stripe Checkout（Stripe Japan）
- 订阅页 `/pricing`
- Webhook → Supabase `profiles.plan` 同步
- Pro 功能锁
- 商业条款（特商法）
- 退款政策

**Pro 分级**（v3.0 调整）：

| 功能 | 免费 | Pro ¥99/月 |
|---|---|---|
| 主页 / 图表 / 资讯 | ✓ | ✓ |
| 简单策略库 + 浏览器内回测 | ✓ | ✓ |
| Freqtrade 策略编辑器 | ✓（限 3 策略） | ✓（无限） |
| 单次回测（Freqtrade） | 5 次/月 | 无限 |
| 永续合约精确回测 | ❌（仅近似） | ✓ |
| **Hyperopt 参数优化 epoch 上限** | 200 | **5000** |
| **Hyperopt 月配额** | 5 次 | **50 次** |
| 高级可视化 | ❌ | ✓ |
| 模拟盘并发数 | 1 | **5** |
| **实盘并发数** | **0** | **3** |
| Telegram 通知 | ❌ | ✓ |
| 优先任务队列 | ❌ | ✓ |
| FreqAI 机器学习 | ❌ | ✓ |

**为什么实盘留给 Pro**：实盘是产品最大风险点（用户真金白银），用 Pro 门槛过滤"严肃用户"，降低支持成本和合规风险。

**预计工时**：5-7 天

### Phase 5 — AI 分析（BYOK + FreqAI）

**核心新增**：
- 用户填 Claude / OpenAI API Key（Supabase 加密存储）
- 三个 AI 入口：
  1. **策略代码助手**：编辑器侧边栏 AI（写 IStrategy 时辅助）
  2. **回测报告解读**：跑完一键 AI 分析
  3. **Pine Script → IStrategy 转译**（杀手级功能）
- **FreqAI 集成**（Pro 专享）：
  - Freqtrade 内置的机器学习预测模块
  - 用户能让 AI 自动训练自适应策略
  - 模型类型：CatBoost / LightGBM / Reinforcement Learning

**预计工时**：7-10 天（v2.0 是 7-10 天，这次因为 FreqAI 现成所以同时间能做更多）

### Phase 6 — 模拟盘（Freqtrade dry-run 包装）

**核心简化**：
- Freqtrade dry-run 命令一行启动
- 用户从 Freqtrade 编辑器或简单策略一键 "上模拟盘"
- 实时持仓 / PnL（通过 Freqtrade REST API 拉取）
- WebSocket 推送实时信号
- "重置模拟盘"（删容器重建）

**预计工时**：3-5 天（v2.0 的 1/3 工时，省下来的就是 Freqtrade 的价值）

### Phase 7 — 真实交易所对接（Freqtrade live 包装）

**核心简化**：
- Freqtrade live 模式直接对接 OKX
- API Key 处理：用户在浏览器填，**经 BTC Station 后端加密透传到 Freqtrade 容器**（不持久化）
- 仍需用户每次开启签署"自愿承担风险"协议
- 实盘信号触发**仍可选用户手动确认**（Freqtrade 的 `forcebuy_enable` 配置）
- 实盘只对 Pro 用户开放

**法律 / 合规约束**（v2.0 继承）：
- 用户每次启用前签署电子协议
- 平台界面无推荐性语言
- API Key 不持久化（仅运行时存内存）
- 配套日本特商法 / TOS / 隐私政策

**预计工时**：5-7 天 + 法律咨询

### 总工时对比

| Phase | v2.0 工时 | **v3.0 工时** | 节省 |
|---|---|---|---|
| 3.1 | 7-10 天 | **10-14 天** | -4 天（架构重） |
| 3.2 | 14-21 天 | **7-10 天** | **+11 天** |
| 3.3 | 5-7 天 | 5-7 天 | 0 |
| 4 | 5-7 天 | 5-7 天 | 0 |
| 5 | 7-10 天 | 7-10 天 | 0 |
| 6 | 10-14 天 | **3-5 天** | **+9 天** |
| 7 | 14-21 天 | **5-7 天** | **+14 天** |
| **总计** | **62-90 天** | **42-60 天** | **+30 天** |

**v3.0 比 v2.0 节省 30 天工时**——这是从 v2.0 改 v3.0 最大的具体收益。

---

## 5. 技术栈最终全景（v3.0）

| 层 | 技术 | 引入 Phase |
|---|---|---|
| 前端框架 | Next.js 14/15 + TypeScript + Tailwind | Phase 1 ✅ |
| 图表 | TradingView Lightweight Charts | Phase 1 ✅ |
| Auth + DB | Supabase | Phase 2.1 ✅ |
| 部署（前端） | Vercel | Phase 1 ✅ |
| 数据源（行情） | OKX 公共 API | Phase 1 ✅ |
| 客户端缓存 | IndexedDB | Phase 3.0 |
| 客户端简易回测 | 自研 JS 引擎 | Phase 3.0 |
| 代码编辑器 | Monaco Editor | Phase 3.1 |
| **回测/优化/实盘** | **Freqtrade + Docker** | **Phase 3.1+** |
| 后端 API | FastAPI | Phase 3.1 |
| 容器编排 | Docker SDK for Python | Phase 3.1 |
| 任务队列 | Celery + Redis | Phase 3.2 |
| 后端部署 | Railway 或 Fly.io | Phase 3.1 |
| 可视化 | Plotly + D3 | Phase 3.3 |
| 支付 | Stripe（Japan） | Phase 4 |
| AI | Claude / OpenAI（BYOK） + FreqAI | Phase 5 |

---

## 6. 决策日志（v3.0）

### ✅ 已锁定

- 只做 BTC，永续优先
- 邮箱+密码 + Google OAuth 登录
- Supabase 作为唯一 DB
- OKX 作为唯一行情源
- **Freqtrade 作为唯一回测/实盘引擎**
- **Docker 容器作为多租户隔离方案**
- 191 列 CSV 完整复刻
- 中文 UI（不搭 i18n）
- Pro ¥99/月单档
- BYOK + FreqAI 模式做 AI 接入
- 不主动推广大陆但不封 IP

### ⏳ 仍开放

- 后端部署 Railway 还是 Fly.io（Phase 3.1 启动时根据延迟和价格对比）
- Docker 容器是否加 gVisor/Kata 二级沙箱（Phase 3.1 评估安全 vs 性能权衡）
- Stripe 订阅是月付还是年付（Phase 4 上线时根据用户调研）
- FreqAI 是默认开启还是按需（Phase 5 评估资源开销）
- Phase 7 实盘是否上线（看 Phase 6 模拟盘 3-6 个月反馈）

### ❌ 已废弃（v2.0 → v3.0）

- ~~vectorbt 回测引擎~~ → 改用 Freqtrade
- ~~E2B Sandbox~~ → 改用 Docker
- ~~5 种自研优化算法~~ → 用 Freqtrade hyperopt 内置（贝叶斯/随机/顺序）
- ~~自研模拟盘常驻服务~~ → Freqtrade dry-run
- ~~自研 OKX 实盘对接~~ → Freqtrade live (CCXT)

---

## 附录 A：永续合约风险披露文案模板（v2.0 继承）

```
⚠️ 永续合约高风险提示

您正在使用涉及永续合约的功能。永续合约具有以下风险：

1. 杠杆放大效应：永续合约带杠杆交易，盈亏会被放大数倍至数十倍
2. 爆仓风险：保证金不足时，仓位将被强制平仓，可能导致本金归零
3. 资金费率波动：每 8 小时收取的资金费率可能侵蚀利润
4. 极端行情风险：BTC 价格剧烈波动时，止损可能滑点甚至失效
5. 24 小时不间断：市场全天交易，深夜可能发生重大行情

本平台仅为分析与回测工具，不构成投资建议。所有策略结果为历史模拟，
不代表未来收益。所有交易决策与盈亏由用户自行承担。

我已阅读并理解上述风险，自愿承担一切后果。 [ ] 同意并继续
```

---

## 附录 B：Freqtrade 回测指标 → 191 列 CSV 字段映射（核心 30 列）

> 完整映射表在 Phase 3.1 启动时编写 `freqtrade-to-tv-csv-mapping.md`。

| Freqtrade JSON 字段 | TV 列名 |
|---|---|
| `total_profit_abs` | `Total P&L` |
| `total_profit_percent` | `Total P&L %` |
| `max_drawdown_abs` | `Max equity drawdown` |
| `max_drawdown_percent` | `Max equity drawdown %` |
| `total_trades` | `Total trades` |
| `winrate * 100` | `Profitable trades ratio` |
| `profit_factor` | `Profit factor` |
| `starting_balance` | `Initial capital` |
| `pair_summary[*].profit_total` | `Net P&L: All` |
| `wins` | `Winning trades: All` |
| `losses` | `Losing trades: All` |
| `holding_avg` | `Avg # bars in trades: All` |
| `total_volume` | `Buy & hold return` |
| `cagr` | `Annualized return (CAGR): All` |
| `sharpe` | `Sharpe ratio` |
| `sortino` | `Sortino ratio` |
| `calmar` | （TV 无对应，舍弃） |
| `expectancy` | `Expected payoff: All` |
| `trades[*].profit_abs (max)` | `Largest winning trade: All` |
| `trades[*].profit_abs (min)` | `Largest losing trade: All` |
| `(自定义计算) trades 多头子集` | `Net P&L: Long` |
| `(自定义计算) trades 空头子集` | `Net P&L: Short` |

注：v2.0 的 v2.0 191 列字段表完全适用，v3.0 只是数据来源从 vectorbt 输出改为 Freqtrade JSON。

---

## 附录 C：CSV 兼容性自检清单（Phase 3.2 末尾使用）

每次 Freqtrade 任务完成后，转换层输出 CSV 时自动校验：

- [ ] 总列数 = 141 指标 + 4 元数据 + N 参数
- [ ] 表头第一列必须是 `Total P&L`
- [ ] 所有 `: All` / `: Long` / `: Short` 三联组完整（多头空头分别从 trades 数组按 `is_short` 字段分组计算）
- [ ] `_setTime_`、`_parseTime_`、`_duration_`、`comment` 四列存在且顺序正确
- [ ] 参数列全部以 `__` 开头
- [ ] 数值列无非数字字符
- [ ] 编码 UTF-8 with BOM
- [ ] 行尾 `\n`
- [ ] 千分位逗号问题处理

通过自检后，自动尝试用 `pandas.read_csv()` 反向加载验证。失败则任务标记为"格式错误"。

---

## 7. 项目里程碑时间线（v3.0 调整版）

| 月份 | 里程碑 |
|---|---|
| 2026-04 ✅ | Phase 1 + 2.1 + 2.2 上线 |
| 2026-05 | Phase 3.0（简单策略库 + 客户端回测） |
| **2026-06** | **Phase 3.1（Freqtrade 编辑器，地基关卡）** |
| 2026-07 | Phase 3.2 + 3.3（hyperopt 参数优化 + 可视化） |
| **2026-08** | **Phase 4（Pro 订阅上线，开始收钱）** |
| 2026-09 | Phase 5（AI BYOK + FreqAI） |
| 2026-10 | Phase 6（模拟盘） |
| 2026-11 | Phase 7（实盘评估 / 上线） |

实际进度可能延后 30-50%，**关键里程碑是 2026-08 Pro 订阅上线**——那一天起项目从"投入"转为"收入"。

---

**版本历史**
- v1.0（2026-04-22） — 早期路线图，定位现货分析平台
- v2.0（2026-04-25） — CSV 逆向工程后大幅修订，定位永续工作台 + vectorbt 引擎
- **v3.0（2026-04-25 当前）** — Freqtrade 全面替换 vectorbt，多租户 Docker 架构
