# BTC Station — 项目文档

## 项目概述

专注比特币的量化研究网站，帮助用户判断 BTC 适合做长线还是短线，并提供策略编写、回测、参数优化与稳健性分析全链路工具。

**导航：首页 · 分析 · 图表 · 策略 · 报告**

## 技术栈

| 层       | 技术                                                           |
| -------- | -------------------------------------------------------------- |
| 前端框架 | Next.js 15 + React 19 + TypeScript                             |
| 图表     | Lightweight Charts v5（K线/成交量）+ Plotly.js（资金曲线/散点图） |
| 回测引擎 | VectorBT（内存运算，无状态）                                   |
| 后端     | FastAPI (Python) + Uvicorn                                     |
| 数据源   | OKX 公共 API（通过 CCXT）                                      |
| 稳健性分析 | 内置于报告页（移植自 quant-lab.org）                          |

## 启动命令

> ⚠️ **两个服务都必须启动**，前端通过 `/py-api/` 代理所有策略/回测请求到后端。后端未运行时，策略回测会报 500 错误。

```bash
# 1. 启动后端（端口 8000）
cd "C:\Users\GAKU\Desktop\BTC Tradingview assistant\backend"
.\venv\Scripts\python.exe main.py

# 2. 启动前端（端口 3000）
cd "C:\Users\GAKU\Desktop\BTC Tradingview assistant\btc-station"
npm run dev
```

**验证后端是否正常：**
```bash
curl http://localhost:8000/api/templates
# 应返回 6 个内置策略列表
```

---

## 架构概览

```
前端 (Next.js :3000)
  ├── /                         首页：行情 + 资讯
  ├── /analysis                 分析页：长线/短线胜率
  ├── /chart                    图表页：K线 + 回测 + 调参（核心页面）
  ├── /strategy                 策略页：Monaco 编辑器 + K线 + 回测 + 调参
  └── /report                   报告页：稳健性分析 + 参数排名
        │
        │  /py-api/* (Next.js rewrite)
        ▼
后端 (FastAPI :8000)
  ├── /api/templates             内置策略模板列表
  ├── /api/templates/{id}/code   获取策略源码
  ├── /api/backtest/dynamic      即时回测（无需登录）
  ├── /api/optimize              网格搜索参数优化
  ├── /api/candles/{tf}          本地缓存的历史K线
  └── /api/strategies            用户自定义策略 CRUD（需 Supabase）
```

---

## 功能模块

### [1] 首页 — 比特币资讯与行情
**路径：** `btc-station/app/page.tsx`

- BTC/USDT 实时价格（OKX 数据源）
- 24h 最高/最低/成交量
- BTC 相关新闻
- 迷你 K 线图

---

### [2] 分析页 — BTC 长线/短线胜率分析
**路径：** `btc-station/app/analysis/page.tsx`

用数学和概率方法回答"BTC 做长线还是短线更划算"。

- 基于 OKX 历史数据统计不同持仓时间的胜率、平均收益、最大亏损
- 蒙特卡洛模拟：随机抽样模拟不同持仓策略的长期结果
- 用户可调节参数：时间范围、初始资金、交易次数等

---

### [3] 图表页 — K线图 + 策略回测 + 参数优化（同一页面）
**路径：** `btc-station/app/chart/page.tsx`

**设计原则：像 TradingView 一样，图表、回测、调参必须在同一个页面完成。** 用户看图→跑回测→调参→再看图，是一个连续动作，不能跳页。

#### 图表功能
- Lightweight Charts K线图，多周期切换（1m / 5m / 15m / 1h / 4h / 1d / 1w）
- 范围快捷键：1D / 3D / 7D / 1M / 3M / 1Y
- 永续合约 / 现货切换
- 永续信息面板（资金费率 + 未平仓量 + 多空比 + 下次结算倒计时）
- 成交量子图
- 分屏视图（主图 + 副图不同周期）
- 画线工具：趋势线、水平线、矩形、斐波那契回调、文字标注
- 截图导出（PNG + 水印）
- 每 10 秒自动更新最新 K 线

#### 内置策略（6 个）
通过 `ƒx 策略库` 下拉菜单选择，一键回测：

