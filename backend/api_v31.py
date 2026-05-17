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
_DEV_USER_ID_CACHE: str | None = None

def _ensure_dev_user() -> str:
    """Create (or find) a dev user in Supabase Auth so the UUID is real."""
    global _DEV_USER_ID_CACHE
    if _DEV_USER_ID_CACHE:
        return _DEV_USER_ID_CACHE

    import requests as _req
    email = "dev@btcstation.local"
    headers = {
        "apikey": _sb_key(),
        "Authorization": f"Bearer {_sb_key()}",
        "Content-Type": "application/json",
    }
    # Try to list existing users with this email
    try:
        r = _req.get(
            f"{_sb_url()}/auth/v1/admin/users",
            headers=headers, timeout=10,
        )
        if r.ok:
            for u in r.json().get("users", []):
                if u.get("email") == email:
                    _DEV_USER_ID_CACHE = u["id"]
                    logger.info(f"[DEV] Found existing dev user: {_DEV_USER_ID_CACHE}")
                    return _DEV_USER_ID_CACHE
    except Exception as e:
        logger.warning(f"[DEV] Failed to list users: {e}")

    # Create new dev user
    try:
        r = _req.post(
            f"{_sb_url()}/auth/v1/admin/users",
            headers=headers,
            json={
                "email": email,
                "password": "dev-password-btcstation-2024",
                "email_confirm": True,
                "user_metadata": {"role": "dev"},
            },
            timeout=10,
        )
        if r.ok:
            _DEV_USER_ID_CACHE = r.json()["id"]
            logger.info(f"[DEV] Created dev user: {_DEV_USER_ID_CACHE}")
            return _DEV_USER_ID_CACHE
        else:
            logger.error(f"[DEV] Create user failed: {r.status_code} {r.text[:200]}")
    except Exception as e:
        logger.error(f"[DEV] Create user exception: {e}")

    # Last resort fallback
    _DEV_USER_ID_CACHE = "00000000-0000-0000-0000-000000000000"
    return _DEV_USER_ID_CACHE

def _get_user_id(authorization: str | None = None) -> str:
    """
    Extract user_id from Supabase access token.
    Tries fast base64 JWT decode first; falls back to Supabase Auth API.
    """
    if DEV_MODE:
        return _ensure_dev_user()

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


# ── Historical candles from local cache ────────────────────────────────────────

