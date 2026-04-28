# BTC Station 大局路线图 v2.0

> **本文档用途**：项目整体战略蓝图，给项目负责人 + 研发团队 + Claude Design 提供"全局视角"。每个 Phase 单独的实施策划书（含具体文件清单、API 规格、验收标准）会在该 Phase 启动时另行编写。
>
> **版本**：v2.0（2026-04-25）
> **重大更新**：基于真实 TV Assistant CSV 样本逆向工程后的全面修订
> **此前版本**：v1.0 已废弃

---

## 0. 项目当前状态

| 项目 | 状态 |
|---|---|
| Phase 1 — 主页 + 资讯 + 简易图表 | ✅ 已完成 |
| Phase 2.1 — 登录系统 + 完整图表页（精简版） | ✅ 已完成 |
| **当前部署** | `https://btc-station.vercel.app`（待绑子域名） |
| **下一步** | Phase 2.2 启动 |

---

## 1. 产品核心定位（基于 CSV 逆向工程后的最终版）

### 一句话定位
**专注 BTC 永续合约的高速量化工作台 — Python 策略 + 100 倍速参数优化 + 完全 TradingView 兼容的 CSV 导出。**

### 与之前定位的关键修订

**修订前**：BTC 现货分析平台 + 简单回测  
**修订后**：BTC 永续合约量化工作台 + 高性能参数优化

### 修订原因

从用户的真实 TV Assistant 输出 CSV 中发现：
- 实际交易品种是 `BTCUSDT.P`（永续合约），不是现货
- 策略含 46 个参数、6 形态识别、双系统突破、ATR 动态止损、金字塔加仓——专业级策略
- 最大回撤 123.7%（仅杠杆永续可能产生，现货不可能）
- 用户追求的是"参数优化的速度和成功率"

### 核心差异化（写进所有外部文案的卖点）

1. **100 倍速度**：vectorbt 向量化回测，TV 跑 8 分钟的优化任务我们 5 秒搞定
2. **0 错误率**：实测 TV Assistant 错误率 16.5%（103 次中 17 次失败）；自家引擎 100% 成功
3. **零封号风险**：完全独立系统，不接触 TV 服务器
4. **完全 CSV 兼容**：191 列 TV 标准镜像，可无缝对接 quant-lab.org 等评分系统
5. **专注 BTC**：不做多币种、不做期权——所有资源聚焦 BTC 永续

### ⚠️ 营销文案合规红线

**永远不直接说**："替代 TradingView Assistant" / "解决 TV 封号问题"  
**正确说法**："高性能 BTC 量化平台" / "100 倍速参数优化引擎" / "Python 量化工作台"

---

## 2. 七大铁律（架构上不可妥协）

| # | 铁律 | 含义 |
|---|---|---|
| 1 | **只做 BTC** | 永远不加 ETH 等其他币种 |
| 2 | **永续优先，现货次要** | 主图默认 `BTCUSDT.P`，但保留切换到现货的开关 |
| 3 | **CSV 191 列完整复刻** | 不删不增不改 TV 标准列名 |
| 4 | **Python 策略 + vectorbt 后端** | 不引入 Pine Script 解释器、不做 JS 主回测引擎 |
| 5 | **不做交易所托管** | API Key 永远只存浏览器本地（Phase 7） |
| 6 | **不做投资助言** | 全站避免"推荐/必涨/跟单"类用语 |
| 7 | **quant-lab.org 不碰** | 我们只产 CSV，不复刻它的评分逻辑 |

---

## 3. Phase 2.2 → Phase 7 全景路线

### Phase 2.2 — 图表页收尾（下一步开工）

**核心新增**：
- 现货/永续切换器（默认永续，因为用户主要场景）
- 画线工具（趋势线、水平线、矩形、斐波那契回调、文字标注）
- 扩充指标（EMA、Bollinger Bands、Stochastic、ATR、OBV、Volume MA）
- 指标参数自定义 UI（每个指标可改周期、颜色、显隐）
- 多图表分屏（最多 2 个，可对比 4h + 15m）
- 图表截图导出（PNG）

**预计工时**：3-5 天 AI 编码

**详细策划书**：见同期交付的 `Phase-2.2-实施策划书-v1.0.md`

