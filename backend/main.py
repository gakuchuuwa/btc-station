from dotenv import load_dotenv
import pathlib
load_dotenv(pathlib.Path(__file__).parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Dict, Any
from data_feeder import DataFeeder
from strategy import VectorBTTurtle  # lazy-loads vectorbt only when /api/backtest is called
import numpy as np
from dynamic_runner import run_dynamic_code
import json
import io
import csv
import itertools

import threading
from contextlib import asynccontextmanager

# Phase 3.1 routes
from api_v31 import router as router_v31

feeder = DataFeeder('okx')

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Run the data preloader in a background thread
    print("[System] Starting background data syncer...")
    thread = threading.Thread(target=feeder.preload_cache, kwargs={'symbol': 'BTC/USDT', 'timeframes': ['1h', '4h', '1d'], 'limit': 16500})
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
    grid: Dict[str, GridParam]  # e.g. {"s1_period": {"start":20,"stop":80,"step":5}}

# In-memory store for last optimization results (for CSV export)
_last_optimization_results: list = []

@app.get("/")
def read_root():
    return {"status": "ok", "message": "BTC Quant Platform Backend is running."}

@app.post("/api/optimize")
def run_optimization(request: OptimizeRequest):
    """
    MT5-style grid search: iterates over all parameter combinations
    and returns a matrix of results compatible with btc-panel CSV format.
    """
    global _last_optimization_results
    try:
        # 1. Read purely from cache for multi-user safety
        df = feeder.get_local_data(request.symbol, request.timeframe)
        if df.empty:
            raise HTTPException(status_code=503, detail="Data is currently syncing in the background. Please try again in a few seconds.")

        # 2. Build parameter grid (MT5-style: start, step, stop)
        param_names = list(request.grid.keys())
        param_ranges = []
        for name in param_names:
            g = request.grid[name]
            values = []
            v = g.start
            while v <= g.stop + 1e-9:
                values.append(round(v, 8))
                v += g.step
            param_ranges.append(values)

        all_combinations = list(itertools.product(*param_ranges))
        total = len(all_combinations)

        if total > 2000:
            raise HTTPException(
                status_code=400,
                detail=f"Grid too large ({total} combinations). Reduce range or increase step size."
            )

        # 3. Run backtest for each combination
        results = []
        for combo in all_combinations:
            parameters = {param_names[i]: int(v) if float(v).is_integer() else v
                         for i, v in enumerate(combo)}
            result_data, error = run_dynamic_code(request.code, df, parameters)
            if error:
                # Skip failed combos, record as failed
                results.append({
                    "parameters": parameters,
                    "status": "error",
                    "error": error[:200]
                })
                continue

            m = result_data["metrics"]
            results.append({
                "parameters": parameters,
                "status": "ok",
                "net_profit_pct":    round(m.get("total_return_pct", 0), 4),
                "win_rate_pct":      round(m.get("win_rate_pct", 0), 4),
                "max_drawdown_pct":  round(m.get("max_drawdown_pct", 0), 4),
                "total_trades":      int(m.get("total_trades", 0)),
            })

        # Score and rank using quant-lab.org logic
        from optimizer.scorer import rank_results
        ranked_results = rank_results(results)

        # Cache for CSV export
        _last_optimization_results = ranked_results

        successful = [r for r in ranked_results if r.get("status") == "ok"]
        return {
            "symbol": request.symbol,
            "timeframe": request.timeframe,
            "total_combinations": total,
            "successful": len(successful),
            "failed": total - len(successful),
            "results": ranked_results
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/optimize/export-csv")
def export_optimization_csv():
    """
    Exports the last optimization results as a btc-panel-compatible CSV.
    Column names match exactly what btc-panel's csvParser.js expects,
    including the '__' prefix for strategy parameters (required for robustness scoring).
    """
    global _last_optimization_results
    if not _last_optimization_results:
        raise HTTPException(status_code=404, detail="No optimization results found. Run /api/optimize first.")

    successful = [r for r in _last_optimization_results if r.get("status") == "ok"]
    if not successful:
        raise HTTPException(status_code=404, detail="No successful results to export.")

    # Determine parameter names from first result
    param_names = list(successful[0]["parameters"].keys())

    output = io.StringIO()
    writer = csv.writer(output)

    # Header row: btc-panel expected column names + __ prefixed param columns
    header = [
        "Net profit %: All",
        "Percent profitable: All",
        "Max equity drawdown %",
        "Total trades: All",
        "Profit factor: All",
        "Sharpe ratio",
        "Sortino ratio",
        "Initial Capital: All",
        "Gross profit: All",
        "Gross loss: All",
    ] + [f"__{p}" for p in param_names]
    writer.writerow(header)

    for r in successful:
        net_pct = r["net_profit_pct"]
        # Estimate gross profit/loss from net and drawdown (approximation)
        # btc-panel uses these for profit factor if not explicitly provided
        init_cap = 10000
        gross_profit = max(0, net_pct / 100 * init_cap * 1.5)
        gross_loss   = max(0, gross_profit - net_pct / 100 * init_cap)
        profit_factor = round(gross_profit / gross_loss, 4) if gross_loss > 0 else 99.0

        row = [
            round(net_pct, 4),
            round(r["win_rate_pct"], 4),
            round(r["max_drawdown_pct"], 4),
            r["total_trades"],
            profit_factor,
            "",  # Sharpe — not available from current stats
            "",  # Sortino — not available from current stats
            init_cap,
            round(gross_profit, 4),
            round(gross_loss, 4),
        ] + [r["parameters"].get(p, "") for p in param_names]
        writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=quant_lab_optimization.csv"}
    )


@app.post("/api/strategy/save")
def save_strategy(request: StrategyRequest):
    """
    Saves the user-provided strategy code to disk so the live daemon can run it.
    """
    try:
        with open("custom_strategy.py", "w", encoding="utf-8") as f:
            f.write(request.code)
        return {"status": "success", "message": "Strategy saved successfully as custom_strategy.py"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/backtest/dynamic")
def run_dynamic_strategy(request: StrategyRequest):
    """
    Endpoint to run user-provided strategy code.
    """
    try:
        # SaaS mode: Read purely from cache for multi-user safety
        df = feeder.get_local_data(request.symbol, request.timeframe)
        if df.empty:
            raise HTTPException(status_code=503, detail="Data is syncing in the background. Please try again in 10 seconds.")
            
        portfolio_data, error_msg = run_dynamic_code(request.code, df, request.parameters)
        if error_msg:
            raise HTTPException(status_code=400, detail=error_msg)
            
        return {
            "symbol": request.symbol,
            "timeframe": request.timeframe,
            "parameters": request.parameters,
            "metrics": portfolio_data["metrics"],
            "trades": portfolio_data["trades"],
            "indicators": portfolio_data.get("indicators", {}),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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

if __name__ == '__main__':
    import uvicorn
    # Run the server on port 8000
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
