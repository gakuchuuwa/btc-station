# BTC Station — 已知技术坑与修复方案

本文档收录项目开发过程中实际踩过的具体技术坑：**症状 → 根本原因 → 修复方案 → 验证 → 排查顺序**。

> ⚠️ 这里只有"症状对应的修复方案"，不讲项目设计原则。
> 设计原则、开发边界、产品哲学请看 `README.md` 的「开发规矩」章节。

**编号约定**：第 1-8 条历史上是设计原则条目，已合并到 README，本文从第 9 条开始，**保留原编号便于历史引用追溯**。

---

### 9. 海量历史 K 线加载方案 (20,000 根+)

当需要加载深达数年的 K 线（如 20,000 根）用于回测时，禁止一次性同步请求。

**正确方案：**
1.  **首屏秒开**：先拉取最近 500 根数据立即渲染。
2.  **异步追溯**：在后台启动循环请求，利用 `before` 参数分批向前追溯（每批 100-300 根），将数据存入 `Map<number, Candle>` 结构去重合并。
3.  **静默更新**：全部加载完成后再执行一次全量 `setData`，避免频繁重绘导致图表闪烁或滚动条异常。

### 10. 图表重置与缩放 (TradingView 体验)

对于 `lightweight-charts`，"重置" 不应直接使用 `fitContent()`，因为海量数据会导致 K 线缩得太小。

**正确方案：**
1.  通过 `onContextMenu` 拦截原生右键，弹出自定义菜单。
2.  重置操作应手动设置 `timeScale: { barSpacing: 8, rightOffset: 5 }` 以保证 K 线放大倍数适中。
3.  紧接着调用 `scrollToRealTime()` 回到最新数据，并对价格轴执行 `autoScale: true`。

### 11. MiniChart (Lightweight Charts v5) 渲染崩溃防坑指南

这是本项目踩过的最隐蔽的坑，症状是：数据正常到达，控制台无 React 报错，但图表一片空白。

#### 根本原因：Lightweight Charts 会"静默崩溃"

一旦传入的数据违反以下任何规则，图表 Canvas 渲染引擎会直接关闭，既不抛错也不提示。

**雷区 1：时间戳单位混用（毫秒 vs 秒）**

OKX 返回 13 位毫秒（如 `1700000000000`），VectorBT 返回 10 位秒（如 `1700000000`）。两者同时进入图表，X 轴会试图同时显示"2019 年"和"公元 55000 年"，所有数据被压缩到一个像素，图表看起来是空白的。

**正确做法：在 setData 之前统一转换**

```ts
const t = raw.time > 1e12 ? Math.floor(raw.time / 1000) : raw.time
```

**雷区 2：同一时间戳存在两个 Marker**

Lightweight Charts 绝对不允许同一根 K 线上有两个交易标记。同时触发开仓和平仓（或同一根 K 线的买卖信号）时，`setMarkers` 会直接拉闸，导致整条 K 线序列消失。

**正确做法：用 Map 合并同一时间戳的 Marker**

```ts
const uniqueMap = new Map<number, Marker>()
markers.forEach(m => {
  if (uniqueMap.has(m.time)) {
    uniqueMap.get(m.time)!.text += `/${m.text}`  // 合并文字
    uniqueMap.get(m.time)!.color = '#FFD700'      // 冲突时高亮
  } else {
    uniqueMap.set(m.time, { ...m })
  }
})
```

**雷区 3：OHLC 数据中混入 NaN 或 null**

VectorBT/Pandas 合并数据时会产生空值。只要有一根 K 线的 open/high/low/close 是 `NaN`，Y 轴自动缩放会计算出 `-Infinity ~ +Infinity`，图表瞬间缩成不可见的点。

**正确做法：渲染前过滤**

```ts
.filter(c => isFinite(c.open) && isFinite(c.high) && isFinite(c.low) && isFinite(c.close))
```

**雷区 4：v5 不再用 `setMarkers`，要用 `createSeriesMarkers` 插件**

Lightweight Charts v5 中，交易标记通过插件管理，不是直接调用 series 的方法。