| 策略 ID                    | 名称           | 分类           |
| -------------------------- | -------------- | -------------- |
| `MaCrossStrategy`          | MA 双均线交叉   | trend          |
| `RsiStrategy`              | RSI 超买超卖    | mean-reversion |
| `MacdStrategy`             | MACD 金叉死叉   | trend          |
| `BollingerBreakoutStrategy`| 布林带突破      | breakout       |
| `DcaStrategy`              | DCA 定投补仓    | dca            |
| `AtrChannelStrategy`       | ATR 通道动态止损 | trend          |

策略模板源码位于 `backend/strategies/` 目录。

#### 回测流程
1. 用户选择内置策略 → 前端从 `/py-api/api/templates/{id}/code` 获取策略源码
2. 前端提交 `/py-api/api/backtest/dynamic`（POST，发送 code + symbol + timeframe + parameters）
3. 后端用 VectorBT 执行，同步返回 metrics / trades / indicators / equity
4. 前端渲染：买卖点标记 + 指标线叠加 + 回测控制台 + 资金曲线 + 交易明细

#### Strategy Tester 面板（底部 5 个 Tab）
**组件：** `btc-station/components/StrategyTesterPanel.tsx`

| Tab      | 功能                                              |
| -------- | ------------------------------------------------- |
| 回测控制台 | 日志输出 + 关键指标摘要（收益率/回撤/胜率/Sharpe/Sortino/盈利因子） |
| 资金曲线  | Plotly 折线图，带初始资金基线                        |
| 交易明细  | 可排序表格，显示每笔交易入场/出场/盈亏               |
| 参数优化  | 网格搜索面板（含预设模板），散点图 + Top10 表格       |
| 导出CSV   | 下载 TradingView 兼容格式 CSV，用于 quant-lab.org 分析 |

#### 参数优化
- 填写参数范围（起始/终止/步长），后端穷举所有组合（上限 2000）
- 内置参数预设：MA双均线 / RSI / MACD / 布林带
- 结果渲染：收益率散点图（气泡大小=交易数，颜色=回撤）+ Top 10 排名表
- 一键应用最优参数到图表
- 下载 CSV → 上传到报告页或 quant-lab.org 进行稳健性分析

---

### [4] 策略页 — 自定义策略开发环境
**路径：** `btc-station/app/strategy/page.tsx`

独立的策略开发环境，不影响图表页的使用。

#### 布局
- **左侧（50%）**：Monaco Python 编辑器（VectorBT 格式）
- **右侧（50%）**：BTC/USDT K 线图 + 成交量（MiniChart 组件）
- **底部**：复用 StrategyTesterPanel（5个Tab 完整功能）

#### 功能
- 默认 Starter Template（教用户 `execute(df, parameters)` 格式）
- 代码/策略名自动保存到 localStorage
- 点击 ▶ 运行回测 → 图表显示买卖标记 + 指标线
- 参数优化（网格搜索）→ 结果自动传递到报告页
- 周期切换（1h / 4h / 1d）
- 重置模板按钮

#### 策略代码规范
```python
def execute(df, parameters):
    """必须实现此函数"""
    # df: 含 open/high/low/close/volume 的 DataFrame
    # parameters: 字典，包含 initial_capital 和自定义参数
    # 返回: (vbt.Portfolio, indicators_dict)
    return portfolio, {"指标名": pd.Series}
```

---

### [5] 报告页 — 参数稳健性分析
**路径：** `btc-station/app/report/page.tsx`

移植自 quant-lab.org 的稳健性分析系统，适配 BTC Station 暗色主题。

#### 数据来源
- **自动**：策略页参数优化完成后，数据通过 localStorage 传递
- **手动**：上传 TradingView 策略生成器导出的 CSV 文件

#### 分析流水线
1. 数据去重
2. 多层过滤（亏损/回撤/交易数等）
3. 动态归一化评分（Calmar/Sortino/盈利因子/夏普/净收益）
4. 单步邻居法稳健性评估（异步分块计算）
5. 帕累托前沿筛选
6. 综合排名 = 效用分 × 稳健性权重

#### 界面
- 统计卡片（原始组合/去重/通过/帕累托/最高收益/参数维度）
- 📈 收益 vs 回撤 散点图（通过=绿/未通过=红/Top3=金）
- 🏆 Top 10 推荐参数表（含稳健性进度条）
- 📋 全量数据表（含筛选状态）
- ⚙ 可调过滤条件 + 评分权重滑块