@router.get("/candles/{timeframe}")
async def get_cached_candles(timeframe: str):
    """Return all locally-cached candles for BTC/USDT in the given timeframe.

    API 只读 CSV 缓存，不主动触发 fetch_ohlcv：
    后台 data_syncer 线程（main.py lifespan）负责写盘，API 仅读取。
    这样避免 API 和 syncer 并发写同一个 CSV 导致互相覆盖（如 syncer 拉到 12600 根
    后被 API 触发的 fetch_ohlcv 覆盖成 6600 根）。
    若 CSV 还未建立（syncer 仍在拉取），返回 503 让前端重试。
    """
    import pandas as pd
    feeder = DataFeeder('okx')
    df = feeder.get_local_data("BTC/USDT", timeframe)
    if df.empty:
        raise HTTPException(503, "数据正在初始化，请稍后重试")

    # Ensure timestamp is naive UTC (no timezone info, already in UTC)
    if 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp']).dt.tz_localize(None)

    # Convert to list of {time, open, high, low, close, volume}
    records = []
    for _, row in df.iterrows():
        ts = row.get('timestamp') if 'timestamp' in df.columns else row.name
        try:
            unix_ts = int(pd.Timestamp(ts).value // 10**9)  # nanoseconds→seconds，避免本地时区偏移
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
    {"id": "MacdStrategy",            "name": "MACD 金叉死叉",     "category": "trend"},
    {"id": "DcaStrategy",             "name": "DCA 定投补仓",      "category": "dca"},
    {"id": "AtrChannelStrategy",      "name": "ATR 通道动态止损",  "category": "trend"},
    {"id": "TurtleSslDualStrategy",   "name": "海龟SSL双系统6形态","category": "trend"},
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
        from csv_converter import vectorbt_to_tv_csv
        csv_text = ""
        try:
            def _log(line: str):
                logger.info(f"[BT {backtest_id[:8]}] {line}")

            _sb("patch", f"backtests?id=eq.{backtest_id}", {"status": "running"})

            feeder = DataFeeder('okx')
            df = feeder.get_local_data("BTC/USDT", body.timeframe)
            if df.empty:
                _log("本地缓存无数据，尝试抓取最近数据...")
                df = feeder.fetch_ohlcv("BTC/USDT", body.timeframe, limit=2000)

            res_data, err = run_dynamic_code(code, df, body.config_overrides, timeframe=body.timeframe)
            if err:
                raise RuntimeError(f"VectorBT 执行错误: {err}")

            _sb("patch", f"backtests?id=eq.{backtest_id}", {
                "config": {**body.model_dump(), "indicators": res_data.get("indicators", {})}
            })
            # 将策略使用的参数透传给 CSV 导出，使各参数列能正确显示
            params_dict = res_data.get("metrics", {}).get("raw_parameters", {})
            csv_text = vectorbt_to_tv_csv(res_data, params_dict, body.initial_capital)
            _log("VectorBT 回测完成")

            raw = {
                "trades": res_data["trades"],
                "strategy_comparison": [{
                    "profit_total": res_data["metrics"]["total_return_pct"] / 100,
                    "max_drawdown_account": res_data["metrics"]["max_drawdown_pct"] / 100,
                    "winrate": res_data["metrics"]["win_rate_pct"] / 100,
                    "trades": res_data["metrics"]["total_trades"],
                }],
                "results_per_pair": [],
            }

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
            # 注意: 此处截断仅影响写入 Supabase 数据库的持久化记录。
            # Supabase JSON 列有行大小限制,交易过多会导致写入失败。
            # 不影响: 策略研发页 S3 实时回测(直接返回完整 trades)、蒙特卡洛(用 sessionStorage)。
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

    return {"backtest_id": backtest_id, "status": "pending"}


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
            rows = _sb("get", f"backtests?id=eq.{backtest_id}&select=status,metrics,error_message&limit=1")
            if not rows:
                await websocket.send_json({"type": "error", "message": "回测记录未找到"})
                break

            row = rows[0]
            status = row.get("status", "pending")

            await websocket.send_json({"type": "status", "value": status})

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


# ── Monte Carlo ───────────────────────────────────────────────────────────────

class MonteCarloRequest(BaseModel):
    code: str
    parameters: dict = {}
    timeframe: str = "4h"
    n_simulations: int = 200
    mode: str = "trade_shuffle"  # "trade_shuffle" | "param_perturbation" | "price_bootstrap"

    @field_validator("n_simulations")
    @classmethod
    def clamp_sims(cls, v):
        return max(50, min(v, 1000))

    @field_validator("mode")
    @classmethod
    def valid_mode(cls, v):
        allowed = {"trade_shuffle", "param_perturbation", "price_bootstrap"}
        if v not in allowed:
            raise ValueError(f"mode 必须是 {allowed} 之一")
        return v


def _equity_from_trades(trades: list, initial: float) -> list:
    """从交易列表重建权益曲线，返回每笔交易后的权益值列表。"""
    eq = initial
    curve = [eq]
    for t in trades:
        pnl = t.get("PnL", 0) or 0
        eq += float(pnl)
        curve.append(eq)
    return curve


def _metrics_from_equity(equity: list, initial: float) -> dict:
    import math
    if len(equity) < 2:
        return {"total_return_pct": 0, "max_drawdown_pct": 0, "sharpe": None}
    final = equity[-1]
    total_return = (final - initial) / initial * 100

    peak = equity[0]
    max_dd = 0.0
    for v in equity:
        if v > peak:
            peak = v
        dd = (peak - v) / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

    rets = [(equity[i] - equity[i - 1]) / equity[i - 1] for i in range(1, len(equity)) if equity[i - 1] != 0]
    if len(rets) > 1:
        mean_r = sum(rets) / len(rets)
        std_r = (sum((r - mean_r) ** 2 for r in rets) / len(rets)) ** 0.5
        sharpe = (mean_r / std_r * (252 ** 0.5)) if std_r > 0 else None
    else:
        sharpe = None

    return {
        "total_return_pct": round(total_return, 2),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe": round(sharpe, 3) if sharpe is not None and not math.isnan(sharpe) else None,
    }


@router.post("/monte-carlo/trade-shuffle")
async def mc_trade_shuffle(body: MonteCarloRequest):
    """
    模式1：交易序列随机化
    对历史回测的 trades 随机打乱顺序，模拟不同运气下的权益曲线分布。
    """
    import random
    import math

    feeder = DataFeeder('okx')
    df = feeder.get_local_data("BTC/USDT:USDT", body.timeframe)
    if df.empty:
        df = feeder.get_local_data("BTC/USDT", body.timeframe)
    if df.empty:
        raise HTTPException(400, "无本地K线数据，请先运行数据更新")

    res, err = run_dynamic_code(body.code, df.copy(), body.parameters, timeframe=body.timeframe)
    if err:
        raise HTTPException(400, f"策略执行失败: {err}")

    trades = res.get("trades", [])
    if len(trades) < 5:
        raise HTTPException(400, f"交易笔数不足（{len(trades)} 笔），无法进行蒙特卡洛分析")

    initial = body.parameters.get("initial_capital", 10000.0)
    base_metrics = _metrics_from_equity(_equity_from_trades(trades, initial), initial)

    rng = random.Random(42)
    sim_returns = []
    sim_drawdowns = []
    sim_sharpes = []
    equity_curves = []  # 最多返回 100 条曲线用于绘图

    for i in range(body.n_simulations):
        shuffled = trades[:]
        rng.shuffle(shuffled)
        eq = _equity_from_trades(shuffled, initial)
        m = _metrics_from_equity(eq, initial)
        sim_returns.append(m["total_return_pct"])
        sim_drawdowns.append(m["max_drawdown_pct"])
        if m["sharpe"] is not None:
            sim_sharpes.append(m["sharpe"])
        if i < 100:
            equity_curves.append(eq)

    def _pct(lst, p):
        s = sorted(lst)
        idx = int(len(s) * p / 100)
        return round(s[min(idx, len(s) - 1)], 2)

    def _mean(lst):
        return round(sum(lst) / len(lst), 2) if lst else None

    return {
        "mode": "trade_shuffle",
        "n_trades": len(trades),
        "n_simulations": body.n_simulations,
        "base": base_metrics,
        "equity_curves": equity_curves,
        "stats": {
            "total_return": {
                "p5":  _pct(sim_returns, 5),
                "p25": _pct(sim_returns, 25),
                "p50": _pct(sim_returns, 50),
                "p75": _pct(sim_returns, 75),
                "p95": _pct(sim_returns, 95),
                "mean": _mean(sim_returns),
            },
            "max_drawdown": {
                "p5":  _pct(sim_drawdowns, 5),
                "p25": _pct(sim_drawdowns, 25),
                "p50": _pct(sim_drawdowns, 50),
                "p75": _pct(sim_drawdowns, 75),
                "p95": _pct(sim_drawdowns, 95),
                "mean": _mean(sim_drawdowns),
            },
            "sharpe": {
                "p5":  _pct(sim_sharpes, 5) if sim_sharpes else None,
                "p50": _pct(sim_sharpes, 50) if sim_sharpes else None,
                "p95": _pct(sim_sharpes, 95) if sim_sharpes else None,
                "mean": _mean(sim_sharpes),
            },
        },
    }


@router.post("/monte-carlo/param-perturbation")
async def mc_param_perturbation(body: MonteCarloRequest):
    """
    模式2：参数扰动分析
    在用户参数周围随机采样，评估策略对参数变化的敏感性。
    """
    import random
    import math

    feeder = DataFeeder('okx')
    df = feeder.get_local_data("BTC/USDT:USDT", body.timeframe)
    if df.empty:
        df = feeder.get_local_data("BTC/USDT", body.timeframe)
    if df.empty:
        raise HTTPException(400, "无本地K线数据")

    base_params = body.parameters.copy()
    initial = base_params.get("initial_capital", 10000.0)

    # 找出数值型参数（排除特殊字段）
    skip_keys = {"initial_capital", "start_date", "end_date", "leverage", "fee_pct"}
    numeric_params = {k: v for k, v in base_params.items()
                      if k not in skip_keys and isinstance(v, (int, float)) and v != 0}

    if not numeric_params:
        raise HTTPException(400, "未找到可扰动的数值型参数（请确保策略参数包含数值型字段）")

    rng = random.Random(42)
    results = []

    for i in range(body.n_simulations):
        perturbed = base_params.copy()
        perturbation_info = {}
        for k, base_v in numeric_params.items():
            ratio = rng.uniform(0.7, 1.3)
            new_v = round(base_v * ratio, 6)
            if isinstance(base_v, int):
                new_v = max(1, int(new_v))
            perturbed[k] = new_v
            perturbation_info[k] = round(ratio, 3)

        res, err = run_dynamic_code(body.code, df.copy(), perturbed, timeframe=body.timeframe)
        if err:
            continue

        trades = res.get("trades", [])
        eq = _equity_from_trades(trades, initial)
        m = _metrics_from_equity(eq, initial)
        results.append({
            "params": {k: perturbed[k] for k in numeric_params},
            "perturbation": perturbation_info,
            "total_return_pct": m["total_return_pct"],
            "max_drawdown_pct": m["max_drawdown_pct"],
            "sharpe": m["sharpe"],
            "n_trades": len(trades),
        })

    if not results:
        raise HTTPException(500, "所有参数扰动模拟均失败，请检查策略代码")

    returns = [r["total_return_pct"] for r in results]
    drawdowns = [r["max_drawdown_pct"] for r in results]
    profitable = sum(1 for r in returns if r > 0)

    def _pct(lst, p):
        s = sorted(lst)
        idx = int(len(s) * p / 100)
        return round(s[min(idx, len(s) - 1)], 2)

    return {
        "mode": "param_perturbation",
        "n_simulations": len(results),
        "base_params": {k: base_params[k] for k in numeric_params},
        "results": results,
        "stats": {
            "profitable_ratio": round(profitable / len(results) * 100, 1),
            "total_return": {
                "p5":  _pct(returns, 5),
                "p25": _pct(returns, 25),
                "p50": _pct(returns, 50),
                "p75": _pct(returns, 75),
                "p95": _pct(returns, 95),
            },
            "max_drawdown": {
                "p5":  _pct(drawdowns, 5),
                "p50": _pct(drawdowns, 50),
                "p95": _pct(drawdowns, 95),
            },
        },
    }


@router.post("/monte-carlo/price-bootstrap")
async def mc_price_bootstrap(body: MonteCarloRequest):
    """
    模式3：价格路径 Bootstrap
    从历史收益率序列中有放回抽样，生成随机价格路径并在其上运行策略。
    """
    import random
    import math

    feeder = DataFeeder('okx')
    df = feeder.get_local_data("BTC/USDT:USDT", body.timeframe)
    if df.empty:
        df = feeder.get_local_data("BTC/USDT", body.timeframe)
    if df.empty:
        raise HTTPException(400, "无本地K线数据")

    if 'timestamp' in df.columns:
        df = df.set_index('timestamp')

    import pandas as pd
    import numpy as np

    closes = df['close'].values.astype(float)
    if len(closes) < 100:
        raise HTTPException(400, "K线数量不足（至少需要 100 根）")

    log_rets = np.diff(np.log(closes))
    n_bars = len(closes)
    initial = body.parameters.get("initial_capital", 10000.0)

    rng_np = np.random.default_rng(42)
    results = []
    equity_curves = []

    n_success = 0
    n_attempt = 0
    max_attempts = body.n_simulations * 3

    while n_success < body.n_simulations and n_attempt < max_attempts:
        n_attempt += 1
        sampled_rets = rng_np.choice(log_rets, size=n_bars - 1, replace=True)
        sim_closes = closes[0] * np.exp(np.concatenate([[0], np.cumsum(sampled_rets)]))

        sim_df = df.copy()
        scale = sim_closes / closes
        sim_df['close'] = sim_closes
        sim_df['open']  = df['open'].values * scale
        sim_df['high']  = df['high'].values * scale
        sim_df['low']   = df['low'].values * scale

        sim_df = sim_df.reset_index()

        res, err = run_dynamic_code(body.code, sim_df, body.parameters, timeframe=body.timeframe)
        if err:
            continue

        trades = res.get("trades", [])
        eq = _equity_from_trades(trades, initial)
        m = _metrics_from_equity(eq, initial)
        results.append({
            "total_return_pct": m["total_return_pct"],
            "max_drawdown_pct": m["max_drawdown_pct"],
            "sharpe": m["sharpe"],
            "n_trades": len(trades),
        })
        if len(equity_curves) < 80:
            equity_curves.append(eq)
        n_success += 1

    if not results:
        raise HTTPException(500, "价格路径模拟全部失败，请检查策略代码")

    returns = [r["total_return_pct"] for r in results]
    drawdowns = [r["max_drawdown_pct"] for r in results]
    profitable = sum(1 for r in returns if r > 0)

    def _pct(lst, p):
        s = sorted(lst)
        idx = int(len(s) * p / 100)
        return round(s[min(idx, len(s) - 1)], 2)

    return {
        "mode": "price_bootstrap",
        "n_simulations": len(results),
        "equity_curves": equity_curves,
        "results": results,
        "stats": {
            "profitable_ratio": round(profitable / len(results) * 100, 1),
            "total_return": {
                "p5":  _pct(returns, 5),
                "p25": _pct(returns, 25),
                "p50": _pct(returns, 50),
                "p75": _pct(returns, 75),
                "p95": _pct(returns, 95),
            },
            "max_drawdown": {
                "p5":  _pct(drawdowns, 5),
                "p50": _pct(drawdowns, 50),
                "p95": _pct(drawdowns, 95),
            },
        },
    }
