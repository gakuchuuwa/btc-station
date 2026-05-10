"""
Phase 3.1 API routes — mounted under /api on the main FastAPI app.
Handles: strategy CRUD, backtest submission, task polling, WS stream, CSV download.
"""
import os
import json
import re
import uuid
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, Dict
from dynamic_runner import run_dynamic_code
from data_feeder import DataFeeder

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, field_validator

# Celery imports are lazy — avoid connecting to Redis at module load time

logger = logging.getLogger(__name__)
router = APIRouter()

def _sb_url() -> str:
    return os.environ.get("SUPABASE_URL", "").strip()

def _sb_key() -> str:
    return os.environ.get("SUPABASE_SERVICE_KEY", "").strip()

# ── Supabase helper ───────────────────────────────────────────────────────────

def _sb(method: str, path: str, payload: dict | None = None, token: str | None = None):
    import requests
    headers = {
        "apikey": _sb_key(),
        "Authorization": f"Bearer {token or _sb_key()}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    url = f"{_sb_url()}/rest/v1/{path}"
    r = getattr(requests, method)(url, headers=headers, json=payload, timeout=15)
    if not r.ok:
        logger.error(f"Supabase {method.upper()} {path} → {r.status_code}: {r.text[:300]}")
        raise HTTPException(status_code=500, detail=f"数据库操作失败: {r.text[:200]}")
    return r.json() if r.content else {}


def _extract_class_name(code: str) -> str:
    """Extract the IStrategy subclass name from Python code."""
    m = re.search(r"class\s+(\w+)\s*\(.*IStrategy.*\)", code)
    if not m:
        raise ValueError("代码中未找到 IStrategy 子类定义，请确保有 `class XxxStrategy(IStrategy):` 语句")
    return m.group(1)


def _get_user_plan(user_id: str) -> str:
    """Return 'pro' or 'free'. Falls back to 'free' on any error."""
    try:
        rows = _sb("get", f"subscriptions?user_id=eq.{user_id}&select=plan&limit=1")
        if rows:
            return rows[0].get("plan", "free")
    except Exception:
        pass
    return "free"


def _count_monthly_backtests(user_id: str) -> int:
    try:
        from datetime import date
        start = date.today().replace(day=1).isoformat()
        rows = _sb("get", f"backtests?user_id=eq.{user_id}&created_at=gte.{start}&select=id")
        return len(rows)
    except Exception:
        return 0


# ── JWT auth dependency ───────────────────────────────────────────────────────

import base64 as _b64

DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"
DEV_USER_ID = "dev-user-local"

def _get_user_id(authorization: str | None = None) -> str:
    """
    Extract user_id from Supabase access token.
    Tries fast base64 JWT decode first; falls back to Supabase Auth API.
    """
    if DEV_MODE:
        return DEV_USER_ID

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization.split(" ", 1)[1]

    # Fast path: standard JWT (eyJ... format) — just decode payload, no sig verify
    if token.startswith("eyJ"):
        try:
            parts = token.split(".")
            if len(parts) == 3:
                padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
                payload = json.loads(_b64.urlsafe_b64decode(padded))
                uid = payload.get("sub")
                if uid:
                    return uid
        except Exception:
            pass

    # Fallback: call Supabase Auth API to verify token
    try:
        import requests as _req
        r = _req.get(
            f"{_sb_url()}/auth/v1/user",
            headers={
                "apikey": _sb_key(),
                "Authorization": f"Bearer {token}",
            },
            timeout=10,
        )
        if r.status_code == 200:
            return r.json()["id"]
    except Exception:
        pass

    raise HTTPException(status_code=401, detail="Token 无效，请重新登录")


from fastapi import Header

async def current_user(authorization: str = Header(default=None)) -> str:
    return _get_user_id(authorization)


# ── Models ────────────────────────────────────────────────────────────────────

class StrategyCreate(BaseModel):
    name: str
    description: str = ""
    code: str
    strategy_type: str = "vectorbt"  # "freqtrade" or "vectorbt"

    @field_validator("code")
    @classmethod
    def valid_strategy_code(cls, v):
        has_execute    = bool(re.search(r"def\s+execute\s*\(\s*df", v))
        has_istrategy  = bool(re.search(r"class\s+\w+\s*\(.*IStrategy.*\)", v))
        if not has_execute and not has_istrategy:
            raise ValueError("代码必须包含 execute(df, parameters) 函数（VectorBT格式）或 IStrategy 子类（Freqtrade格式）")
        return v


class BacktestSubmit(BaseModel):
    strategy_id: str
    timeframe: str = "4h"
    timerange: str = "20230101-20260101"
    market: str = "futures"
    initial_capital: float = 10000.0
    leverage: int = 1
    fee_pct: float = 0.05
    engine: str = ""  # Force specific engine if set: "freqtrade" or "vectorbt"
    config_overrides: dict = {}

    @field_validator("timeframe")
    @classmethod
    def valid_timeframe(cls, v):
        allowed = {"1m", "5m", "15m", "1h", "4h", "1d"}
        if v not in allowed:
            raise ValueError(f"无效周期，允许: {allowed}")
        return v

    @field_validator("market")
    @classmethod
    def valid_market(cls, v):
        if v not in ("spot", "futures"):
            raise ValueError("market 必须是 spot 或 futures")
        return v


# ── Strategy CRUD ─────────────────────────────────────────────────────────────

@router.post("/strategies", status_code=201)
async def create_strategy(body: StrategyCreate, user_id: str = Depends(current_user)):
    if "IStrategy" in body.code or "freqtrade" in body.code:
        class_name     = _extract_class_name(body.code)
        strategy_type  = "freqtrade"
    else:
        class_name     = "VectorBT"
        strategy_type  = "vectorbt"
    row = _sb("post", "strategies", {
        "user_id": user_id,
        "name": body.name,
        "description": body.description,
        "code": body.code,
        "class_name": class_name,
        "strategy_type": strategy_type,
    })
    return row


@router.get("/strategies")
async def list_strategies(user_id: str = Depends(current_user)):
    return _sb("get", f"strategies?user_id=eq.{user_id}&select=id,name,description,class_name,strategy_type,created_at&order=created_at.desc")


@router.get("/strategies/{sid}")
async def get_strategy(sid: str, user_id: str = Depends(current_user)):
    rows = _sb("get", f"strategies?id=eq.{sid}&user_id=eq.{user_id}&limit=1")
    if not rows:
        raise HTTPException(404, "策略未找到")
    return rows[0]


@router.put("/strategies/{sid}")
async def update_strategy(sid: str, body: StrategyCreate, user_id: str = Depends(current_user)):
    if "IStrategy" in body.code or "freqtrade" in body.code:
        class_name    = _extract_class_name(body.code)
        strategy_type = "freqtrade"
    else:
        class_name    = "VectorBT"
        strategy_type = "vectorbt"
    return _sb("patch", f"strategies?id=eq.{sid}&user_id=eq.{user_id}", {
        "name": body.name,
        "description": body.description,
        "code": body.code,
        "class_name": class_name,
        "strategy_type": strategy_type,
    })


@router.delete("/strategies/{sid}", status_code=204)
async def delete_strategy(sid: str, user_id: str = Depends(current_user)):
    _sb("delete", f"strategies?id=eq.{sid}&user_id=eq.{user_id}")
    return Response(status_code=204)


# ── Freqtrade → VectorBT auto-conversion ─────────────────────────────────────

_VBT_TEMPLATES = {
    "MaCrossStrategy": '''
import vectorbt as vbt
import pandas as pd

def execute(df, parameters):
    fast = parameters.get("fast_period", 20)
    slow = parameters.get("slow_period", 50)
    fast_ma = vbt.MA.run(df["close"], fast)
    slow_ma = vbt.MA.run(df["close"], slow)
    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)
    pf = vbt.Portfolio.from_signals(df["close"], entries, exits, init_cash=10000)
    indicators = {"Fast MA": fast_ma.ma, "Slow MA": slow_ma.ma}
    return pf, indicators
''',
    "RsiStrategy": '''
import vectorbt as vbt
import pandas as pd

def execute(df, parameters):
    rsi = vbt.RSI.run(df["close"], window=parameters.get("rsi_period", 14))
    entries = rsi.rsi_below(parameters.get("rsi_buy", 30))
    exits = rsi.rsi_above(parameters.get("rsi_sell", 70))
    pf = vbt.Portfolio.from_signals(df["close"], entries, exits, init_cash=10000)
    indicators = {"RSI": rsi.rsi}
    return pf, indicators
''',
    "MacdStrategy": '''
import vectorbt as vbt
import pandas as pd

def execute(df, parameters):
    macd = vbt.MACD.run(df["close"],
        fast_window=parameters.get("fast", 12),
        slow_window=parameters.get("slow", 26),
        signal_window=parameters.get("signal", 9))
    entries = macd.macd_above(macd.signal) & macd.macd_above(0)
    exits = macd.macd_below(macd.signal)
    pf = vbt.Portfolio.from_signals(df["close"], entries, exits, init_cash=10000)
    indicators = {"MACD": macd.macd, "Signal": macd.signal}
    return pf, indicators
''',
    "BollingerBreakoutStrategy": '''
import vectorbt as vbt
import pandas as pd

def execute(df, parameters):
    bb = vbt.BBANDS.run(df["close"],
        window=parameters.get("bb_period", 20),
        alpha=parameters.get("bb_std", 2.0))
    entries = df["close"] < bb.lower
    exits = df["close"] > bb.upper
    pf = vbt.Portfolio.from_signals(df["close"], entries, exits, init_cash=10000)
    indicators = {"BB Upper": bb.upper, "BB Middle": bb.middle, "BB Lower": bb.lower}
    return pf, indicators
''',
}

# Generic fallback: simple MA cross
_VBT_GENERIC = '''
import vectorbt as vbt
import pandas as pd

def execute(df, parameters):
    fast_ma = vbt.MA.run(df["close"], 20)
    slow_ma = vbt.MA.run(df["close"], 50)
    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)
    pf = vbt.Portfolio.from_signals(df["close"], entries, exits, init_cash=10000)
    indicators = {"Fast MA (20)": fast_ma.ma, "Slow MA (50)": slow_ma.ma}
    return pf, indicators
'''

def _freqtrade_to_vectorbt(class_name: str, freqtrade_code: str) -> str:
    """Convert a Freqtrade IStrategy class name to equivalent VectorBT execute() code."""
    return _VBT_TEMPLATES.get(class_name, _VBT_GENERIC)


# ── Historical candles from local cache ────────────────────────────────────────

@router.get("/candles/{timeframe}")
async def get_cached_candles(timeframe: str):
    """Return all locally-cached candles for BTC/USDT in the given timeframe."""
    import pandas as pd
    feeder = DataFeeder('okx')
    df = feeder.get_local_data("BTC/USDT", timeframe)
    if df.empty:
        df = feeder.fetch_ohlcv("BTC/USDT", timeframe, limit=5000)
    if df.empty:
        raise HTTPException(404, "暂无该周期的K线数据")
    
    # Ensure timestamp column is datetime
    if 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp'])
    
    # Convert to list of {time, open, high, low, close, volume}
    records = []
    for _, row in df.iterrows():
        ts = row.get('timestamp') if 'timestamp' in df.columns else row.name
        try:
            unix_ts = int(pd.Timestamp(ts).timestamp())
        except Exception:
            continue
        records.append({
            "time": unix_ts,
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row.get("volume", 0)),
        })
    
    # Sort and deduplicate
    records.sort(key=lambda r: r["time"])
    seen = set()
    unique = []
    for r in records:
        if r["time"] not in seen:
            seen.add(r["time"])
            unique.append(r)
    
    return {"candles": unique}