```ts
// ❌ 错误（v4 写法，v5 中 series 上没有这个方法）
candleSeries.setMarkers([...])

// ✅ 正确（v5 插件写法）
import { createSeriesMarkers } from 'lightweight-charts'
const markerPlugin = createSeriesMarkers(candleSeries, [])
// 后续更新：
markerPlugin.setMarkers([...])
```

#### 正确的 useEffect 拆分结构

将 K 线、指标线、交易标记分成三个独立的 `useEffect`，避免 `candles` 更新时连带触发 `markers` 的重复渲染：

```ts
useEffect(() => { /* 只渲染 K 线 */ }, [candles])
useEffect(() => { /* 只渲染指标线 */ }, [strategyLines])
useEffect(() => { /* 只渲染交易标记 */ }, [markers, candles])
```

---

### 12. Windows NTFS 数据文件坑：回测笔数异常少

**症状**：回测只有 2～3 笔交易，日志显示"已加载 15998 根历史 K 线"，但实际后端只读到 300 行数据。

**根本原因**：Windows NTFS 不支持冒号 `:` 作为文件名。`data_feeder.py` 以 `BTC/USDT:USDT` 为 symbol 写文件时，系统把 `BTC_USDT:USDT_4h.csv` 解析为 `BTC_USDT` 文件的 **备用数据流（Alternate Data Stream, ADS）**，只写入了 300 行。后续读取 ADS 流，拿到的是这 300 行（≈50天数据），策略只能产生 2～3 笔交易。

**修复方案**（已实施）：在 `data_feeder.py` 的 `get_local_data` 和 `fetch_ohlcv` 里用 `symbol.split(':')[0]` 剥离永续后缀，统一指向 `BTC_USDT_4h.csv`。

**验证命令**：
```python
# 在 backend/ 目录下运行
from data_feeder import DataFeeder
fd = DataFeeder('okx')
print(len(fd.get_local_data('BTC/USDT:USDT', '4h')))  # 应输出 ~15998
```

**排查顺序**：回测笔数异常少时，先跑上面的验证，确认数据量是否正常，再排查策略逻辑。

---

### 13. VectorBT `lock_cash` 砍单坑：资金曲线诡异、回撤虚高

**症状**：
- 回测显示最大回撤 50%+，但翻看交易明细，单笔最大亏损只有几百美元，93 笔交易最差累计回撤算下来不到 2%。
- 资金曲线在 2021 年初等 BTC 暴涨段出现"暴涨后立刻断崖跌回"或"幽灵反手单"导致的离谱波动。
- `pf.trades.records_readable` 里出现策略代码里压根没下过的反向单（明明是平多仓，VBT 解读成"平多 + 反手开空"）。
- 已实现 PnL 总和（trades 求和）与 `pf.value().iloc[-1]` 差出几万甚至十几万美元。

**根本原因**：
1. 策略按"固定 `real_capital`（如 10000）"算仓位，模拟的是 **杠杆/合约账户**（保证金交易）。
2. 但 `vbt.Portfolio.from_orders` 默认是 **现货账户**：`init_cash=10000` 只能买不到 1 BTC。
3. 当策略发出加仓单（比如又要买 0.556 BTC）时，账户里现金不够，`lock_cash=True` 会把订单 **砍成"现金允许的最大值"**（可能从 0.556 砍到 0.089）。
4. 后续平仓单按策略意图发出 `-1.786` BTC，但 VBT 实际持仓只有 `1.318` BTC，多出来的 `0.467` 被解读为 **反手开空**。
5. BTC 暴涨时这些"幽灵空头"产生巨额浮亏 → 制造出虚假的 50%+ 回撤。

**典型表现**：策略 trades 列表显示 93 笔正常交易，但 VBT 内部 `pf.trades` 显示 94+ 笔，其中混入了你从未下单的 Short。

**修复方案**（已实施于 `backend/strategies/TurtleSslDualStrategy.py`）：
```python
# 给 VBT 海量现金确保所有订单 100% 按策略意图成交
_vbt_huge_cash = 1e10
pf = vbt.Portfolio.from_orders(
    close, size=order_size, size_type="amount", direction="both",
    price=order_price, init_cash=_vbt_huge_cash, fees=fees, freq="4h",
    # 注意：移除 lock_cash、min_size、size_granularity
)
# 起点校准：把净值序列拉回真实初始资金
pf = pf.replace(init_cash=init_cash)
```