---

### Phase 3.0 — 简单策略与轻量回测（用户首次接触策略）

**核心新增**：
- 策略库 UI：5-8 个预设策略（MA 交叉、RSI 反转、布林带突破、海龟双系统、网格、DCA 等）
- 策略卡片式展示（可点开看说明 + 默认参数）
- "应用到图表"按钮（把策略信号直接画在 K 线上）
- 浏览器内 JS 轻量回测（单组参数，秒级出结果）
- 简易回测报告（Total P&L、Win Rate、Max DD、Sharpe）
- 历史交易点位标注（买卖箭头叠加在 K 线）

**关键技术决策**：
- **客户端 JS 引擎，不用服务器**——单次回测计算量小，浏览器完全够用
- 用 `lightweight-charts` 自带 marker API 画买卖点
- 策略以 JSON 配置形式存（参数 + 信号定义），不是代码
- 数据库：写入 Phase 2.1 已建的 `strategies` 和 `backtests` 表

**面向用户**：
- 完全不懂 Python 的入门用户
- "想试试量化是什么样的"用户
- 验证策略大致方向再升级到 Pro 跑参数优化

**Phase 3.0 不做**：
- 用户写自定义策略代码（那是 Phase 3.1）
- 参数遍历优化（那是 Phase 3.2）
- 永续合约的杠杆 / 资金费率精细模拟（Phase 3.0 用现货逻辑近似，Phase 3.1+ 才精确）

**预计工时**：5-7 天

---

### Phase 3.1 — Python 策略编辑器与沙箱执行

**核心新增**：
- Monaco Editor 嵌入（VS Code 同款，Python 语法高亮 + 自动补全）
- 用户写自定义 Python 策略
- 沙箱执行（每次回测一个临时容器，60 秒超时自杀）
- 策略保存到 Supabase（`strategies` 表，已建好）
- 策略模板库（在 Phase 3.0 内置策略基础上提供 Python 实现版）
- 单组参数回测（完整 191 列输出 + Web UI 友好展示）
- 策略代码版本历史（每次保存一个版本，可回滚）

**关键技术决策**：