# ── Built-in templates ────────────────────────────────────────────────────────

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "strategies")
TEMPLATES = [
    {"id": "MaCrossStrategy",        "name": "MA 双均线交叉",     "category": "trend"},
    {"id": "RsiStrategy",             "name": "RSI 超买超卖",      "category": "mean-reversion"},
    {"id": "MacdStrategy",            "name": "MACD 金叉死叉",     "category": "trend"},
    {"id": "BollingerBreakoutStrategy","name": "布林带突破",        "category": "breakout"},
    {"id": "DcaStrategy",             "name": "DCA 定投补仓",      "category": "dca"},
    {"id": "AtrChannelStrategy",      "name": "ATR 通道动态止损",  "category": "trend"},
]


@router.get("/templates")
async def list_templates():
    return TEMPLATES


@router.get("/templates/{tid}/code")
async def get_template_code(tid: str):
    safe = re.sub(r"[^A-Za-z0-9_]", "", tid)
    path = os.path.join(TEMPLATE_DIR, f"{safe}.py")
    if not os.path.exists(path):
        raise HTTPException(404, "模板未找到")
    with open(path, "r", encoding="utf-8") as f:
        return {"id": tid, "code": f.read()}


# ── Backtest submission ───────────────────────────────────────────────────────

@router.post("/backtests", status_code=202)
async def submit_backtest(body: BacktestSubmit, user_id: str = Depends(current_user)):
    plan = _get_user_plan(user_id)

    # Fetch strategy code
    rows = _sb("get", f"strategies?id=eq.{body.strategy_id}&user_id=eq.{user_id}&limit=1")
    if not rows:
        raise HTTPException(404, "策略未找到")
    strategy = rows[0]
    code = strategy["code"]
    class_name = strategy.get("class_name") or _extract_class_name(code)

    # Parse timerange into start/end dates for NOT NULL columns
    tr = body.timerange  # e.g. "20230101-20260101"
    try:
        from datetime import datetime as _dt
        parts = tr.split("-")
        start_date = _dt.strptime(parts[0], "%Y%m%d").date().isoformat()
        end_date   = _dt.strptime(parts[1], "%Y%m%d").date().isoformat()
    except Exception:
        start_date = "2023-01-01"
        end_date   = "2026-01-01"

    # Create backtest record
    bt_row = _sb("post", "backtests", {
        "user_id": user_id,
        "strategy_id": body.strategy_id,
        "status": "pending",
        "start_date": start_date,
        "end_date": end_date,
        "metrics": {},
        "trades": [],
        "config": {
            "timeframe": body.timeframe,
            "timerange": body.timerange,
            "market": body.market,
            "initial_capital": body.initial_capital,
            "leverage": body.leverage,
            "fee_pct": body.fee_pct,
        },
    })
    backtest_id = bt_row[0]["id"] if isinstance(bt_row, list) else bt_row.get("id", str(uuid.uuid4()))

    task_id = str(uuid.uuid4())

    # Run backtest in background thread (Celery used only when Redis available on Railway)
    import threading

    def _run_in_thread():
        logger.info(f"[BT {backtest_id[:8]}] 线程启动")
        from csv_converter import vectorbt_to_tv_csv, validate_csv
        raw = None  # 初始化，防止 engine 分支都未命中时 NameError
        csv_text = ""
        try:
            def _log(line: str):
                logger.info(f"[BT {backtest_id[:8]}] {line}")

            _sb("patch", f"backtests?id=eq.{backtest_id}", {"status": "running"})

            engine_to_use = body.engine or strategy.get("strategy_type", "vectorbt")
            
            # Auto-detect: if freqtrade is not installed, fallback to vectorbt
            if engine_to_use == "freqtrade":
                try:
                    import importlib
                    importlib.import_module("freqtrade")
                except ImportError:
                    _log("⚠ freqtrade 未安装，自动切换到 VectorBT 引擎")
                    engine_to_use = "vectorbt"
            
            _log(f"使用回测引擎: {engine_to_use}")

            if engine_to_use == "vectorbt":
                # VectorBT Path
                feeder = DataFeeder('okx')
                df = feeder.get_local_data("BTC/USDT", body.timeframe)
                if df.empty:
                    _log("本地缓存无数据，尝试抓取最近数据...")
                    df = feeder.fetch_ohlcv("BTC/USDT", body.timeframe, limit=2000)
                
                # If the code is Freqtrade format (IStrategy), auto-generate VectorBT code
                vbt_code = code
                if "IStrategy" in code or "freqtrade" in code:
                    _log("检测到 Freqtrade 格式策略，自动转换为 VectorBT 格式...")
                    vbt_code = _freqtrade_to_vectorbt(class_name, code)
                    _log(f"转换完成，使用 VectorBT 执行")
                
                res_data, err = run_dynamic_code(vbt_code, df, body.config_overrides, timeframe=body.timeframe)
                if err:
                    raise RuntimeError(f"VectorBT 执行错误: {err}")
                
                # Normalize VectorBT trades to Freqtrade format for frontend compatibility
                normalized_trades = []
                for t in res_data["trades"]:
                    # Parse timestamps to milliseconds (frontend expects open_timestamp in ms)
                    entry_ts = t.get("Entry Timestamp", "")
                    exit_ts = t.get("Exit Timestamp", "")
                    try:
                        import pandas as _pd
                        entry_ms = int(_pd.Timestamp(entry_ts).timestamp() * 1000) if entry_ts else 0
                        exit_ms = int(_pd.Timestamp(exit_ts).timestamp() * 1000) if exit_ts else 0
                    except Exception:
                        entry_ms = 0
                        exit_ms = 0
                    
                    normalized_trades.append({
                        "pair": "BTC/USDT",
                        "open_date": str(entry_ts),
                        "close_date": str(exit_ts),
                        "open_timestamp": entry_ms,
                        "close_timestamp": exit_ms,
                        "open_rate": t.get("Entry Price", 0),
                        "close_rate": t.get("Exit Price", 0),
                        "profit_ratio": t.get("Return", 0),
                        "profit_abs": t.get("PnL", 0),
                        "is_short": str(t.get("Direction", "Long")).lower() == "short",
                    })
                
                # Mock a 'raw' dict similar to freqtrade for the downstream processing
                raw = {
                    "trades": normalized_trades,
                    "strategy_comparison": [{
                        "profit_total": res_data["metrics"]["total_return_pct"] / 100,
                        "max_drawdown_account": res_data["metrics"]["max_drawdown_pct"] / 100,
                        "winrate": res_data["metrics"]["win_rate_pct"] / 100,
                        "trades": res_data["metrics"]["total_trades"]
                    }],
                    "results_per_pair": []
                }
                # VectorBT indicators for charting
                _sb("patch", f"backtests?id=eq.{backtest_id}", {
                    "config": {**body.model_dump(), "indicators": res_data.get("indicators", {})}
                })
                csv_text = vectorbt_to_tv_csv(res_data, {}, body.initial_capital)
                _log("VectorBT 回测完成")

            if raw is None:
                raise RuntimeError(f"未识别的回测引擎: {engine_to_use}（仅支持 vectorbt）")

            summary = (raw.get("strategy_comparison") or raw.get("results_per_pair") or [{}])[0]
            trades_raw = raw.get("trades", [])
            if not trades_raw:
                strat_block = raw.get("strategy", {})
                if isinstance(strat_block, dict):
                    for v in strat_block.values():
                        if isinstance(v, dict) and isinstance(v.get("trades"), list):
                            trades_raw = v["trades"]
                            break
            # 还是空就从 results_per_pair 找
            if not trades_raw:
                for p in (raw.get("results_per_pair") or []):
                    if isinstance(p.get("trades"), list):
                        trades_raw += p["trades"]

            # total_trades 优先用 summary 里的（最权威），fallback 才数 trades_raw
            total_trades_summary = summary.get("trades") or summary.get("total_trades") or 0

            import math
            def sanitize_nan(obj):
                if isinstance(obj, float):
                    return None if math.isnan(obj) or math.isinf(obj) else obj
                elif isinstance(obj, dict):
                    return {k: sanitize_nan(v) for k, v in obj.items()}
                elif isinstance(obj, list):
                    return [sanitize_nan(x) for x in obj]
                return obj

            def _safe_f(v):
                if v is None: return 0
                try:
                    f = float(v)
                    return 0 if math.isnan(f) or math.isinf(f) else f
                except Exception:
                    return 0

            metrics = {
                "net_profit_pct": round(_safe_f(summary.get("profit_total")) * 100, 4),
                "max_drawdown_pct": round(_safe_f(summary.get("max_drawdown_account")) * 100, 4),
                "win_rate_pct": round(_safe_f(summary.get("winrate")) * 100, 2),
                "total_trades": int(total_trades_summary) if total_trades_summary else len(trades_raw),
                "sharpe": summary.get("sharpe"),
                "sortino": summary.get("sortino"),
                "profit_factor": summary.get("profit_factor"),
            }
            
            metrics = sanitize_nan(metrics)
            trades_clean = sanitize_nan(trades_raw[:200])

            logger.info(f"[BT {backtest_id[:8]}] metrics={metrics}, trades_raw_count={len(trades_raw)}")
            _sb("patch", f"backtests?id=eq.{backtest_id}", {
                "status": "completed",
                "metrics": json.dumps(metrics),
                "trades": json.dumps(trades_clean),
                "csv_data": csv_text,
            })
        except Exception as e:
            import traceback
            logger.error(f"[BT {backtest_id[:8]}] 线程异常: {e}\n{traceback.format_exc()}")
            _sb("patch", f"backtests?id=eq.{backtest_id}", {
                "status": "failed",
                "error_message": str(e)[:1000],
            })

    threading.Thread(target=_run_in_thread, daemon=True).start()

    _sb("patch", f"backtests?id=eq.{backtest_id}", {"celery_task_id": task_id})

    return {"task_id": task_id, "backtest_id": backtest_id, "status": "pending"}