---

## 关键文件索引

### 前端 (`btc-station/`)
| 文件 | 说明 |
| ---- | ---- |
| `next.config.js` | `/py-api/*` → `localhost:8000/*` rewrite 代理 |
| `app/chart/page.tsx` | 图表页主文件（~1800 行），包含 ChartPanel / DrawingLayer / PerpInfoPanel |
| `app/strategy/page.tsx` | 策略页：Monaco 编辑器 + MiniChart + StrategyTesterPanel |
| `app/report/page.tsx` | 报告页：稳健性分析 + 散点图 + Top10 |
| `components/StrategyTesterPanel.tsx` | 底部回测面板（~800 行），5 个 Tab |
| `components/MiniChart.tsx` | 轻量级 K 线图组件（策略页用） |
| `lib/robustness.ts` | 稳健性分析核心算法库 |
| `app/page.tsx` | 首页 |
| `app/analysis/page.tsx` | 分析页 |

### 后端 (`backend/`)
| 文件 | 说明 |
| ---- | ---- |
| `main.py` | FastAPI 入口，挂载路由，启动数据同步线程 |
| `api_v31.py` | Phase 3.1 路由：策略 CRUD / 模板 / 回测（Supabase） |
| `dynamic_runner.py` | 动态执行用户策略代码的沙箱 runner |
| `data_feeder.py` | OKX K 线数据获取与本地缓存 |
| `strategies/` | 6 个内置策略模板（VectorBT 格式 `.py`） |
| `optimizer/` | VectorBT 参数优化器 |
| `csv_converter.py` | VectorBT 结果 → TradingView CSV 转换 |

---

## 配套工具

**Quant Lab（quant-lab.org）** — 纯前端，已上线（分析算法已内置到报告页）
- 上传 CSV → 稳健性评分 → 找出最优且稳健的参数组合
- 单步邻居算法：避开孤峰，锁定参数高原
- 路径：`btc-panel/src/`
- ⚠️ 核心算法已移植到 `btc-station/lib/robustness.ts`，报告页可独立使用

---

## 给未来 AI 的防坑指南

### 🚫 错误 1：忘了启动后端
- 前端策略回测全部走 `/py-api/` 代理到 `localhost:8000`，后端没跑会返回 500。
- **排查方法**：`netstat -ano | findstr :8000` 看端口是否在监听。

### 🚫 错误 2：用 Freqtrade 做回测
- Freqtrade 有 SQLite 状态、文件锁，在 FastAPI 中调用会死锁崩溃。
- **正确做法**：只用 VectorBT + Pandas，内存运算，无状态。

### 🚫 错误 3：图表 useEffect 依赖 candles 数据
- 每次数据更新都会销毁重建图表，导致闪烁和视角重置。
- **正确做法**：`createChart` 只在挂载时执行一次，数据更新用 `series.setData()`。

### 🚫 错误 4：在前端计算 MA/MACD/RSI 等指标
- 用户要看指标直接用 TradingView，这不是本站职责。
- **正确做法**：前端只渲染 K 线和成交量，所有策略指标线和买卖点由后端算好传来。

### 🚫 错误 5：调参用异步轮询架构
- `setInterval` 轮询任务状态，代码复杂，后端重启后任务丢失。
- **正确做法**：`POST /api/optimize` 同步阻断返回，前端一次 `await fetch()`，全屏 Spinner 等待即可。

### 🚫 错误 6：参数优化走 Next.js 代理
- Next.js rewrite 有 30 秒超时限制，参数优化可能超时返回 500。
- **正确做法**：前端检测 localhost 环境时直接调 `http://localhost:8000/api/optimize`，绕过代理。

---

## 验证记录

**2026-05-09：**
MA双均线 · 4h · 16500根K线 · $10,000 初始资金
→ 净收益 +496.97% | 回撤 68.74% | 胜率 37.2% | 192笔 | Sharpe 0.78 | Sortino 1.12 | 盈利因子 1.24

---

## 免责声明

本项目仅供量化技术研究与学习使用。任何基于本系统的真实资金交易，风险由使用者自行承担。
