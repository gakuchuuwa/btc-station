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

import hashlib as _hashlib
import threading as _threading
import time as _time

_VERIFIED_TOKEN_CACHE: dict = {}   # token 哈希 -> (user_id, 过期时间戳)
_VERIFIED_TOKEN_LOCK = _threading.Lock()


def _jwt_exp(token: str):
    """只读取 JWT 里的 exp 用来决定缓存时长；身份一律以 Supabase Auth 校验结果为准。"""
    try:
        parts = token.split(".")
        padded = parts[1] + "=" * (4 - len(parts[1]) % 4)
        exp = json.loads(_b64.urlsafe_b64decode(padded)).get("exp")
        return float(exp) if isinstance(exp, (int, float)) else None
    except Exception:
        return None


def _get_user_id(authorization: str | None = None) -> str:
    """
    从 Supabase access token 得到 user_id。
    必须经 Supabase Auth 接口验证签名与有效期，禁止仅 Base64 解码就信任 sub。
    验证通过的 token 在内存缓存最多 5 分钟，避免每次请求都访问 Supabase。
    """
    if DEV_MODE:
        return _ensure_dev_user()

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="未登录")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    if not _sb_url() or not _sb_key():
        raise HTTPException(status_code=401, detail="鉴权服务未配置")

    now = _time.time()
    key = _hashlib.sha256(token.encode("utf-8")).hexdigest()
    with _VERIFIED_TOKEN_LOCK:
        hit = _VERIFIED_TOKEN_CACHE.get(key)
        if hit and now < hit[1]:
            return hit[0]

    exp = _jwt_exp(token)
    if exp is not None and exp <= now:
        raise HTTPException(status_code=401, detail="Token 无效或已过期，请重新登录")

    try:
        import requests as _req
        r = _req.get(
            f"{_sb_url()}/auth/v1/user",
            headers={"apikey": _sb_key(), "Authorization": f"Bearer {token}"},
            timeout=10,
        )
        uid = r.json().get("id") if r.status_code == 200 else None
    except Exception:
        uid = None

    if not uid:
        raise HTTPException(status_code=401, detail="Token 无效或已过期，请重新登录")

    expire_at = min(now + 300, exp) if exp is not None else now + 300
    with _VERIFIED_TOKEN_LOCK:
        _VERIFIED_TOKEN_CACHE[key] = (uid, expire_at)
        if len(_VERIFIED_TOKEN_CACHE) > 256:
            _VERIFIED_TOKEN_CACHE.pop(next(iter(_VERIFIED_TOKEN_CACHE)), None)
    return uid


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
    initial_capital: float = 27000.0
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
async def get_cached_candles(timeframe: str, market: str = "swap"):
    """返回本地缓存的 BTC K 线。默认永续（与回测同源），market=spot 读现货。"""
    import pandas as pd
    feeder = DataFeeder('okx')
    if market == "spot":
        df = feeder.get_local_data("BTC/USDT", timeframe)
    else:
        df = feeder.get_local_data("BTC/USDT:USDT", timeframe)
        if df.empty:
            df = feeder.get_local_data("BTC/USDT", timeframe)
    if df.empty:
        raise HTTPException(503, "数据正在初始化，请稍后重试")

    # Ensure timestamp is naive UTC (no timezone info, already in UTC)
    if 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp']).dt.tz_localize(None)

    # Fast vectorized conversion instead of slow iterrows()
    df_json = df.copy()
    if 'timestamp' in df_json.columns:
        df_json['time'] = df_json['timestamp'].astype('int64') // 10**9
    else:
        df_json['time'] = df_json.index.astype('int64') // 10**9

    # Handle optional volume
    if 'volume' not in df_json.columns:
        df_json['volume'] = 0

    cols_to_keep = ['time', 'open', 'high', 'low', 'close', 'volume']
    df_json = df_json[cols_to_keep]
    
    # Drop duplicates and sort natively in C
    df_json = df_json.drop_duplicates(subset=['time']).sort_values('time')
    
    # pandas to_dict('records') is extremely fast
    unique = df_json.to_dict(orient='records')
    
    return {"candles": unique}


# ── Built-in templates ────────────────────────────────────────────────────────

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "strategies")
TEMPLATES = [
    # 2026-09-04:只保留海龟 SSL 双系统 6 形态（唯一在实盘使用的策略）。
    # 其余内置策略（AtrChannel / Dca / MaCross / Macd / RSI / Bollinger）已全部删除——
    # 它们与实盘策略无关，留着只会让编辑器里出现不该选的模板。
    {"id": "TurtleSslDualStrategy",   "name": "海龟SSL双系统6形态","category": "trend"},
    {"id": "FixedQtyStrategy",   "name": "海龟SSL·形态倍数全1.0","category": "trend"},
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

    # Run backtest in a plain background thread (本项目不用 Celery / Redis)
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


class WalkForwardRequest(BaseModel):
    code: str
    parameters: dict = {}
    timeframe: str = "4h"
    segment: str = "year"  # 分段方式，目前只支持按年

    @field_validator("segment")
    @classmethod
    def valid_segment(cls, v):
        if v != "year":
            raise ValueError("segment 目前只支持 'year'")
        return v


@router.post("/walk-forward")
async def walk_forward(body: WalkForwardRequest):
    """
    Walk-forward 前向验证：按年分段，每段用固定参数独立回测（从初始本金起算），
    验证参数在样本外（各年份）是否稳健。防过拟合的黄金标准。
    返回各段净利/回撤/笔数，以及「多少段赚钱」的稳健性判定。
    """
    feeder = DataFeeder('okx')
    df = feeder.get_local_data("BTC/USDT:USDT", body.timeframe)
    if df.empty:
        df = feeder.get_local_data("BTC/USDT", body.timeframe)
    if df.empty:
        raise HTTPException(400, "无本地K线数据，请先运行数据更新")

    import pandas as pd
    df = df.copy()
    ts = pd.to_datetime(df['timestamp'])
    years = sorted(set(ts.dt.year))
    initial = float(body.parameters.get("initial_capital", body.parameters.get("init_cash", 27000.0)))

    segments = []
    for y in years:
        start = f"{y}-01-01"
        end = f"{y + 1}-01-01"
        sub = df[ts < pd.Timestamp(end)].copy()
        if sub.empty:
            continue
        params = dict(body.parameters)
        params['start_date'] = start  # 该段之前不入场，只统计该段信号
        res, err = run_dynamic_code(body.code, sub, params, timeframe=body.timeframe)
        if err:
            continue  # 单段数据不足/失败跳过，不影响其他段
        trades = res.get("trades", [])
        metrics = res.get("metrics", {})
        net = sum(float(t.get("PnL", 0) or 0) for t in trades)
        dd = abs(float(metrics.get("max_drawdown_pct", 0) or 0))
        segments.append({
            "year": y,
            "n_trades": len(trades),
            "net_profit": round(net, 2),
            "max_drawdown_pct": round(dd, 2),
            "profitable": net > 0,
        })

    if not segments:
        raise HTTPException(400, "分段回测无有效结果")

    win = sum(1 for s in segments if s["profitable"])
    total = len(segments)
    win_rate = win / total if total else 0.0

    return {
        "mode": "walk_forward",
        "segment": body.segment,
        "timeframe": body.timeframe,
        "initial_capital": initial,
        "segments": segments,
        "summary": {
            "total_segments": total,
            "win_segments": win,
            "loss_segments": total - win,
            "win_rate": round(win_rate * 100, 1),
            "robust": win_rate >= 0.7,
        },
    }