# ── Task status polling ───────────────────────────────────────────────────────

@router.get("/backtests/{backtest_id}")
async def get_backtest(backtest_id: str, user_id: str = Depends(current_user)):
    rows = _sb("get", f"backtests?id=eq.{backtest_id}&user_id=eq.{user_id}&limit=1")
    if not rows:
        raise HTTPException(404, "回测记录未找到")
    row = rows[0]
    result = None
    if row.get("status") == "completed" and row.get("metrics"):
        result = {
            "metrics": json.loads(row["metrics"]) if isinstance(row["metrics"], str) else row["metrics"],
            "trades": json.loads(row["trades"]) if row.get("trades") and isinstance(row["trades"], str) else (row.get("trades") or []),
        }
    return {
        "backtest_id": backtest_id,
        "status": row.get("status"),
        "config": row.get("config"),
        "result": result,
        "error": row.get("error_message"),
        "created_at": row.get("created_at"),
        "completed_at": row.get("completed_at"),
    }


# ── WebSocket progress stream ─────────────────────────────────────────────────

@router.websocket("/backtests/{backtest_id}/stream")
async def backtest_stream(websocket: WebSocket, backtest_id: str):
    await websocket.accept()
    try:
        # Poll Supabase until terminal state or WS closes
        while True:
            rows = _sb("get", f"backtests?id=eq.{backtest_id}&select=status,celery_task_id,metrics,error_message&limit=1")
            if not rows:
                await websocket.send_json({"type": "error", "message": "回测记录未找到"})
                break

            row = rows[0]
            status = row.get("status", "pending")
            celery_id = row.get("celery_task_id")

            # Try to get live log from Celery
            log_line = None
            if celery_id:
                try:
                    from celery.result import AsyncResult
                    from celery_app import celery_app
                    ar = AsyncResult(celery_id, app=celery_app)
                    if ar.state == "PROGRESS":
                        info = ar.info or {}
                        log_line = info.get("log")
                except Exception:
                    pass

            msg: dict = {"type": "status", "value": status}
            await websocket.send_json(msg)

            if log_line:
                await websocket.send_json({"type": "log", "line": log_line, "level": "info"})

            if status == "completed":
                metrics = row.get("metrics")
                if metrics:
                    await websocket.send_json({
                        "type": "result",
                        "result": json.loads(metrics) if isinstance(metrics, str) else metrics,
                    })
                break

            if status == "failed":
                await websocket.send_json({
                    "type": "error",
                    "message": row.get("error_message", "未知错误"),
                })
                break

            await asyncio.sleep(2)

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── CSV download ──────────────────────────────────────────────────────────────

