# 项目规则

## ⚠️ 语言要求（最高优先级，覆盖所有其他规则）

**只能用中文。** 回复、工具调用说明、代码注释、commit message、分析文字——所有输出一律中文。
**严禁出现任何日语**（平假名、片假名均禁止）。违反此规则必须立即道歉并用中文重写。
用户完全不懂日语，出现日语会造成极大困扰。无论任何理由都不得使用日语。

---

## 唯一运行模式（每次改代码前必须确认）

本项目有且只有一种正确的运行方式：

```
浏览器 → fetch('/py-api/api/xxx') → Next.js rewrite → localhost:8000 → FastAPI
```

### 启动顺序

```powershell
# 终端1：后端
cd "C:\Users\GAKU\Desktop\BTC Tradingview assistant\backend"
.\venv\Scripts\Activate.ps1
uvicorn main:app --host 0.0.0.0 --port 8000

# 终端2：前端
cd "C:\Users\GAKU\Desktop\BTC Tradingview assistant\btc-station"
npm run dev
```

---

## 代码铁律（违反必须立即修复）

### ❌ 绝对禁止的写法

```js
// 禁止1：硬编码 localhost URL
fetch('http://localhost:8000/api/xxx')

// 禁止2：hostname 分支判断
const url = window.location.hostname === 'localhost'
  ? 'http://localhost:8000/api/xxx'
  : '/py-api/api/xxx'
```

**只允许这一种写法：**
```js
fetch('/py-api/api/xxx')
```

如果在任何前端文件中发现 `localhost:8000` 或 `hostname === 'localhost'` 的分支，**立即删除，替换为 `/py-api/` 前缀**。这是历史上反复出现 `Failed to fetch` 的根本原因。

### ⚠️ Windows NTFS 数据文件坑（已踩，必读）

**症状**：回测只有 2～3 笔交易，日志显示"已加载 15998 根 K 线"，但实际上后端只拿到了 300 行数据。

**根本原因**：Windows NTFS 不支持冒号 `:` 作为文件名字符。当 `data_feeder.py` 以 `BTC/USDT:USDT` 为 symbol 写文件时，系统把 `BTC_USDT:USDT_4h.csv` 解析为 `BTC_USDT` 文件的**备用数据流（Alternate Data Stream, ADS）**，只写入了极少量数据（300行）。后续 `get_local_data` 读取 ADS 流，拿到的是这 300 行，而非完整 15998 行。

**修复**：`data_feeder.py` 的 `get_local_data` 和 `fetch_ohlcv` 里已做 `symbol.split(':')[0]` 剥离永续后缀，使所有调用统一指向 `BTC_USDT_4h.csv`。

**验证命令**：
```python
from data_feeder import DataFeeder
fd = DataFeeder('okx')
print(len(fd.get_local_data('BTC/USDT:USDT', '4h')))  # 应输出 ~15998，否则说明修复失效
```

**日后如果回测笔数异常少，第一步就跑上面这个验证。**

---

### ⚠️ VectorBT `lock_cash` 砍单坑（已踩，必读）

**症状**：
- 回测最大回撤显示 50%+，但交易明细里单笔最大亏损只有几百美元，根本算不出这么大回撤。
- 资金曲线在 BTC 暴涨段（如 2021 初）出现诡异断崖。
- `pf.trades.records_readable` 里冒出策略从未下过的反向单。
- 已实现 PnL 总和（sum(trades['PnL'])）与 `pf.value().iloc[-1]` 差出几万甚至十几万美元。

**根本原因**：策略按"固定 `real_capital=10000`"算仓位是 **杠杆/合约账户**思维，但 `vbt.Portfolio.from_orders` 默认是 **现货账户**——10000 美元现金根本买不起策略想要的 1.23+0.556+... BTC。`lock_cash=True` 会把加仓单从 0.556 砍到 0.089，后续平仓单（-1.786）和实际持仓（1.318）对不上，VBT 把多出的 0.467 解读成 **反手开空**，BTC 暴涨时这些"幽灵空头"产生巨额浮亏，制造虚假回撤。

**修复**（已实施于 `backend/strategies/TurtleSslDualStrategy.py`）：
```python
_vbt_huge_cash = 1e10
pf = vbt.Portfolio.from_orders(
    close, size=order_size, size_type="amount", direction="both",
    price=order_price, init_cash=_vbt_huge_cash, fees=fees, freq="4h",
    # 不要传 lock_cash、min_size、size_granularity
)
pf = pf.replace(init_cash=init_cash)  # 起点校准回真实本金
```

**验证命令**：
```python
realized = sum(t['PnL'] for t in trades)
diff = pf.value().iloc[-1] - (init_cash + realized)
# diff 应该 < 当前持仓浮盈（通常几百美元）；> 1000 美元就是 VBT 砍单了
```

**新写"按风险百分比固定算 BTC 数量"的策略时，VBT 调用必须按上面这套写。** 详见 `README.md` 防坑指南第 13 条。

---

### ❌ 禁止在后端引入的依赖

- **Freqtrade** — 有 SQLite 状态/文件锁，在 FastAPI 中调用会死锁。永远不用。
- **Celery / Redis** — 本项目不存在这些服务。如果代码里有 `celery_app` 相关引用，删除。
- **`_VBT_TEMPLATES` 内嵌字符串** — 策略代码唯一来源是 `backend/strategies/*.py` 文件，不允许在 Python 代码里内嵌策略字符串副本。