**验证命令**：
```python
realized = sum(t['PnL'] for t in trades)        # 策略已实现 PnL
vbt_end  = pf.value().iloc[-1] - init_cash      # VBT 末值 - 初始
# 两者差额应该 < 当前持仓浮盈（通常几百美元）
# 若差额 > 1000 美元，几乎可以确定 VBT 砍单了
```

**排查顺序**：当回测回撤明显高于交易明细推算值时：
1. 先按上面公式比对 `realized` 与 `vbt_end`，差额大就是砍单。
2. 检查 `pf.trades.records_readable` 是否出现策略没下过的反向单。
3. 看 `pf.orders.records_readable` 的 Size 列，对比策略发出的 size——如果 VBT 成交量小于策略意图，就是 lock_cash 砍了单。

**写策略时的预防**：
- 模拟合约/杠杆账户的策略（按风险百分比固定算 BTC 数量），VBT 调用必须用海量 `init_cash`，再用 `replace()` 校准。
- 模拟现货账户的策略（按"当前可用现金的 X%"算仓位），可以保留 `lock_cash=True`，但要保证策略内部 `_calc_qty` 也用实时 cash，不能用固定值。
- 永远不要让"策略内部算的 size"和"VBT 实际可成交 size"脱节。

---

### 14. 蒙特卡洛 (Monte Carlo) 压力测试避坑指南

蒙特卡洛主要用于单策略（S3）回测交易清单的鲁棒性极限评估，通过打乱交易顺序或有放回抽样重新拼装资金曲线，暴露“运气带来的过拟合”。

**开发与维护防坑准则：**
1. **数据源结构对齐**：
   - 提取的必须是“出场”记录（类型含 `出场` 或 `Exit`），因为交易的利润只在出场时结算。
   - 净盈亏字段取值按优先级匹配：`净损益 USDT` -> `Net Profit USDT` -> `净损益 USD` -> `Net Profit USD` -> `净损益` -> `Net Profit`。
   - 支持解析多 sheet 的 XLSX（定位 `交易清单`）或单 sheet 的 CSV（默认读取第一张工作表以支持 TV 简易 CSV 导出）。
2. **ECharts 渲染优化**：
   - **权益路径扇形图**：为防止上万条资金曲线导致 Canvas 渲染卡死崩溃，**只能筛选前 100 条曲线进行实际曲线绘制**，而对于 P5 (悲观置信度)、P50 (中位数)、P95 (乐观置信度) 则应在海量抽样完成后，对每个步长（Step）的数据单独排序并计算分位数进行绘制。
   - **回撤频率直方图**：分桶区间应在 0-100% 之间（例如分 20 个桶，每 5% 一个桶）。超过用户设定的“破产阈值”（如 30%）的桶，直方图柱体**必须强行着色为红色（#ef5350）**以示高危预警。
3. **S3 与蒙特卡洛的高速缓存传递桥梁**：
   - 使用 `sessionStorage.setItem('mc_trades_cache', ...)` 传递精简后的 `{ id: number; profitUSDT: number }[]` 数组。
   - 蒙特卡洛页面加载时，必须在 `useEffect` 中优先读取并自动载入该缓存（载入后应立即销毁该缓存，防止刷新时反复加载）。

---

### 15. 参数优化 (Parameter Optimization) 散点图与数据处理避坑指南

该页面（原报告页）主要承载对 S4 网格/退火调参后海量数据的鲁棒性筛选。

**开发与维护防坑准则：**
1. **收益 vs 回撤散点图 (ScatterPlot) 动态轴缩放**：
   - **禁止强行把坐标轴原点锁死在 0**：因为海量优质参数的收益可能集中在高位，回撤集中在极小区间。如果强行把轴限制为 `0` 起点，所有散点会被极度压缩挤在一起，完全失去可视化对比意义。
   - **自适应 Nice Ticks 计算**：必须使用科学的 `niceTicks` 算法，根据所有样本的实际 `Min / Max` 动态推算轴边界，并在首尾两端自动预留 **5% 的 Padding / 缓冲空间**。
   - **界面高度预算**：散点图容器高度必须克制，通常控制在 **400px** 左右（过高会导致页面信息密度低，用户体验差）。