@router.get("/backtests/{backtest_id}/csv")
async def download_csv(backtest_id: str, user_id: str = Depends(current_user)):
    rows = _sb("get", f"backtests?id=eq.{backtest_id}&user_id=eq.{user_id}&select=csv_data,config,status&limit=1")
    if not rows:
        raise HTTPException(404, "回测记录未找到")
    row = rows[0]
    if row.get("status") != "completed":
        raise HTTPException(400, "回测尚未完成")
    csv_data = row.get("csv_data", "")
    if not csv_data:
        raise HTTPException(404, "CSV 文件未生成")

    cfg = row.get("config", {})
    tf = cfg.get("timeframe", "4h") if cfg else "4h"
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"BTC-USDT-SWAP_{tf}_{backtest_id[:8]}_{today}.csv"

    return Response(
        content=csv_data.encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Quota info ────────────────────────────────────────────────────────────────

@router.get("/quota")
async def get_quota(user_id: str = Depends(current_user)):
    plan = _get_user_plan(user_id)
    used = _count_monthly_backtests(user_id)
    limit = 5 if plan == "free" else None
    from datetime import date
    today = date.today()
    if today.month == 12:
        next_reset = date(today.year + 1, 1, 1).isoformat()
    else:
        next_reset = date(today.year, today.month + 1, 1).isoformat()
    return {
        "plan": plan,
        "backtests_used": used,
        "backtests_limit": limit,
        "next_reset": next_reset,
    }