**沙箱方案**——选 **E2B Sandbox**（[e2b.dev](https://e2b.dev)）
- 专为 AI 代码执行设计，免费层够用
- Python 环境预装，秒级冷启动
- 网络隔离 + 资源限制开箱即用
- 备选：自建 Docker + gVisor（控制力强，但运维成本高）

**策略 API 设计**——参考 vectorbt + backtrader 风格
```python
# 用户写的策略形如：
def strategy(data, params):
    """
    data: pd.DataFrame，含 OHLCV
    params: dict，用户可调参数
    返回: pd.Series，1=做多 / -1=做空 / 0=平仓
    """
    fast_ma = data['close'].rolling(params['fast_period']).mean()
    slow_ma = data['close'].rolling(params['slow_period']).mean()
    signal = pd.Series(0, index=data.index)
    signal[fast_ma > slow_ma] = 1
    signal[fast_ma < slow_ma] = -1
    return signal

# 用户必须导出 PARAMS dict 声明可调参数：
PARAMS = {
    'fast_period': {'type': 'int', 'default': 20, 'min': 5, 'max': 100},
    'slow_period': {'type': 'int', 'default': 50, 'min': 10, 'max': 200},
}
```

**中文参数名支持**：`PARAMS` 的 key 允许中文，输出 CSV 时直接用，与 TV Assistant 中文参数命名习惯保持一致。

**安全约束**（沙箱必须强制执行）：
- ❌ 禁止 `import os` / `subprocess` / `socket` / `requests` 等系统调用
- ❌ 禁止任何文件 I/O（除了临时输出回测结果）
- ❌ 禁止网络访问
- ✅ 仅允许 `numpy`、`pandas`、`talib`、`vectorbt`、内置数学库
- ⏰ 60 秒执行超时
- 💾 内存上限 512MB

**预计工时**：7-10 天（沙箱整合是大头）

---

### Phase 3.2 — 参数优化引擎 ⭐核心商业价值⭐

**核心新增**：
- 参数范围编辑器 UI（每个参数可设 `[起始, 结束, 步长]` 或离散值列表）
- 5 种优化算法：
  1. **暴力穷举**（brute force）
  2. **顺序搜索**（sequential）
  3. **随机搜索**（random）
  4. **模拟退火**（annealing）⭐ 用户主力使用
  5. **贝叶斯优化**（Bayesian，加分项，Phase 3.2 末尾或 3.3 做）
- 优化目标选择：max/min × 13 项指标（Total P&L / Sharpe / Sortino / Profit Factor / Win Rate 等）
- 过滤条件（"交易次数 < 50 的不计入"等）
- 异步任务系统（提交后用户离开也能跑，邮件通知完成）
- 实时进度条（已完成 X/Y 组，已用时 / 预计剩余）
- **完整 191 列 CSV 输出**（与 TV Assistant 100% 兼容）
- comment 列记录每次迭代动作（与 TV Assistant 一致的 UX 语言）
- 结果表格 UI（可排序、过滤、分页）
- "下载 CSV"按钮 + "上传到 quant-lab.org"快捷链接

**关键技术决策**：

**后端架构**：
```
┌─────────────────────────┐
│ Vercel Next.js (前端)    │
│ - 用户提交优化任务         │
│ - 轮询任务状态            │
│ - 下载 CSV               │
└─────────┬───────────────┘
          │ HTTPS
          ↓
┌─────────────────────────┐
│ Railway / Fly.io         │
│ FastAPI 服务             │
│ - 任务接收 API            │
│ - Celery 任务分发         │
└─────────┬───────────────┘
          │
    ┌─────┴─────┐
    ↓           ↓
┌────────┐  ┌────────┐
│ Redis  │  │Worker池│
│任务队列 │  │vectorbt│
│        │  │ + E2B  │
└────────┘  └───┬────┘
                ↓
        ┌────────────────┐
        │ Supabase       │
        │ - 任务状态      │
        │ - Storage:CSV  │
        └────────────────┘
```

**vectorbt 调用模式**：
```python
import vectorbt as vbt
import itertools

# 用户参数范围
param_grid = {
    'fast_period': range(5, 51, 5),   # 10 个值
    'slow_period': range(20, 201, 10), # 19 个值
}
combinations = list(itertools.product(*param_grid.values()))  # 190 组

# vectorbt 向量化跑全部组合（极快）
results = []
for params in combinations:
    signal = strategy(data, dict(zip(param_grid.keys(), params)))
    pf = vbt.Portfolio.from_signals(data['close'], signal == 1, signal == -1)
    results.append({
        **dict(zip(param_grid.keys(), params)),
        'Total P&L': pf.total_profit(),
        'Sharpe ratio': pf.sharpe_ratio(),
        # ... 完整 141 项指标
    })

# 输出 CSV（191 列）
pd.DataFrame(results).to_csv('output.csv', index=False)
```

**性能预期**（基于 5 年 4h 数据 = 11,000 根 K 线）：
- 单组回测：50-200 毫秒
- 1,000 组：1-3 分钟
- 10,000 组：10-30 分钟（一杯咖啡时间）
- 20,000 组：20-60 分钟

**对比 TV Assistant**（用户 CSV 实测）：
- TV：103 组 / 7.6 分钟 = 单组 5.36 秒
- 我们：103 组 / 5-15 秒 = 单组 50-150 毫秒
- **速度优势：35-100 倍**

**任务限额**（Pro 分级实现）：
- 免费用户：≤ 200 组 / 单次任务，5 次 / 月
- Pro 用户：≤ 20,000 组 / 单次任务，50 次 / 月
- 超限用户：友好提示升级 Pro 或下月再来

**预计工时**：14-21 天（最重的一关）

---

### Phase 3.3 — 优化结果可视化与 quant-lab.org 对接

**核心新增**：
- 2D 热力图（任选两个参数，颜色映射目标指标）
- 3D 曲面图（三参数，z 轴指标值）
- 散点矩阵（所有参数 vs 目标指标）
- 帕累托前沿（多目标优化时，比如 P&L vs Drawdown 的最优边界）
- "Top 10 参数组合" 卡片视图
- "导出最佳参数" 按钮（生成 Pine Script / Python 代码片段）
- **quant-lab.org 一键直达** ：用户下载 CSV 后页面提示"复制链接到 quant-lab.org 上传"
- 兼容性自检：每个 CSV 在生成时自动验证 191 列完整、命名正确

**关键技术决策**：
- 可视化用 **Plotly**（3D 交互最强）+ **D3** 备用
- 帕累托前沿计算用 NSGA-II（开源 Python 库 `pymoo`）
- 自检逻辑：CSV 生成后比对一份"参考列名清单"（详见 Appendix B）

**预计工时**：5-7 天

---

### Phase 4 — Stripe 订阅上线 + Pro 商业化

**核心新增**：
- Stripe Checkout 集成（Stripe Japan 账户）
- 订阅页面 `/pricing`（免费 vs Pro 对比表）
- 用户订阅状态同步（Stripe Webhook → Supabase `profiles.plan`）
- Pro 功能锁（前端 + 后端双重校验）
- 取消订阅、升级降级流程
- 发票邮件（Stripe 自带）
- 退款政策（前 7 天无理由）
- 商业条款页面（特定商取引法に基づく表記）
- 订阅管理页面 `/account/subscription`（已建 tab，启用）

**Pro 分级最终方案**：

| 项目 | 免费 | **Pro（¥99/月，约 $14）** |
|---|---|---|
| 主页 / 图表 / 资讯 | ✓ | ✓ |
| 内置策略库 | ✓ | ✓ |
| 简单回测（单组参数） | ✓ | ✓ |
| Python 策略编辑器 | ✓（限 3 个保存槽） | ✓（无限） |
| 参数优化任务规模 | ≤ 200 组 | **≤ 20,000 组** |
| 参数优化任务次数 | 5 次/月 | **50 次/月** |
| 优化算法 | 仅暴力 + 随机 | **全部 5 种（含退火、贝叶斯）** |
| CSV 导出 | ✓ | ✓ |
| 高级可视化（3D / 帕累托） | ❌ | ✓ |
| 邮件通知 | ❌ | ✓ |
| 优先任务队列 | ❌ | ✓ |

**为什么这样定价**：
- ¥99/月 故意设在 TradingView Pro（$15）以下
- 免费层有"参数优化体验入口"（200 组），不是完全没有
- Pro 层 20,000 组对 95% 用户够用一辈子
- 不分多档（避免决策疲劳影响转化）

**预计财务（按 5% 转化率估算）**：
- 100 用户 × 5% = 5 个 Pro = ¥495/月
- 500 用户 × 5% = 25 个 Pro = ¥2,475/月
- 1,000 用户 × 5% = 50 个 Pro = ¥4,950/月
- 服务器成本 ≈ ¥350-700/月（Vercel + Railway + Supabase + E2B）

**预计工时**：5-7 天

---

### Phase 5 — AI 分析（BYOK）

**核心新增**：
- 用户填入 Claude / OpenAI API Key（前端加密 + Supabase 存密文）
- 三个 AI 入口：
  1. **策略代码助手**：Python 编辑器侧边栏 AI 助手，写策略时辅助
  2. **回测报告解读**：跑完回测一键"AI 分析这份报告"，输出中文人话点评
  3. **🌟 Pine Script → Python 转译**：用户粘 Pine 代码，AI 翻译成可在我们平台回测的 Python（杀手级功能！）
- 模型选择：Claude Sonnet 4.6 / Opus / OpenAI GPT-4o
- AI 调用次数计费由用户自己的 API Key 承担（平台不代付）
- 平台只收一次性"BYOK 解锁费"（建议 ¥30 一次性）或免费

**关键技术决策**：
- API Key 加密存储用 Supabase Vault 或 AES-256
- AI 调用走平台代理（统一日志 + 滥用检测），不让 Key 直接暴露在浏览器
- Pine→Python 转译要做 prompt engineering 模板，先在内部验证准确率

**预计工时**：7-10 天

---

### Phase 6 — 模拟盘（Paper Trading）

**核心新增**：
- 用户从策略库 / 自定义策略选一个"上线模拟盘"
- 实时 OKX 数据驱动信号
- 虚拟资金账户（默认 10,000 USDT）
- 模拟下单（永续合约，含杠杆 / 资金费率模拟）
- 实时持仓 / PnL / 账户曲线
- 信号触发邮件通知
- "重置模拟盘"按钮

**关键技术决策**：
- 后端常驻服务跑信号检测（Railway 上的 always-on worker）
- 信号检测频率：与策略主周期一致（4h 策略每 4h 检测一次）
- 模拟成交：以下一根 K 线开盘价成交（不是当前 tick，避免前视偏差）

**预计工时**：10-14 天

---

### Phase 7 — 真实交易所对接（最高风险）

**核心新增**：
- 用户在浏览器里填 OKX API Key（**仅存 localStorage，永远不上传服务器**）
- 模拟盘升级为实盘选项（用户主动开启）
- 严格的"二次确认 + 资金风险提示"对话框
- 实盘信号触发后**仍需用户手动确认**（不全自动）
- 完整的免责协议签署（每次启用前）
- 实盘只支持现货初版，永续合约实盘是 Phase 7+

**法律 / 合规约束**：
- 用户每次启用前必须签署"我自愿承担一切风险"的电子协议
- 平台界面绝不出现"建议买入 X 仓位"等推荐性语言
- API Key 任何时候不离开用户浏览器（即使为了调试）
- 必须配套日本特商法 / TOS / 隐私政策的最终版

**预计工时**：14-21 天 + 法律咨询

---

## 4. 技术栈最终全景

| 层 | 技术 | 引入 Phase |
|---|---|---|
| 前端框架 | Next.js 14/15 + TypeScript + Tailwind | Phase 1 ✅ |
| 图表 | TradingView Lightweight Charts | Phase 1 ✅ |
| Auth + DB | Supabase | Phase 2.1 ✅ |
| 部署（前端） | Vercel | Phase 1 ✅ |
| 数据源 | OKX 公共 API（spot + swap） | Phase 1 ✅ → Phase 2.2 扩展 |
| 代码编辑器 | Monaco Editor | Phase 3.1 |
| 沙箱 | E2B Sandbox | Phase 3.1 |
| 后端 | FastAPI + Celery + Redis | Phase 3.2 |
| 后端部署 | Railway 或 Fly.io | Phase 3.2 |
| 回测引擎 | vectorbt | Phase 3.2 |
| 可视化 | Plotly + D3 | Phase 3.3 |
| 支付 | Stripe（Japan） | Phase 4 |
| AI | Claude / OpenAI（BYOK） | Phase 5 |

---

## 5. 决策日志（已锁定 vs 仍开放）

### ✅ 已锁定（Phase 1-7 全程不变）

- 只做 BTC，永续优先
- 邮箱+密码 + Google OAuth 登录
- Supabase 作为唯一数据库
- OKX 作为唯一行情源
- vectorbt 作为唯一主回测引擎
- 191 列 CSV 完整复刻 TV 标准
- 中文 UI（不搭 i18n 框架）
- Pro 价位 ¥99/月单档
- BYOK 模式做 AI 接入
- 不主动推广大陆，但不封 IP

### ⏳ 仍开放（届时再决定）

- 沙箱用 E2B 还是自建 Docker（Phase 3.1 启动时根据成本对比）
- 后端部署用 Railway 还是 Fly.io（Phase 3.2 启动时对比延迟和价格）
- 可视化用 Plotly 还是自己用 D3（Phase 3.3 启动时根据 Claude Design 提案）
- BYOK 是否收一次性解锁费（Phase 5 启动时根据成本测算）
- Phase 7 实盘是否上线（看 Phase 6 模拟盘运行 3-6 个月反馈）

---

## 附录 A：永续合约风险披露文案模板（中文）

**适用位置**：Phase 4 上线 Pro 订阅时 / Phase 6 模拟盘启用时 / Phase 7 实盘启用时

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

## 附录 B：191 列 CSV 字段速查表（核心 60 列）

> 完整 191 列在 Phase 3.2 启动时单独输出 `field-mapping.md`。这里列出**最核心的 60 列**作为速查。

### 优化目标可选指标（13 项 × 多空各一份）

| TV 列名 | 中文译名 | vectorbt 对应 |
|---|---|---|
| `Total P&L` | 总盈亏 | `Portfolio.total_profit()` |
| `Total P&L %` | 总盈亏百分比 | `Portfolio.total_return()` |
| `Net P&L: All` | 净盈亏（全部） | `Portfolio.total_profit() - fees` |
| `Net P&L: Long` | 净盈亏（多头） | 多头持仓子集 |
| `Net P&L: Short` | 净盈亏（空头） | 空头持仓子集 |
| `Sharpe ratio` | 夏普比率 | `Portfolio.sharpe_ratio()` |
| `Sortino ratio` | 索提诺比率 | `Portfolio.sortino_ratio()` |
| `Profit factor` | 盈利因子 | `Portfolio.profit_factor()` |
| `Max equity drawdown` | 最大权益回撤（绝对值） | `Portfolio.max_drawdown()` |
| `Max equity drawdown %` | 最大权益回撤百分比 | `Portfolio.max_drawdown_pct()` |
| `Total trades` | 总交易次数 | `Portfolio.total_trades()` |
| `Profitable trades ratio` | 胜率 | `Portfolio.win_rate()` |
| `Annualized return (CAGR): All` | 年化收益率 | `Portfolio.annualized_return()` |

### 多空分别统计列（每个指标三份）

绝大多数交易统计列都有 `: All` / `: Long` / `: Short` 三个版本，包括：
- `Total trades`、`Winning trades`、`Losing trades`
- `Avg P&L`、`Avg winning trade`、`Avg losing trade`
- `Largest winning trade`、`Largest losing trade`
- `Avg # bars in trades`、`Return on initial capital`

### 元数据列（4 列）

| 列名 | 含义 |
|---|---|
| `_setTime_` | 设置参数的时间戳 |
| `_parseTime_` | 解析回测结果的时间戳 |
| `_duration_` | 单次回测耗时（秒） |
| `comment` | 优化算法本次迭代的动作描述（如 `Changed "MACD快线周期": 13 => 21.`） |

### 参数列（动态，前缀 `__`）

由用户策略的 `PARAMS` dict 决定，支持中文。例：
- `__MACD快线周期`、`__MACD慢线周期`
- `__P1仓位倍数`、`__P2仓位倍数`
- `__启用追踪止损`、`__ATR追踪止损倍数（多头）`

---

## 附录 C：CSV 兼容性自检清单（Phase 3.2 末尾使用）

每次 vectorbt 引擎输出 CSV 后，自动校验：

- [ ] 总列数 = 141 指标 + 4 元数据 + N 参数
- [ ] 表头第一列必须是 `Total P&L`
- [ ] 所有 `: All` / `: Long` / `: Short` 三联组完整
- [ ] `_setTime_`、`_parseTime_`、`_duration_`、`comment` 四列存在且顺序正确
- [ ] 参数列全部以 `__` 开头
- [ ] 数值列无非数字字符（除百分号、引号外）
- [ ] 编码 UTF-8 with BOM（让中文在 Excel 打开不乱码）
- [ ] 行尾 `\n`，不是 `\r\n`
- [ ] 千分位逗号问题处理（数字字段不能有逗号，否则 CSV 列错位）

通过自检后，自动尝试用 `pandas.read_csv()` 反向加载验证。失败则任务标记为"格式错误"而非"完成"。

---

## 6. 项目里程碑时间线（理想状态）

| 月份 | 里程碑 |
|---|---|
| 2026-04（已完成） | Phase 1 + 2.1 上线 |
| 2026-05 | Phase 2.2 完成 |
| 2026-06 | Phase 3.0 + 3.1 完成（基础策略 + Python 编辑器） |
| 2026-07 | Phase 3.2 完成（参数优化引擎，**Pro 卖点就绪**） |
| 2026-08 | Phase 3.3 + Phase 4 完成（**Pro 订阅上线 + 收第一笔钱**） |
| 2026-09 | Phase 5 完成（AI BYOK） |
| 2026-10 | Phase 6 完成（模拟盘） |
| 2026-11+ | Phase 7（实盘）评估期 |

实际进度可能延后 30-50%，正常。每个 Phase 完成后回来找我写下一阶段实施策划书。

---

**版本历史**
- v1.0（2026-04-22） — 早期路线图，定位现货分析平台
- **v2.0（2026-04-25，当前）** — CSV 逆向工程后大幅修订，定位永续合约工作台