2. **数据去重与过滤逻辑防缩水**：
   - **坚决杜绝硬编码过滤上限**：历史版本中曾出现过因为去重硬编码导致前端只显示 48 条参数的恶性 Bug。去重和评分机制必须对全量扫描出的 Epoch 结果负责，不可以用任何硬上限进行粗暴过滤。
   - **邻居法（防参数孤岛）**：计算某个参数的稳健性评分时，必须检查其周围邻居（如快均线 +2/-2 步长）的绩效，剔除因为行情巧合形成的”孤峰”参数。

---

### 16. OKX 历史 K 线只拉到几个月：`history-candles` vs `candles` 接口区别

**症状**：Railway 后端日志打印 `Fetching 18000 candles ... (may take a while)` 但下一行立即 `Saved 300 rows`。前端 K 线只显示最近一两个月。

**根本原因**：OKX REST 有**两个**历史 K 线接口，CCXT 根据参数自动路由：
| 接口 | 数据深度 | 触发方式 |
|---|---|---|
| `/api/v5/market/candles` | **仅最近约 8 个月** | 不传 `since`，或传 `until/params` |
| `/api/v5/market/history-candles` | **从交易对上线日起的全部历史** | 传 `since`（不传 `until`） |

如果分页用 `params={'until': earliest_ms}` 反向拉，CCXT 路由到第一个接口，最多只能拿到 ~1440 根（8 个月）。

更糟的是：如果 `since = now - limit * tf_ms` 设得**太早**（比如 limit=18000 + 4h = 起点 2018-02，但 OKX 永续 BTC/USDT:USDT 2019-11 才上线），首批返回空 → 循环 break → fallback 到”最近 300 根”。

**修复方案**（已实施于 `backend/data_feeder.py`）：反向分页用 `since` 而非 `until`：

```python
# 第一批：不带 since，OKX 返回最近 300 根
batch = self.exchange.fetch_ohlcv(symbol, timeframe, limit=300)
all_ohlcv = list(batch) if batch else []

# 后续批次：用最早时间戳算 since 反向往前拉（走 history-candles 接口）
while all_ohlcv and len(all_ohlcv) < limit:
    earliest_ms = all_ohlcv[0][0]
    next_since = earliest_ms - 300 * tf_ms
    older = self.exchange.fetch_ohlcv(symbol, timeframe, since=next_since, limit=300)
    if not older:
        break  # 到达交易对最早数据
    existing_ts = {row[0] for row in all_ohlcv}
    new_rows = [row for row in older if row[0] not in existing_ts]
    if not new_rows:
        break
    all_ohlcv = sorted(new_rows + all_ohlcv, key=lambda r: r[0])
    time.sleep(self.exchange.rateLimit / 1000.0)
```

**验证命令**（本地或 Railway 部署后）：
```bash
curl -s “https://btc-station-backend-production.up.railway.app/api/candles/4h” | \
  python -c “import sys,json,datetime; d=json.load(sys.stdin)['candles']; \
    print(len(d), datetime.datetime.fromtimestamp(d[0]['time'],datetime.UTC).date(), '->', \
    datetime.datetime.fromtimestamp(d[-1]['time'],datetime.UTC).date())”
# 期望：14068 2019-12-16 -> <今天>（4h 周期 BTC/USDT:USDT 全历史）
```

**排查顺序**：当 K 线显示明显偏少时，先用上面 curl 看后端返回多少根。如果 < 1000 根，就是这个 bug；如果 14000+ 而前端少，就是前端缓存或渲染问题（Ctrl+Shift+R 强刷）。

---

### 17. Railway 部署：Builder 必须显式设为 Dockerfile，否则用 Railpack 自选 Python 版本

