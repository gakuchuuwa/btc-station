"""
Celery tasks for Phase 3.1 backtest execution.
"""
import os
import json
import logging
from datetime import datetime, timezone

from celery_app import celery_app
from celery import states
from freqtrade_runner import run_backtest_container
from csv_converter import freqtrade_json_to_tv_csv, validate_csv

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


def _supabase_update(table: str, row_id: str, payload: dict):
    """Fire-and-forget Supabase PATCH via requests."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return
    try:
        import requests
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
                "Prefer": "return=minimal",
            },
            json=payload,
            timeout=10,
        )
    except Exception as e:
        logger.warning(f"Supabase update failed: {e}")


@celery_app.task(bind=True, name="tasks.run_backtest_task", max_retries=0)
def run_backtest_task(
    self,
    *,
    user_id: str,
    backtest_id: str,
    strategy_id: str,
    strategy_class: str,
    strategy_code: str,
    timeframe: str,
    timerange: str,
    market: str,
    initial_capital: float,
    leverage: int,
    fee_pct: float,
    plan: str,
    user_params: dict,
):
    task_id = self.request.id
    logs: list[str] = []

    def push_log(line: str):
        logs.append(line)
        self.update_state(
            state="PROGRESS",
            meta={"log": line, "logs": logs[-50:], "backtest_id": backtest_id},
        )
        _supabase_update("backtests", backtest_id, {"status": "running"})

    try:
        # Mark starting
        _supabase_update("backtests", backtest_id, {
            "status": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
        })
        push_log("容器启动中...")

        raw = run_backtest_container(
            user_id=user_id,
            task_id=task_id,
            strategy_class=strategy_class,
            strategy_code=strategy_code,
            timeframe=timeframe,
            timerange=timerange,
            market=market,
            initial_capital=initial_capital,
            leverage=leverage,
            fee_pct=fee_pct,
            plan=plan,
            on_log=push_log,
        )

        push_log("生成 CSV 报告...")
        csv_text = freqtrade_json_to_tv_csv(raw, user_params, initial_capital)

        if not validate_csv(csv_text):
            raise ValueError("CSV 自检失败，输出格式不正确")

        # Persist result to Supabase
        summary = {}
        for entry in raw.get("strategy_comparison", []) or []:
            summary = entry
            break
        if not summary:
            for key in ("results_per_pair",):
                items = raw.get(key, [])
                if items:
                    summary = items[0]
                    break

        trades_raw = raw.get("trades", [])
        metrics = {
            "net_profit_pct": round(summary.get("profit_total", 0) * 100, 4),
            "max_drawdown_pct": round(summary.get("max_drawdown_account", summary.get("max_drawdown", 0)) * 100, 4),
            "win_rate_pct": round(summary.get("winrate", 0) * 100, 2),
            "total_trades": len(trades_raw),
            "sharpe": summary.get("sharpe", None),
            "sortino": summary.get("sortino", None),
            "profit_factor": summary.get("profit_factor", None),
        }

        _supabase_update("backtests", backtest_id, {
            "status": "completed",
            "metrics": json.dumps(metrics),
            "trades": json.dumps(trades_raw[:500]),
            "csv_data": csv_text,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })

        push_log("回测完成！")

        return {
            "backtest_id": backtest_id,
            "metrics": metrics,
            "csv_length": len(csv_text),
            "trades_count": len(trades_raw),
        }

    except Exception as exc:
        logger.exception(f"Backtest task {task_id} failed")
        _supabase_update("backtests", backtest_id, {
            "status": "failed",
            "error_message": str(exc)[:2000],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
        self.update_state(
            state=states.FAILURE,
            meta={"error": str(exc), "backtest_id": backtest_id},
        )
        raise
