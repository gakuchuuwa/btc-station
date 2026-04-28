"""
Freqtrade Hyperopt runner for Phase 3.3.
Wraps `freqtrade hyperopt`, streams per-epoch progress via callback,
and parses the .fthopt / epoch_details JSON into plot-ready records.
"""
import os
import json
import logging
import subprocess
import re
from pathlib import Path
from typing import Callable, Optional

from freqtrade_runner import (
    DATA_DIR, USERS_DIR, PLAN_LIMITS,
    _ensure_user_dirs, _write_strategy_file, _write_freqtrade_config,
)

logger = logging.getLogger(__name__)

# Hyperopt result file produced by Freqtrade (binary msgpack + companion JSON)
EPOCH_DETAILS_FILENAME = "hyperopt_results.json"

# Loss functions supported by Freqtrade
LOSS_FUNCTIONS = {
    "ShortTradeDurHyperOptLoss",
    "OnlyProfitHyperOptLoss",
    "SharpeHyperOptLoss",
    "SharpeHyperOptLossDaily",
    "SortinoHyperOptLoss",
    "SortinoHyperOptLossDaily",
    "MaxDrawDownHyperOptLoss",
    "MaxDrawDownRelativeHyperOptLoss",
    "CalmarHyperOptLoss",
    "ProfitDrawDownHyperOptLoss",
}

# Hyperopt search spaces
SPACES = {"buy", "sell", "roi", "stoploss", "trailing", "protection"}


# ── Epoch log line parser ─────────────────────────────────────────────────────
# Freqtrade logs each epoch like:
#   Epoch 12/100: Profit 4.32%, Drawdown 8.10%, Trades 143 | Sharpe: 1.42
_EPOCH_RE = re.compile(
    r"Epoch\s+(\d+)/(\d+).*?Profit\s+([\-\d.]+)%.*?Drawdown\s+([\-\d.]+)%.*?Trades\s+(\d+)",
    re.IGNORECASE,
)


def _parse_epoch_line(line: str) -> Optional[dict]:
    m = _EPOCH_RE.search(line)
    if not m:
        return None
    return {
        "epoch":         int(m.group(1)),
        "total_epochs":  int(m.group(2)),
        "profit_pct":    float(m.group(3)),
        "drawdown_pct":  float(m.group(4)),
        "trades":        int(m.group(5)),
    }


# ── Main runner ───────────────────────────────────────────────────────────────

def run_hyperopt(
    user_id: str,
    task_id: str,
    strategy_class: str,
    strategy_code: str,
    timeframe: str,
    timerange: str,
    epochs: int,
    spaces: list[str],
    loss_function: str,
    min_trades: int,
    plan: str,
    on_progress: Optional[Callable[[dict], None]] = None,
) -> dict:
    """
    Synchronous: run Freqtrade hyperopt, return parsed result dict.
    Calls on_progress({"epoch": N, "total": M, "profit_pct": ..., ...}) for each parsed epoch.

    Returns:
        {
            "epochs": [{"epoch", "profit_pct", "drawdown_pct", "trades", "params", ...}, ...],
            "best": { best epoch record },
            "total_epochs": N,
        }
    """
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    hyperopt_timeout = limits["timeout"] * 3  # hyperopt runs much longer than backtest

    strategies_dir, results_dir = _ensure_user_dirs(user_id)
    _write_strategy_file(strategies_dir, strategy_class, strategy_code)

    # Reuse the same spot config as backtest (hyperopt doesn't need exchange keys)
    config_path = _write_freqtrade_config(
        results_dir, timeframe, "spot", 1000.0, 1, 0.1
    )

    hyperopt_dir = Path(results_dir) / "hyperopt_results"
    hyperopt_dir.mkdir(parents=True, exist_ok=True)

    # Validate inputs
    if loss_function not in LOSS_FUNCTIONS:
        loss_function = "SharpeHyperOptLoss"
    valid_spaces = [s for s in spaces if s in SPACES] or ["buy", "sell"]

    cmd = [
        "freqtrade", "hyperopt",
        "--config",         config_path,
        "--strategy",       strategy_class,
        "--strategy-path",  strategies_dir,
        "--userdir",        results_dir,
        "--datadir",        DATA_DIR,
        "--timerange",      timerange,
        "--hyperopt-loss",  loss_function,
        "--spaces",         *valid_spaces,
        "--epochs",         str(epochs),
        "--min-trades",     str(min_trades),
        "--export-csv",     str(hyperopt_dir / "epochs.csv"),
        "-j",               "-1",   # use all CPU cores
        "--no-color",
    ]

    logger.info(f"[HOPT {task_id[:8]}] cmd: {' '.join(cmd)}")

    # Stream output line by line so we can parse epoch progress in real-time
    epoch_records: list[dict] = []

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        full_output_lines: list[str] = []

        assert proc.stdout is not None
        for raw_line in proc.stdout:
            line = raw_line.rstrip()
            full_output_lines.append(line)
            print(f"[HOPT {task_id[:8]}] {line}", flush=True)

            ep = _parse_epoch_line(line)
            if ep:
                epoch_records.append(ep)
                if on_progress:
                    on_progress(ep)

        proc.wait(timeout=hyperopt_timeout)
        exit_code = proc.returncode

    except subprocess.TimeoutExpired:
        proc.kill()
        raise TimeoutError(f"Hyperopt 超时（{hyperopt_timeout}s）")

    if exit_code != 0:
        tail = "\n".join(full_output_lines[-40:])
        raise RuntimeError(f"Freqtrade hyperopt 退出码 {exit_code}:\n{tail}")

    # ── Parse result files ────────────────────────────────────────────────────
    # Freqtrade writes: <userdir>/hyperopt_results/hyperopt_results.pickle
    # and optionally exports --export-csv
    # We also look for the JSON epoch details file if available.

    epochs_with_params = _load_epoch_details(results_dir, epoch_records)
    best = _find_best(epochs_with_params)

    return {
        "epochs":        epochs_with_params,
        "best":          best,
        "total_epochs":  len(epochs_with_params),
    }