**症状**：明明 `backend/Dockerfile` 第一行 `FROM python:3.11-slim` 写死了 Python 版本，构建日志却显示 `Cannot install on Python version 3.14.3; only versions >=3.10,<3.14 are supported`，numba/vectorbt 编译失败。或者部署”成功”但实际跑的是 Caddy 静态服务器（HTTP 502，Deploy Logs 出现 `using config from file file: Caddyfile`）。

**根本原因**：Railway 默认 Builder 是 **Railpack**（Railway 自研自动构建器），它**不读 Dockerfile**：
- 看到根目录有 `index.html` → 当成静态网站，跑 Caddy
- 看到 Python 项目 → 自己选 Python 版本（默认拉最新版，如 3.14）

`backend/Dockerfile` 完全被忽略。

**修复方案**（一次性配置，永久生效）：
1. 在 Railway 服务的 **Settings → Build → Builder** 卡片，从 `Railpack` 切换到 **`Dockerfile`**
2. **Dockerfile Path** 填 `Dockerfile`（相对 Root Directory，已经是 `/backend`）
3. 保存后会自动触发新部署

**排查顺序**：Railway 构建日志里如果出现 `cp314` / `cp313`（说明用了高版本 Python）、或 Deploy Logs 里出现 `Caddyfile` / `admin endpoint disabled`（说明在跑 Caddy），第一时间检查 Builder 设置，**不要去改 Dockerfile**，因为根本没在用它。

---

### 18. PyPI 包名规范化与新版 `pandas-ta` 陷阱

**症状 A**：`requirements.txt` 写 `pandas_ta`，pip 报 `Could not find a version that satisfies the requirement pandas_ta`。
**症状 B**：改成 `pandas-ta` 后，Python 3.11 下仍然 `No matching distribution found`，但 Python 3.12 装得上。

**根本原因**：
1. **PyPI 包名只用连字符**：`pandas_ta`（下划线）不是合法的 PyPI 名，Python `import` 时才写下划线。两者的对应关系是 PyPI 内部的”规范化”机制——`pip install pandas-ta` 后 `import pandas_ta` 才能用。
2. **PyPI 上 `pandas-ta` 已易主**：原作者 Twopirllc 的老 `pandas_ta` 兼容 Python 3.7+，但**当前 PyPI `pandas-ta` 名下的包是新作者重写的 0.4.x 版本**，`requires_python >=3.12`。Python 3.11 完全装不上。

**修复方案**（已实施）：
- `requirements.txt` 写 `pandas-ta`（连字符）
- `backend/Dockerfile` 用 `FROM python:3.12-slim`（不能再用 3.11）
- 由于新版 API 跟老版 pandas_ta 可能不完全一致，调用 pandas_ta 的代码（如 `vbt_optimizer.py`）必须在升级后跑一遍单元测试或冒烟测试

**备选方案**（如果新版 API 不兼容）：requirements.txt 改用 `git+https://github.com/twopirllc/pandas-ta.git` 直接从作者仓库装老版本，绕开 PyPI。

**排查顺序**：装包失败时，先用 `curl https://pypi.org/pypi/<pkg>/json | python -c “import sys,json; d=json.load(sys.stdin); print(d['info']['version'], d['info'].get('requires_python'))”` 确认包名拼写正确和 Python 版本要求。

---

### 19. FastAPI 用了表单/文件上传必须装 `python-multipart`

**症状**：FastAPI 应用启动时崩溃，Deploy Logs 出现：
```
RuntimeError: Form data requires “python-multipart” to be installed.
You can install “python-multipart” with: pip install python-multipart
```

**根本原因**：任何路由用了 `Form(...)`、`File(...)`、`UploadFile` 等表单/文件上传参数，FastAPI 都会在**应用启动时**（不是运行时）检查 `python-multipart` 是否已装。本项目 `backend/pattern_report.py` 的 `/pattern-report/analyze` 路由用了表单上传。

**修复方案**（已实施）：`requirements.txt` 添加 `python-multipart`。

**注意**：FastAPI 文档里 `python-multipart` 是 “Optional Dependency”，不在 `pip install fastapi` 默认装的列表里，需要手动加。

---