### ✅ 后端回测的唯一正确路径

```
前端 POST /py-api/api/backtest/dynamic
  → FastAPI dynamic_runner.py 内存执行 VectorBT
  → 同步返回 metrics / trades / indicators
  → 前端直接渲染
```

不经过数据库，不需要登录，不需要保存策略，无状态。

---

## 遇到 "Failed to fetch" 排查顺序

1. `netstat -ano | Select-String ":8000"` — 后端是否在运行？
2. 前端代码里是否有 `localhost:8000` 硬编码？找到就删。
3. 前端代码里是否有 `hostname === 'localhost'` 分支？找到就删。
4. 以上都没有 → 就是后端没启动，按启动顺序重启即可。

---

## 关键文件位置

| 文件 | 作用 |
|------|------|
| `btc-station/next.config.js` | `/py-api/*` → `localhost:8000/*` 代理配置，不要动 |
| `backend/main.py` | FastAPI 入口 |
| `backend/api_v31.py` | 策略/模板/回测路由 |
| `backend/dynamic_runner.py` | VectorBT 执行沙箱 |
| `backend/strategies/*.py` | 内置策略模板，唯一来源 |
| `btc-station/app/chart/page.tsx` | 图表页（K线+回测+调参） |
| `btc-station/app/strategy/page.tsx` | 策略编辑器页 |
| `btc-station/lib/freqtrade-api.ts` | 后端 API 工具函数 |

完整文档：`README.md`（防坑指南在文档末尾）

---

## Railway 后端部署（生产环境）

后端跑在 Railway，服务名 `btc-station-backend`，公网域名 `btc-station-backend-production.up.railway.app`。前端 `quant-lab.org`（Vercel）通过 `/py-api/*` 代理过去。

### ⚠️ Railway 关联的是独立仓库

本地 origin 是 `gakuchuuwa/btc-station`，但 **Railway 监听的是另一个独立仓库** `gakuchuuwa/btc-station-backend`，分支 `main`（不是 master）。本地 git 里这个仓库的 remote 名是 `railway`。

任何后端修复必须**同时**推到两个仓库：
```powershell
git push origin master            # 主仓库
git push railway master:main      # Railway 监听的仓库
```

如果只推到 `origin`，Railway 永远看不到改动。

### ⚠️ Railway Builder 必须是 Dockerfile

Railway 默认 Builder 是 **Railpack**，不读 `backend/Dockerfile`，会自己选最新 Python 版本（3.14）导致 numba 编译失败，或者看到根目录 `index.html` 就跑 Caddy 当成静态站点。

正确配置（在 Railway Settings → Build 里）：
- **Builder**: `Dockerfile`
- **Dockerfile Path**: `Dockerfile`（Root Directory 已设为 `/backend`）
- **Branch**: `main`

详见 README 防坑指南第 17 条。

### Railway 后端调试排查顺序

1. `curl -s -o /dev/null -w "%{http_code}\n" https://btc-station-backend-production.up.railway.app/api/templates` —— 502 说明应用没起来；200 说明后端正常
2. 502 时**必须看 Deploy Logs**（不是 Build Logs），找 `Traceback` 行
3. Build 失败时看 Build Logs，关注 `cp311`/`cp312`/`cp314`（Python 版本暗号）和"No matching distribution"

## 编码行为准则（来自 Karpathy 观察）

**权衡提示**：以下准则偏向谨慎而非速度。简单任务可酌情判断。

### 1. 先思考再编码

**不要假设。不要隐藏困惑。主动暴露权衡。**

实现之前：
- 明确说明假设。不确定就问。
- 如果存在多种理解，列出来——不要默默选一个。
- 如果有更简单的方案，说出来。该反驳就反驳。
- 如果有不清楚的地方，停下来。说明哪里困惑，然后问。

### 2. 简洁优先

**最少的代码解决问题。不写投机性功能。**

- 不写超出要求的功能。
- 一次性使用的代码不做抽象。
- 没被要求的"灵活性"或"可配置性"不加。
- 不可能发生的场景不写错误处理。
- 如果写了 200 行却可以用 50 行，重写它。

自问："资深工程师会说这过于复杂吗？"如果是，就简化。

### 3. 手术式修改

**只动必须动的。只清理自己制造的烂摊子。**

编辑现有代码时：
- 不"顺手改进"无关的代码、注释或格式。
- 不重构没坏的东西。
- 匹配现有代码风格，即使你会用不同的方式写。
- 发现无关的死代码，提一句——不要直接删。

当你的修改产生孤儿代码时：
- 删除**你的修改**导致的多余 import/变量/函数。
- 不删除原本就存在的死代码，除非被要求。

检验标准：每一行改动都能直接追溯到用户的需求。

### 4. 目标驱动执行

**定义成功标准。循环直到验证通过。**

把任务转化为可验证的目标：
- "加验证" → "为非法输入写测试，然后让测试通过"
- "修 bug" → "写一个能复现 bug 的测试，然后让它通过"
- "重构 X" → "确保重构前后测试都通过"

多步骤任务，先给出简短计划：
```
1. [步骤] → 验证：[检查项]
2. [步骤] → 验证：[检查项]
3. [步骤] → 验证：[检查项]
```

清晰的成功标准让你能独立循环推进。模糊标准（"让它能跑"）会导致反复澄清。