def _load_epoch_details(results_dir: str, fallback_records: list[dict]) -> list[dict]:
    """
    Try to load the full epoch details (including per-epoch params) from the
    JSON export or CSV that Freqtrade writes alongside the .pickle file.
    Falls back to the streaming-parsed records if no file is found.
    """
    # Freqtrade 2024+ can export a JSON with show-best-result --print-json
    # More reliably, we parse the CSV we requested via --export-csv
    csv_path = Path(results_dir) / "hyperopt_results" / "epochs.csv"
    if csv_path.exists():
        try:
            return _parse_epochs_csv(csv_path, fallback_records)
        except Exception as e:
            logger.warning(f"CSV parse failed: {e}, using streaming records")

    return fallback_records


def _parse_epochs_csv(csv_path: Path, fallback: list[dict]) -> list[dict]:
    """
    Parse Freqtrade's hyperopt CSV export.
    Columns vary by FT version; we extract what we can and merge with streaming data.
    """
    import csv as _csv

    fallback_by_epoch = {r["epoch"]: r for r in fallback}
    records = []

    with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:
        reader = _csv.DictReader(f)
        for row in reader:
            try:
                epoch_num = int(row.get("Epoch", row.get("epoch", 0)))
            except (ValueError, TypeError):
                continue

            # Profit column varies: "Profit", "profit", "profit_mean", "profit_total"
            profit_pct = _try_float(
                row.get("Profit") or row.get("profit") or row.get("profit_mean") or row.get("profit_total")
            )
            drawdown_pct = _try_float(
                row.get("Max Drawdown") or row.get("max_drawdown") or row.get("Drawdown")
            )
            trades = _try_int(row.get("Trades") or row.get("trades"))

            # Collect parameter columns (anything not a known metric)
            known = {"epoch", "Epoch", "Profit", "profit", "profit_mean", "profit_total",
                     "Max Drawdown", "max_drawdown", "Drawdown", "Trades", "trades",
                     "Best", "best", "Objective", "objective"}
            params = {k: v for k, v in row.items() if k not in known and v not in ("", None)}

            # Merge with streaming record for fields missing from CSV
            base = fallback_by_epoch.get(epoch_num, {})
            records.append({
                "epoch":        epoch_num,
                "total_epochs": base.get("total_epochs", len(fallback)),
                "profit_pct":   profit_pct if profit_pct is not None else base.get("profit_pct", 0.0),
                "drawdown_pct": drawdown_pct if drawdown_pct is not None else base.get("drawdown_pct", 0.0),
                "trades":       trades if trades is not None else base.get("trades", 0),
                "params":       params,
            })

    return records if records else fallback


def _find_best(records: list[dict]) -> Optional[dict]:
    if not records:
        return None
    return max(records, key=lambda r: r.get("profit_pct", float("-inf")))


def _try_float(v) -> Optional[float]:
    try:
        s = str(v).replace("%", "").replace(",", "").strip()
        return float(s)
    except (TypeError, ValueError):
        return None


def _try_int(v) -> Optional[int]:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return None
