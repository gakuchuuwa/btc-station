from dotenv import load_dotenv
import pathlib
load_dotenv(pathlib.Path(__file__).parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Dict, Any
from data_feeder import DataFeeder
from strategy import VectorBTTurtle
from dynamic_runner import run_dynamic_code
import json
import io
import csv
import itertools

import threading
from contextlib import asynccontextmanager

# Phase 3.1 routes
from api_v31 import router as router_v31

# Phase 4 VectorBT Optimizer
from optimizer.vbt_optimizer import router as vbt_optimizer_router

# 形态归因分析（TradingView 交易清单上传分析）
from pattern_report import router as pattern_report_router

# Dashboard 市场总览 / 链上 / 宏观
from dashboard_api import router as dashboard_router

feeder = DataFeeder('okx')

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Run the data preloader in a background thread
    print("[System] Starting background data syncer...")
    thread = threading.Thread(target=feeder.preload_cache, kwargs={'symbol': 'BTC/USDT:USDT', 'timeframes': ['1h', '4h', '1d']})
    thread.daemon = True
    thread.start()
    yield
    # Shutdown
    print("[System] Shutting down...")

app = FastAPI(title="BTC Station API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phase 3.1 — strategy editor + Freqtrade backtest
app.include_router(router_v31, prefix="/api")

# Phase 4 — VectorBT Optimizer
app.include_router(vbt_optimizer_router, prefix="/api/vbt")

# 形态归因分析
app.include_router(pattern_report_router, prefix="/api")

# Dashboard 市场总览 / 链上 / 宏观
app.include_router(dashboard_router, prefix="/api")

class StrategyRequest(BaseModel):
    code: str
    symbol: str = 'BTC/USDT'
    timeframe: str = '1h'
    parameters: dict = {}

class GridParam(BaseModel):
    start: float
    stop: float
    step: float

class OptimizeRequest(BaseModel):
    code: str
    symbol: str = 'BTC/USDT'
    timeframe: str = '1h'
    grid: Dict[str, GridParam]
    method: str = 'grid'        # grid | random | annealing | pso
    iterations: int = 100       # random / annealing / pso 用
    target: str = 'net_profit_pct'  # 优化目标指标
    start_date: str | None = None  # 回测起点(yyyy-mm-dd),None=用全量历史
    end_date: str | None = None    # 回测终点(yyyy-mm-dd),None=至今

# In-memory store for last optimization results (for CSV export)
_last_optimization_results: list = []


def _build_optimizer_iterator(request: 'OptimizeRequest'):
    """
    生成器版优化器:每跑完一次回测 yield 一次进度事件,跑完 yield 完成事件。
    供 /api/optimize（一次性返回）和 /api/optimize/stream（SSE）共用。
    事件格式:
      {"type":"progress","iter":i,"total":N,"result":{...}|None,"best":{...}|None}
      {"type":"done","successful":n,"failed":m,"total":N}
      {"type":"error","detail":"..."}
    """
    import random, math
    global _last_optimization_results

    try:
        symbol_swap = request.symbol.replace('BTC/USDT', 'BTC/USDT:USDT')
        df = feeder.get_local_data(symbol_swap, request.timeframe)
        if df.empty:
            yield {"type": "error", "detail": "数据同步中，请稍后重试。"}
            return

        param_names = list(request.grid.keys())

        def build_values(g):
            vals, v = [], g.start
            while v <= g.stop + 1e-9:
                vals.append(round(v, 8)); v += g.step
            return vals or [g.start]

        param_values = {n: build_values(request.grid[n]) for n in param_names}

        def to_params(combo):
            out = {k: int(v) if float(v).is_integer() else v for k, v in combo.items()}
            # 注入时间范围,让 dynamic_runner 裁剪 df
            if request.start_date:
                out["start_date"] = request.start_date
            if request.end_date:
                out["end_date"] = request.end_date
            return out

        def evaluate(params):
            result_data, error = run_dynamic_code(request.code, df, to_params(params), timeframe=request.timeframe)
            if error or not result_data:
                return None
            m = result_data["metrics"]
            return {
                "parameters": params.copy(), "status": "ok",
                # 关键排序字段(score 函数和前端表格直接用,不能丢)
                "net_profit_pct":   round(float(m.get("total_return_pct", 0)), 4),
                "win_rate_pct":     round(float(m.get("win_rate_pct", 0)), 4),
                "max_drawdown_pct": round(float(m.get("max_drawdown_pct", 0)), 4),
                "total_trades":     int(m.get("total_trades", 0)),
                "sharpe":           round(float(m.get("sharpe", 0) or 0), 4),
                "sortino":          round(float(m.get("sortino", 0) or 0), 4),
                "calmar":           round(float(m.get("calmar", 0) or 0), 4),
                "profit_factor":    round(float(m.get("profit_factor", 0) or 0), 4),
                # 完整 metrics 字典(CSV 导出/详细分析用,不参与排序)
                "full_metrics":     m,
            }

        def score(r):
            if r is None: return -1e9
            return float(r.get(request.target, r.get("net_profit_pct", -1e9)))

        def rand_point():
            return {n: random.choice(param_values[n]) for n in param_names}

        results = []
        best_r = None
        method = request.method

        # ── 网格穷举 ──
        if method == "grid":
            all_combos = list(itertools.product(*[param_values[n] for n in param_names]))
            total = len(all_combos)
            if total > 2000:
                yield {"type": "error", "detail": f"网格组合数 {total} 超过2000上限，请减小范围或增大步长。"}
                return
            for i, combo in enumerate(all_combos, 1):
                params = {param_names[k]: v for k, v in enumerate(combo)}
                r = evaluate(params)
                results.append(r or {"parameters": params, "status": "error"})
                if r and (best_r is None or score(r) > score(best_r)):
                    best_r = r
                yield {"type": "progress", "iter": i, "total": total, "result": r, "best": best_r}

        # ── 模拟退火 ──
        elif method == "annealing":
            total = request.iterations
            current = rand_point()
            current_r = evaluate(current)
            if current_r:
                results.append(current_r); best_r = current_r
            yield {"type": "progress", "iter": 1, "total": total, "result": current_r, "best": best_r}

            T, alpha = 1.0, 0.95
            for i in range(2, total + 1):
                T *= alpha
                neighbor = current.copy()
                key = random.choice(param_names)
                neighbor[key] = random.choice(param_values[key])
                neighbor_r = evaluate(neighbor)
                if neighbor_r:
                    results.append(neighbor_r)
                    delta = score(neighbor_r) - score(current_r) if current_r else 1.0
                    if delta > 0 or (T > 1e-6 and random.random() < math.exp(delta / T)):
                        current = neighbor; current_r = neighbor_r
                        if best_r is None or score(neighbor_r) > score(best_r):
                            best_r = neighbor_r
                yield {"type": "progress", "iter": i, "total": total, "result": neighbor_r, "best": best_r}

        # ── 随机 ──
        elif method == "random":
            total = request.iterations
            seen = set()
            i = 0
            max_attempts = total * 5
            attempts = 0
            while i < total and attempts < max_attempts:
                attempts += 1
                params = rand_point()
                key = str(sorted(params.items()))
                if key in seen: continue
                seen.add(key); i += 1
                r = evaluate(params)
                results.append(r or {"parameters": params, "status": "error"})
                if r and (best_r is None or score(r) > score(best_r)):
                    best_r = r
                yield {"type": "progress", "iter": i, "total": total, "result": r, "best": best_r}

        # ── PSO ──
        elif method == "pso":
            n_particles = max(5, min(20, request.iterations // 10))
            n_iters = max(1, request.iterations // n_particles)
            total = n_particles * n_iters
            w, c1, c2 = 0.7, 1.5, 1.5
            idx_ranges = {n: len(param_values[n]) - 1 for n in param_names}

            def idx_to_params(idx):
                return {n: param_values[n][max(0, min(idx_ranges[n], int(round(idx[n]))))]
                        for n in param_names}

            particles, done = [], 0
            for _ in range(n_particles):
                pos = {n: random.uniform(0, idx_ranges[n]) for n in param_names}
                vel = {n: random.uniform(-1, 1) for n in param_names}
                r = evaluate(idx_to_params(pos))
                particles.append({"pos": pos, "vel": vel, "best_pos": pos.copy(), "best_r": r})
                if r:
                    results.append(r)
                    if best_r is None or score(r) > score(best_r): best_r = r
                done += 1
                yield {"type": "progress", "iter": done, "total": total, "result": r, "best": best_r}

            g_best = max(particles, key=lambda p: score(p["best_r"]))
            g_best_pos, g_best_r = g_best["best_pos"].copy(), g_best["best_r"]

            for _ in range(n_iters - 1):
                for p in particles:
                    for n in param_names:
                        r1, r2 = random.random(), random.random()
                        p["vel"][n] = (w * p["vel"][n]
                                       + c1 * r1 * (p["best_pos"][n] - p["pos"][n])
                                       + c2 * r2 * (g_best_pos[n] - p["pos"][n]))
                        p["vel"][n] = max(-idx_ranges[n], min(idx_ranges[n], p["vel"][n]))
                        p["pos"][n] = max(0, min(idx_ranges[n], p["pos"][n] + p["vel"][n]))
                    r = evaluate(idx_to_params(p["pos"]))
                    if r:
                        results.append(r)
                        if score(r) > score(p["best_r"]):
                            p["best_pos"] = p["pos"].copy(); p["best_r"] = r
                        if score(r) > score(g_best_r):
                            g_best_pos = p["pos"].copy(); g_best_r = r
                        if best_r is None or score(r) > score(best_r): best_r = r
                    done += 1
                    yield {"type": "progress", "iter": done, "total": total, "result": r, "best": best_r}
        else:
            yield {"type": "error", "detail": f"未知方法: {method}，支持 grid/random/annealing/pso"}
            return

        successful = [r for r in results if r and r.get("status") == "ok"]
        successful.sort(key=lambda r: score(r), reverse=True)
        _last_optimization_results = successful

        yield {
            "type": "done",
            "method": method,
            "total_combinations": total,
            "successful": len(successful),
            "failed": total - len(successful),
            "results": successful,
        }

    except Exception as e:
        yield {"type": "error", "detail": str(e)}


@app.get("/")
def read_root():
    return {"status": "ok", "message": "BTC Quant Platform Backend is running."}

@app.post("/api/optimize")
def run_optimization(request: OptimizeRequest):
    """
    四种优化算法：grid（网格）/ random（随机）/ annealing（模拟退火）/ pso（粒子群）
    """
    import random, math
    global _last_optimization_results

    try:
        symbol_swap = request.symbol.replace('BTC/USDT', 'BTC/USDT:USDT')
        df = feeder.get_local_data(symbol_swap, request.timeframe)
        if df.empty:
            raise HTTPException(status_code=503, detail="数据同步中，请稍后重试。")

        param_names = list(request.grid.keys())

        # 构建每个参数的离散候选值列表
        def build_values(g: GridParam) -> list:
            vals = []
            v = g.start
            while v <= g.stop + 1e-9:
                vals.append(round(v, 8))
                v += g.step
            return vals or [g.start]

        param_values = {n: build_values(request.grid[n]) for n in param_names}

        def to_params(combo: dict) -> dict:
            return {k: int(v) if float(v).is_integer() else v for k, v in combo.items()}

        def evaluate(params: dict) -> dict | None:
            result_data, error = run_dynamic_code(request.code, df, to_params(params), timeframe=request.timeframe)
            if error or not result_data:
                return None
            m = result_data["metrics"]
            return {
                "parameters": params.copy(),
                "status": "ok",
                "net_profit_pct":   round(float(m.get("total_return_pct", 0)), 4),
                "win_rate_pct":     round(float(m.get("win_rate_pct", 0)), 4),
                "max_drawdown_pct": round(float(m.get("max_drawdown_pct", 0)), 4),
                "total_trades":     int(m.get("total_trades", 0)),
                "sharpe":           round(float(m.get("sharpe", 0) or 0), 4),
                "sortino":          round(float(m.get("sortino", 0) or 0), 4),
                "calmar":           round(float(m.get("calmar", 0) or 0), 4),
                "profit_factor":    round(float(m.get("profit_factor", 0) or 0), 4),
                "full_metrics":     m,
            }

        def score(r: dict | None) -> float:
            if r is None: return -1e9
            return float(r.get(request.target, r.get("net_profit_pct", -1e9)))

        def rand_point() -> dict:
            return {n: random.choice(param_values[n]) for n in param_names}

        results = []
        method = request.method
        total = 0

        # ── 网格搜索 ──────────────────────────────────────────────────────────
        if method == "grid":
            all_combos = list(itertools.product(*[param_values[n] for n in param_names]))
            total = len(all_combos)
            if total > 2000:
                raise HTTPException(400, f"网格组合数 {total} 超过2000上限，请减小范围或增大步长。")
            for combo in all_combos:
                params = {param_names[i]: v for i, v in enumerate(combo)}
                r = evaluate(params)
                results.append(r or {"parameters": params, "status": "error"})

        # ── 随机搜索 ──────────────────────────────────────────────────────────
        elif method == "random":
            total = request.iterations
            seen = set()
            completed = 0
            max_attempts = total * 5  # 避免无限循环
            attempts = 0
            while completed < total and attempts < max_attempts:
                attempts += 1
                params = rand_point()
                key = str(sorted(params.items()))
                if key in seen:
                    continue
                seen.add(key)
                r = evaluate(params)
                results.append(r or {"parameters": params, "status": "error"})
                completed += 1

        # ── 模拟退火 ──────────────────────────────────────────────────────────
        elif method == "annealing":
            total = request.iterations
            current = rand_point()
            current_r = evaluate(current)
            best_r = current_r
            T = 1.0
            alpha = 0.95

            if current_r:
                results.append(current_r)

            for i in range(1, total):
                T *= alpha
                # 随机改变一个参数
                neighbor = current.copy()
                key = random.choice(param_names)
                neighbor[key] = random.choice(param_values[key])

                neighbor_r = evaluate(neighbor)
                if neighbor_r:
                    results.append(neighbor_r)
                    delta = score(neighbor_r) - score(current_r)
                    if delta > 0 or (T > 1e-6 and random.random() < math.exp(delta / T)):
                        current = neighbor
                        current_r = neighbor_r
                        if score(neighbor_r) > score(best_r):
                            best_r = neighbor_r

        # ── 粒子群（PSO） ─────────────────────────────────────────────────────
        elif method == "pso":
            n_particles = max(5, min(20, request.iterations // 10))
            n_iters = max(1, request.iterations // n_particles)
            total = n_particles * n_iters
            w, c1, c2 = 0.7, 1.5, 1.5  # 惯性/个体/社会权重

            # 粒子位置用值列表中的索引表示
            idx_ranges = {n: len(param_values[n]) - 1 for n in param_names}

            def idx_to_params(idx: dict) -> dict:
                return {n: param_values[n][max(0, min(idx_ranges[n], int(round(idx[n]))))]
                        for n in param_names}

            # 初始化粒子
            particles = []
            for _ in range(n_particles):
                pos = {n: random.uniform(0, idx_ranges[n]) for n in param_names}
                vel = {n: random.uniform(-1, 1) for n in param_names}
                r = evaluate(idx_to_params(pos))
                particles.append({"pos": pos, "vel": vel, "best_pos": pos.copy(), "best_r": r})
                if r: results.append(r)

            global_best = max(particles, key=lambda p: score(p["best_r"]))
            g_best_pos = global_best["best_pos"].copy()
            g_best_r = global_best["best_r"]

            for _ in range(n_iters - 1):
                for p in particles:
                    for n in param_names:
                        r1, r2 = random.random(), random.random()
                        p["vel"][n] = (w * p["vel"][n]
                                       + c1 * r1 * (p["best_pos"][n] - p["pos"][n])
                                       + c2 * r2 * (g_best_pos[n] - p["pos"][n]))
                        p["vel"][n] = max(-idx_ranges[n], min(idx_ranges[n], p["vel"][n]))
                        p["pos"][n] = max(0, min(idx_ranges[n], p["pos"][n] + p["vel"][n]))

                    r = evaluate(idx_to_params(p["pos"]))
                    if r:
                        results.append(r)
                        if score(r) > score(p["best_r"]):
                            p["best_pos"] = p["pos"].copy()
                            p["best_r"] = r
                        if score(r) > score(g_best_r):
                            g_best_pos = p["pos"].copy()
                            g_best_r = r
        else:
            raise HTTPException(400, f"未知方法: {method}，支持 grid/random/annealing/pso")

        # 过滤掉失败结果，按目标指标排序
        successful = [r for r in results if r and r.get("status") == "ok"]
        successful.sort(key=lambda r: score(r), reverse=True)

        _last_optimization_results = successful

        return {
            "symbol": request.symbol,
            "timeframe": request.timeframe,
            "method": method,
            "total_combinations": total,
            "successful": len(successful),
            "failed": total - len(successful),
            "results": successful,
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/optimize/stream")
async def run_optimization_stream(request: OptimizeRequest):
    """
    SSE 流式版优化。每跑完一次回测推送一条 data 行,完成时推送 done 事件。
    前端用 fetch + ReadableStream 读取(因为 EventSource 只支持 GET)。

    关键设计:
    - `_build_optimizer_iterator` 内部调用同步的 `run_dynamic_code`(VectorBT 回测),
      会阻塞 event loop 导致其他请求 500/超时。
    - 用 asyncio.Queue + 后台线程跑生成器,主协程从队列拉事件 yield 给 HTTP 流。
      这样 event loop 始终空闲,既能 flush SSE,又不影响其他 API。
    """
    import asyncio
    import threading

    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()
    loop = asyncio.get_event_loop()

    def producer():
        try:
            for event in _build_optimizer_iterator(request):
                asyncio.run_coroutine_threadsafe(queue.put(event), loop).result()
        except Exception as e:
            asyncio.run_coroutine_threadsafe(
                queue.put({"type": "error", "detail": str(e)}), loop
            ).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(SENTINEL), loop)

    thread = threading.Thread(target=producer, daemon=True)
    thread.start()

    async def event_gen():
        while True:
            event = await queue.get()
            if event is SENTINEL:
                break
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 阻止 Nginx 缓冲
            "Connection": "keep-alive",
        },
    )


@app.get("/api/optimize/export-csv")
def export_optimization_csv():
    """
    导出调参结果为 TradingView Assistant 兼容 CSV。
    格式：固定指标列 + _setTime_ + _parseTime_ + _duration_ + comment + __参数名 列
    """
    global _last_optimization_results
    if not _last_optimization_results:
        raise HTTPException(status_code=404, detail="暂无调参结果，请先运行优化。")

    results = [r for r in _last_optimization_results if r.get("status") == "ok"]
    if not results:
        raise HTTPException(status_code=404, detail="暂无成功的调参结果。")

    # 动态参数列:用户勾几个就有几个,完全跟着实际跑的来
    param_names = list(results[0]["parameters"].keys())
    init_cap = 10000.0

    # ── CSV 列 → metrics key 映射表 ──────────────────────────────────────
    # 设计:CSV 列名固定(对齐 TV Assistant 行业标杆),metrics key 来自 dynamic_runner
    # 加新指标时只需在此处加一行映射,不用改其他任何地方
    # 值为 None 的列(如 "Open P&L")在所有 row 都填空字符串
    CSV_TO_METRICS: dict = {
        # 基础
        "Total P&L":                 ("net_profit_abs", 2),
        "Total P&L %":                ("total_return_pct", 4),
        "Max equity drawdown":        ("_max_dd_abs", 2),       # 计算字段
        "Max equity drawdown %":      ("max_drawdown_pct", 4),
        "Total trades":               ("total_trades", 0),
        "Profitable trades":          ("win_rate_pct", 2),
        "Profitable trades ratio":    ("_win_loss_ratio_str", None),  # 字符串
        "Profit factor":              ("profit_factor", 4),
        "Initial capital":            ("initial_capital", 2),
        "Open P&L":                   None,
        "Open P&L %":                 None,

        # Net P&L 多/空分组
        "Net P&L: All":               ("net_profit_abs", 2),
        "Net P&L %: All":             ("total_return_pct", 4),
        "Net P&L: Long":              ("net_profit_long", 2),
        "Net P&L %: Long":            ("return_pct_long", 4),
        "Net P&L: Short":             ("net_profit_short", 2),
        "Net P&L %: Short":           ("return_pct_short", 4),

        # Gross profit/loss
        "Gross profit: All":          ("gross_profit_abs", 2),
        "Gross profit %: All":        ("_gross_profit_pct", 4),
        "Gross profit: Long":         ("gross_profit_long", 2),
        "Gross profit %: Long":       None,
        "Gross profit: Short":        ("gross_profit_short", 2),
        "Gross profit %: Short":      None,
        "Gross loss: All":            ("gross_loss_abs", 2),
        "Gross loss %: All":          ("_gross_loss_pct", 4),
        "Gross loss: Long":           ("gross_loss_long", 2),
        "Gross loss %: Long":         None,
        "Gross loss: Short":          ("gross_loss_short", 2),
        "Gross loss %: Short":        None,

        # Profit factor 多/空
        "Profit factor: All":         ("profit_factor", 4),
        "Profit factor: Long":        ("_pf_long", 4),
        "Profit factor: Short":       ("_pf_short", 4),

        # 手续费 / 期望
        "Commission paid: All":       ("commission_paid", 2),
        "Commission paid: Long":      None,
        "Commission paid: Short":     None,
        "Expected payoff: All":       ("expectancy_abs", 2),
        "Expected payoff: Long":      ("expectancy_long", 2),
        "Expected payoff: Short":     ("expectancy_short", 2),

        # 基准
        "Buy & hold return":          ("benchmark_return_abs", 2),
        "Buy & hold return %":        ("benchmark_return_pct", 4),
        "Buy & hold % gain":          ("benchmark_return_pct", 4),
        "Strategy outperformance":    ("strategy_outperformance", 2),

        # 风险调整
        "Sharpe ratio":               ("sharpe", 4),
        "Sortino ratio":              ("sortino", 4),

        # 交易数 多/空
        "Total trades: All":          ("total_trades", 0),
        "Total trades: Long":         ("total_trades_long", 0),
        "Total trades: Short":        ("total_trades_short", 0),
        "Total open trades: All":     None,
        "Total open trades: Long":    None,
        "Total open trades: Short":   None,
        "Winning trades: All":        ("win_trades", 0),
        "Winning trades: Long":       ("win_trades_long", 0),
        "Winning trades: Short":      ("win_trades_short", 0),
        "Losing trades: All":         ("loss_trades", 0),
        "Losing trades: Long":        ("loss_trades_long", 0),
        "Losing trades: Short":       ("loss_trades_short", 0),
        "Percent profitable: All":    ("win_rate_pct", 2),
        "Percent profitable: Long":   ("_win_rate_long", 2),
        "Percent profitable: Short":  ("_win_rate_short", 2),

        # 平均 P&L / Win / Loss
        "Avg P&L: All":               ("expectancy_abs", 2),
        "Avg P&L %: All":             None,
        "Avg P&L: Long":              ("expectancy_long", 2),
        "Avg P&L %: Long":            None,
        "Avg P&L: Short":             ("expectancy_short", 2),
        "Avg P&L %: Short":           None,
        "Avg winning trade: All":     ("avg_win_abs", 2),
        "Avg winning trade %: All":   ("avg_win_pct", 4),
        "Avg winning trade: Long":    ("avg_win_long_abs", 2),
        "Avg winning trade %: Long":  None,
        "Avg winning trade: Short":   ("avg_win_short_abs", 2),
        "Avg winning trade %: Short": None,
        "Avg losing trade: All":      ("avg_loss_abs", 2),
        "Avg losing trade %: All":    ("avg_loss_pct", 4),
        "Avg losing trade: Long":     ("avg_loss_long_abs", 2),
        "Avg losing trade %: Long":   None,
        "Avg losing trade: Short":    ("avg_loss_short_abs", 2),
        "Avg losing trade %: Short":  None,
        "Ratio avg win / avg loss: All":   ("payoff_ratio", 4),
        "Ratio avg win / avg loss: Long":  ("payoff_long", 4),
        "Ratio avg win / avg loss: Short": ("payoff_short", 4),

        # 最大单笔盈/亏
        "Largest winning trade: All":         ("max_win_abs", 2),
        "Largest winning trade: Long":        ("max_win_long_abs", 2),
        "Largest winning trade: Short":       ("max_win_short_abs", 2),
        "Largest winning trade percent: All": ("max_win_pct", 4),
        "Largest winning trade percent: Long":  None,
        "Largest winning trade percent: Short": None,
        "Largest winner as % of gross profit: All":   ("max_win_over_gross_profit_pct", 2),
        "Largest winner as % of gross profit: Long":  None,
        "Largest winner as % of gross profit: Short": None,
        "Largest losing trade: All":          ("max_loss_abs", 2),
        "Largest losing trade: Long":         ("max_loss_long_abs", 2),
        "Largest losing trade: Short":        ("max_loss_short_abs", 2),
        "Largest losing trade percent: All":  ("max_loss_pct", 4),
        "Largest losing trade percent: Long": None,
        "Largest losing trade percent: Short": None,
        "Largest loser as % of gross loss: All":   ("max_loss_over_gross_loss_pct", 2),
        "Largest loser as % of gross loss: Long":  None,
        "Largest loser as % of gross loss: Short": None,

        # 持仓 K 线数
        "Avg # bars in trades: All":   ("avg_bars_all", 0),
        "Avg # bars in trades: Long":  ("avg_bars_long", 0),
        "Avg # bars in trades: Short": ("avg_bars_short", 0),
        "Avg # bars in winning trades: All":   ("avg_bars_win", 0),
        "Avg # bars in winning trades: Long":  None,
        "Avg # bars in winning trades: Short": None,
        "Avg # bars in losing trades: All":   ("avg_bars_loss", 0),
        "Avg # bars in losing trades: Long":  None,
        "Avg # bars in losing trades: Short": None,

        # CAGR
        "Annualized return (CAGR): All":   ("cagr_pct", 2),
        "Annualized return (CAGR): Long":  ("cagr_pct_long", 2),
        "Annualized return (CAGR): Short": ("cagr_pct_short", 2),
        "Return on initial capital: All":   ("total_return_pct", 4),
        "Return on initial capital: Long":  ("return_pct_long", 4),
        "Return on initial capital: Short": ("return_pct_short", 4),

        # 账户大小
        "Account size required":                 None,
        "Return on account size required: All":   None,
        "Return on account size required: Long":  None,
        "Return on account size required: Short": None,

        # 净利润占最大亏损 %
        "Net profit as % of largest loss: All":   ("net_profit_over_max_loss_pct", 2),
        "Net profit as % of largest loss: Long":  None,
        "Net profit as % of largest loss: Short": None,

        # 保证金 / 强平
        "Avg margin used: All":   None,
        "Max margin used":        None,
        "Margin efficiency":      None,
        "Margin calls":           ("_margin_calls", 0),  # 默认 0

        # 涨幅(Run-up)
        "Avg equity run-up duration (close-to-close)":   ("_avg_runup_duration_str", None),
        "Avg equity run-up (close-to-close)":            ("avg_runup_abs", 2),
        "Avg equity run-up (close-to-close) %":          ("avg_runup_pct", 4),
        "Max equity run-up (close-to-close)":            ("max_runup_abs", 2),
        "Max equity run-up (close-to-close) %":          ("max_runup_pct", 4),
        "Max equity run-up (intrabar)":                  ("max_runup_intrabar_abs", 2),
        "Max equity run-up (intrabar) %":                ("max_runup_intrabar_pct", 4),
        "Max equity run-up as % of initial capital (intrabar)": ("max_runup_intrabar_pct", 4),

        # 回撤详情
        "Avg equity drawdown duration (close-to-close)": ("_avg_dd_duration_str", None),
        "Avg equity drawdown (close-to-close)":          ("_avg_dd_abs", 2),
        "Avg equity drawdown (close-to-close) %":        ("avg_drawdown_pct", 4),
        "Max equity drawdown (close-to-close)":          ("_max_dd_abs", 2),
        "Max equity drawdown (close-to-close) %":        ("max_drawdown_pct", 4),
        "Max equity drawdown (intrabar)":                ("_max_dd_abs", 2),
        "Max equity drawdown (intrabar) %":              ("max_drawdown_pct", 4),
        "Max equity drawdown as % of initial capital (intrabar)": ("ftmo_drawdown_pct", 4),
        "Return of max equity drawdown":                 ("max_dd_profit_at_trough", 2),

        # 元信息
        "_setTime_":   None,
        "_parseTime_": None,
        "_duration_":  None,
        "comment":     ("_comment", None),
    }

    # TV Assistant 固定指标列(顺序固定,对齐参考样本 CSV)
    fixed_cols = [
        "Total P&L", "Total P&L %",
        "Max equity drawdown", "Max equity drawdown %",
        "Total trades", "Profitable trades", "Profitable trades ratio",
        "Profit factor", "Initial capital",
        "Open P&L", "Open P&L %",
        "Net P&L: All", "Net P&L %: All",
        "Net P&L: Long", "Net P&L %: Long",
        "Net P&L: Short", "Net P&L %: Short",
        "Gross profit: All", "Gross profit %: All",
        "Gross profit: Long", "Gross profit %: Long",
        "Gross profit: Short", "Gross profit %: Short",
        "Gross loss: All", "Gross loss %: All",
        "Gross loss: Long", "Gross loss %: Long",
        "Gross loss: Short", "Gross loss %: Short",
        "Profit factor: All", "Profit factor: Long", "Profit factor: Short",
        "Commission paid: All", "Commission paid: Long", "Commission paid: Short",
        "Expected payoff: All", "Expected payoff: Long", "Expected payoff: Short",
        "Buy & hold return", "Buy & hold return %", "Buy & hold % gain",
        "Strategy outperformance",
        "Sharpe ratio", "Sortino ratio",
        "Total trades: All", "Total trades: Long", "Total trades: Short",
        "Total open trades: All", "Total open trades: Long", "Total open trades: Short",
        "Winning trades: All", "Winning trades: Long", "Winning trades: Short",
        "Losing trades: All", "Losing trades: Long", "Losing trades: Short",
        "Percent profitable: All", "Percent profitable: Long", "Percent profitable: Short",
        "Avg P&L: All", "Avg P&L %: All",
        "Avg P&L: Long", "Avg P&L %: Long",
        "Avg P&L: Short", "Avg P&L %: Short",
        "Avg winning trade: All", "Avg winning trade %: All",
        "Avg winning trade: Long", "Avg winning trade %: Long",
        "Avg winning trade: Short", "Avg winning trade %: Short",
        "Avg losing trade: All", "Avg losing trade %: All",
        "Avg losing trade: Long", "Avg losing trade %: Long",
        "Avg losing trade: Short", "Avg losing trade %: Short",
        "Ratio avg win / avg loss: All", "Ratio avg win / avg loss: Long", "Ratio avg win / avg loss: Short",
        "Largest winning trade: All", "Largest winning trade: Long", "Largest winning trade: Short",
        "Largest winning trade percent: All", "Largest winning trade percent: Long", "Largest winning trade percent: Short",
        "Largest winner as % of gross profit: All", "Largest winner as % of gross profit: Long", "Largest winner as % of gross profit: Short",
        "Largest losing trade: All", "Largest losing trade: Long", "Largest losing trade: Short",
        "Largest losing trade percent: All", "Largest losing trade percent: Long", "Largest losing trade percent: Short",
        "Largest loser as % of gross loss: All", "Largest loser as % of gross loss: Long", "Largest loser as % of gross loss: Short",
        "Avg # bars in trades: All", "Avg # bars in trades: Long", "Avg # bars in trades: Short",
        "Avg # bars in winning trades: All", "Avg # bars in winning trades: Long", "Avg # bars in winning trades: Short",
        "Avg # bars in losing trades: All", "Avg # bars in losing trades: Long", "Avg # bars in losing trades: Short",
        "Annualized return (CAGR): All", "Annualized return (CAGR): Long", "Annualized return (CAGR): Short",
        "Return on initial capital: All", "Return on initial capital: Long", "Return on initial capital: Short",
        "Account size required",
        "Return on account size required: All", "Return on account size required: Long", "Return on account size required: Short",
        "Net profit as % of largest loss: All", "Net profit as % of largest loss: Long", "Net profit as % of largest loss: Short",
        "Avg margin used: All", "Max margin used", "Margin efficiency", "Margin calls",
        "Avg equity run-up duration (close-to-close)",
        "Avg equity run-up (close-to-close)", "Avg equity run-up (close-to-close) %",
        "Max equity run-up (close-to-close)", "Max equity run-up (close-to-close) %",
        "Max equity run-up (intrabar)", "Max equity run-up (intrabar) %",
        "Max equity run-up as % of initial capital (intrabar)",
        "Avg equity drawdown duration (close-to-close)",
        "Avg equity drawdown (close-to-close)", "Avg equity drawdown (close-to-close) %",
        "Max equity drawdown (close-to-close)", "Max equity drawdown (close-to-close) %",
        "Max equity drawdown (intrabar)", "Max equity drawdown (intrabar) %",
        "Max equity drawdown as % of initial capital (intrabar)",
        "Return of max equity drawdown",
        "_setTime_", "_parseTime_", "_duration_", "comment",
    ]
    param_cols = [f"__{p}" for p in param_names]
    header = fixed_cols + param_cols

    import math as _math
    def _r(v, d=4):
        if v is None or v == "":
            return ""
        try:
            f = float(v)
            return "" if (_math.isnan(f) or _math.isinf(f)) else round(f, d)
        except (TypeError, ValueError):
            return v if isinstance(v, str) else ""

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_NONNUMERIC)
    writer.writerow(header)

    best_score = max(float(r.get("net_profit_pct", -1e9)) for r in results)

    for i, r in enumerate(results):
        # 优先用完整 metrics(80+ 字段),fallback 到简化结果
        fm = r.get("full_metrics") or {}
        net_pct = float(r.get("net_profit_pct", 0))
        wr      = float(r.get("win_rate_pct", 0))
        trades  = int(r.get("total_trades", 0))
        win_cnt = round(trades * wr / 100) if trades else 0
        init    = float(fm.get("initial_capital") or init_cap)

        # 计算字段:metrics 里没有,但 CSV 列需要(都打 "_" 前缀)
        _max_dd_pct_v = float(fm.get("max_drawdown_pct") or r.get("max_drawdown_pct") or 0)
        _max_dd_abs   = round(_max_dd_pct_v / 100 * init, 2)
        _avg_dd_pct_v = fm.get("avg_drawdown_pct")
        _avg_dd_abs   = round(float(_avg_dd_pct_v) / 100 * init, 2) if _avg_dd_pct_v else None
        _gp           = float(fm.get("gross_profit_abs") or 0)
        _gl           = float(fm.get("gross_loss_abs") or 0)
        _gp_pct       = round(_gp / init * 100, 4) if init else None
        _gl_pct       = round(_gl / init * 100, 4) if init else None
        gll, gls      = fm.get("gross_loss_long"), fm.get("gross_loss_short")
        _pf_long      = round(float(fm.get("gross_profit_long")  or 0) / float(gll), 4) if gll else None
        _pf_short     = round(float(fm.get("gross_profit_short") or 0) / float(gls), 4) if gls else None
        tl, ts_       = fm.get("total_trades_long"), fm.get("total_trades_short")
        _wr_long      = round(float(fm.get("win_trades_long")  or 0) / float(tl)  * 100, 2) if tl  else None
        _wr_short     = round(float(fm.get("win_trades_short") or 0) / float(ts_) * 100, 2) if ts_ else None
        _wl_ratio_str = f"{win_cnt}/{trades}" if trades else ""
        _avg_dd_dur   = fm.get("avg_drawdown_duration_days")
        _avg_dd_dur_s = f"{int(_avg_dd_dur)}天" if _avg_dd_dur is not None else ""
        _avg_runup_dur   = fm.get("avg_runup_duration_days")
        _avg_runup_dur_s = f"{int(_avg_runup_dur)}天" if _avg_runup_dur is not None else ""
        _comment = "Best result." if net_pct == best_score and i == 0 else f"Rank {i+1}."

        computed = {
            "_max_dd_abs": _max_dd_abs,
            "_avg_dd_abs": _avg_dd_abs,
            "_gross_profit_pct": _gp_pct,
            "_gross_loss_pct":   _gl_pct,
            "_pf_long": _pf_long,
            "_pf_short": _pf_short,
            "_win_rate_long":  _wr_long,
            "_win_rate_short": _wr_short,
            "_win_loss_ratio_str": _wl_ratio_str,
            "_avg_dd_duration_str":    _avg_dd_dur_s,
            "_avg_runup_duration_str": _avg_runup_dur_s,
            "_comment": _comment,
            "_margin_calls": 0,
        }

        # 按映射表填充每一列(零硬编码,新增 metrics 只需在 CSV_TO_METRICS 加一行)
        row_vals: dict = {}
        for csv_col, mapping in CSV_TO_METRICS.items():
            if mapping is None:
                row_vals[csv_col] = ""
                continue
            key, decimals = mapping
            if key in computed:
                v = computed[key]
            elif key in fm:
                v = fm.get(key)
            else:
                v = None  # metrics 里没有该字段
            row_vals[csv_col] = v if decimals is None else _r(v, decimals)

        # 参数列:用户勾几个就有几个(完全动态)
        for p in param_names:
            row_vals[f"__{p}"] = r["parameters"].get(p, "")

        writer.writerow([row_vals.get(c, "") for c in header])

    from datetime import date as _date
    filename = f"BTCUSDT.P_optimize_{_date.today().strftime('%Y-%m-%d')}.csv"
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# In-memory cache for one-shot downloads from /api/backtest/dynamic
_dynamic_csv_cache:  Dict[str, str]   = {}
_dynamic_xlsx_cache: Dict[str, bytes] = {}

def _lru_set(cache: dict, key: str, value, limit: int = 50):
    cache[key] = value
    if len(cache) > limit:
        cache.pop(next(iter(cache)), None)

@app.post("/api/backtest/dynamic")
def run_dynamic_strategy(request: StrategyRequest):
    """
    无需 Supabase / 无需登录 / 无需保存 —— 直接拿代码跑出结果。
    """
    try:
        symbol_swap = request.symbol.replace('BTC/USDT', 'BTC/USDT:USDT')
        df = feeder.get_local_data(symbol_swap, request.timeframe)
        if df.empty:
            raise HTTPException(status_code=503, detail="Data is syncing in the background. Please try again in 10 seconds.")

        params_with_tf = {**(request.parameters or {}), "_timeframe": request.timeframe}
        portfolio_data, error_msg = run_dynamic_code(request.code, df, params_with_tf, timeframe=request.timeframe)
        if error_msg:
            raise HTTPException(status_code=400, detail=error_msg)

        import uuid as _uuid
        from csv_converter import vectorbt_to_tv_csv
        from xlsx_exporter import vectorbt_to_xlsx

        csv_token = ""
        xlsx_token = ""

        try:
            csv_text = vectorbt_to_tv_csv(portfolio_data, request.parameters or {}, 10000.0)
            csv_token = _uuid.uuid4().hex
            _lru_set(_dynamic_csv_cache, csv_token, csv_text)
        except Exception:
            pass

        try:
            strategy_name = (request.parameters or {}).get("_strategy_name", "自定义策略")
            xlsx_bytes = vectorbt_to_xlsx(portfolio_data, strategy_name=strategy_name, timeframe=request.timeframe)
            xlsx_token = _uuid.uuid4().hex
            _lru_set(_dynamic_xlsx_cache, xlsx_token, xlsx_bytes)
        except Exception:
            pass

        return {
            "symbol": request.symbol,
            "timeframe": request.timeframe,
            "parameters": request.parameters,
            "metrics": portfolio_data["metrics"],
            "trades": portfolio_data["trades"],
            "indicators": portfolio_data.get("indicators", {}),
            "equity": portfolio_data.get("equity", []),
            "balance": portfolio_data.get("balance", []),
            "csv_token": csv_token,
            "xlsx_token": xlsx_token,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/backtest/dynamic/csv/{token}")
def download_dynamic_csv(token: str):
    """下载上一次 /api/backtest/dynamic 生成的 191 列 TV 格式 CSV。"""
    csv_text = _dynamic_csv_cache.get(token)
    if not csv_text:
        raise HTTPException(status_code=404, detail="CSV not found or expired")
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="backtest_{token[:8]}.csv"'}
    )

@app.get("/api/backtest/dynamic/xlsx/{token}")
def download_dynamic_xlsx(token: str):
    """下载回测结果 xlsx（5个Sheet，对标TradingView格式）。"""
    from datetime import date as _date
    xlsx_bytes = _dynamic_xlsx_cache.get(token)
    if not xlsx_bytes:
        raise HTTPException(status_code=404, detail="XLSX not found or expired")
    today = _date.today().strftime("%Y-%m-%d")
    filename = f"BTC-USDT_backtest_{today}.xlsx"
    return StreamingResponse(
        iter([xlsx_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/data")
def get_k_lines(symbol: str = 'BTC/USDT', timeframe: str = '1h', limit: int = 10000):
    """
    Endpoint to fetch K-lines. 
    In SaaS mode, this strictly reads from the local cache powered by the background syncer.
    """
    try:
        df = feeder.get_local_data(symbol, timeframe)
        if df.empty:
            raise HTTPException(status_code=503, detail="Data is syncing in the background. Please try again in 10 seconds.")
            
        # Optional: respect the limit parameter
        if len(df) > limit:
            df = df.tail(limit)
        
        # Convert DataFrame to JSON serializable dictionary
        records = df.to_dict(orient='records')
        for r in records:
            r['timestamp'] = str(r['timestamp'])
            
        return {"symbol": symbol, "timeframe": timeframe, "data": records}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest")
def run_strategy(symbol: str = 'BTC/USDT', timeframe: str = '1h', s1_period: int = 55, s2_period: int = 144):
    """
    Endpoint to run VectorBT backtest on local data.
    """
    try:
        df = feeder.get_local_data(symbol, timeframe)
        if df.empty:
            raise HTTPException(status_code=404, detail="Data not found in local cache. Call /api/data first.")
            
        turtle_engine = VectorBTTurtle(df)
        results = turtle_engine.run_backtest(s1_period=s1_period, s2_period=s2_period)
        
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "parameters": {"s1_period": s1_period, "s2_period": s2_period},
            "metrics": {
                "total_return_pct": results["Total Return [%]"],
                "win_rate_pct": results["Win Rate [%]"],
                "max_drawdown_pct": results["Max Drawdown [%]"],
                "total_trades": int(results["Total Trades"])
            },
            "trades": results.get("trades", [])
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── FTMO 合规扫描 ─────────────────────────────────────────────────────────────
from ftmo_scanner import scan_ftmo_compliance, FTMO_SWING_DEFAULTS


class FtmoScanRequest(BaseModel):
    code: str
    symbol: str = 'BTC/USDT'
    timeframe: str = '4h'
    parameters: dict = {}
    initial_capital: float = 10000.0
    rules: dict = {}  # 可覆盖 FTMO_SWING_DEFAULTS（daily_loss_pct / total_loss_pct / profit_target_pct 等）


@app.post("/api/backtest/ftmo_scan")
def run_ftmo_scan(request: FtmoScanRequest):
    """
    跑一次回测，然后对 equity + trades 做 FTMO Swing 合规扫描。
    返回 4 大核心指标：每日亏损、总亏损、滚动起点、连亏 + 蒙特卡洛通过率。
    """
    try:
        symbol_swap = request.symbol.replace('BTC/USDT', 'BTC/USDT:USDT')
        df = feeder.get_local_data(symbol_swap, request.timeframe)
        if df.empty:
            raise HTTPException(status_code=503, detail="数据同步中，10秒后重试")

        params = {**(request.parameters or {}), "_timeframe": request.timeframe}
        portfolio_data, error_msg = run_dynamic_code(request.code, df, params, timeframe=request.timeframe)
        if error_msg:
            raise HTTPException(status_code=400, detail=error_msg)

        equity = portfolio_data.get("equity", [])
        trades = portfolio_data.get("trades", [])
        init_cap = portfolio_data["metrics"].get("initial_capital") or request.initial_capital

        scan = scan_ftmo_compliance(equity, trades, init_cap, rules=request.rules or None)

        return {
            "symbol": request.symbol,
            "timeframe": request.timeframe,
            "ftmo_scan": scan,
            "base_metrics": {
                "total_return_pct": portfolio_data["metrics"].get("total_return_pct"),
                "max_drawdown_pct": portfolio_data["metrics"].get("max_drawdown_pct"),
                "total_trades": portfolio_data["metrics"].get("total_trades"),
                "win_rate_pct": portfolio_data["metrics"].get("win_rate_pct"),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/ftmo/defaults")
def get_ftmo_defaults():
    """返回 FTMO Swing 默认规则，前端用来初始化规则编辑器。"""
    return {"rule_set": "FTMO_Swing", "defaults": FTMO_SWING_DEFAULTS}


if __name__ == '__main__':
    import uvicorn
    # Run the server on port 8000
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
