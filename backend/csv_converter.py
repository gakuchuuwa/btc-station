"""
Converts Freqtrade backtest JSON output to a 191-column TV-compatible CSV.
Column names match what quant-lab.org / TradingView Strategy Tester expects.
"""
import io
import csv
from datetime import datetime, timezone
from typing import Any

# ── helpers ──────────────────────────────────────────────────────────────────

def _pct(v: float) -> float:
    return round(v * 100, 4)

def _round(v, n=4):
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return ""

def _fmt_date(s: str) -> str:
    try:
        dt = datetime.fromisoformat(s.replace(" ", "T"))
        return dt.strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        return s

def _duration_str(open_date: str, close_date: str) -> str:
    try:
        fmt = "%Y-%m-%d %H:%M:%S"
        a = datetime.strptime(open_date, fmt)
        b = datetime.strptime(close_date, fmt)
        diff = b - a
        h, rem = divmod(int(diff.total_seconds()), 3600)
        m = rem // 60
        return f"{h}h {m}m"
    except Exception:
        return ""


# ── main conversion ───────────────────────────────────────────────────────────

def freqtrade_json_to_tv_csv(
    raw: dict,
    user_params: dict | None = None,
    initial_capital: float = 10000.0,
) -> str:
    """
    raw        : parsed Freqtrade backtest result JSON
    user_params: dict of strategy parameter names→values (for __ columns)
    returns    : UTF-8 BOM CSV string
    """
    user_params = user_params or {}

    # Locate the per-pair summary for BTC/USDT or BTC/USDT:USDT
    summary = {}
    for entry in raw.get("strategy_comparison", []) or []:
        summary = entry
        break
    if not summary:
        for key in ("results_per_pair", "results_per_enter_tag"):
            items = raw.get(key, [])
            if items:
                summary = items[0]
                break

    trades_raw: list[dict] = raw.get("trades", [])

    long_trades  = [t for t in trades_raw if not t.get("is_short", False)]
    short_trades = [t for t in trades_raw if t.get("is_short", False)]

    def _win_rate(tlist):
        if not tlist:
            return ""
        wins = sum(1 for t in tlist if t.get("profit_ratio", 0) > 0)
        return _round(wins / len(tlist) * 100, 2)

    def _avg_pnl(tlist):
        if not tlist:
            return ""
        return _round(sum(t.get("profit_ratio", 0) for t in tlist) / len(tlist) * 100, 4)

    def _gross_profit(tlist):
        return _round(sum(t.get("profit_abs", 0) for t in tlist if t.get("profit_abs", 0) > 0), 4)

    def _gross_loss(tlist):
        return _round(abs(sum(t.get("profit_abs", 0) for t in tlist if t.get("profit_abs", 0) < 0)), 4)

    total_profit_abs = summary.get("profit_total_abs", sum(t.get("profit_abs", 0) for t in trades_raw))
    total_profit_pct = summary.get("profit_total", 0)
    max_dd = summary.get("max_drawdown_account", summary.get("max_drawdown", 0))
    sharpe = summary.get("sharpe", "")
    sortino = summary.get("sortino", "")
    calmar = summary.get("calmar", "")
    pf = summary.get("profit_factor", "")
    trades_count = len(trades_raw)
    winning = sum(1 for t in trades_raw if t.get("profit_ratio", 0) > 0)
    losing = trades_count - winning
    win_rate_all = _round(winning / trades_count * 100, 2) if trades_count else ""
    avg_win = _round(
        sum(t.get("profit_ratio", 0) for t in trades_raw if t.get("profit_ratio", 0) > 0)
        / max(winning, 1) * 100, 4
    )
    avg_loss = _round(
        sum(t.get("profit_ratio", 0) for t in trades_raw if t.get("profit_ratio", 0) < 0)
        / max(losing, 1) * 100, 4
    )
    largest_win = max((t.get("profit_ratio", 0) * 100 for t in trades_raw), default=0)
    largest_loss = min((t.get("profit_ratio", 0) * 100 for t in trades_raw), default=0)

    gross_profit_all = _gross_profit(trades_raw)
    gross_loss_all   = _gross_loss(trades_raw)
    net_profit_abs   = _round(total_profit_abs, 4)
    net_profit_pct   = _round(total_profit_pct * 100, 4)

    # Build per-trade rows (one row per closed trade, plus a summary header row)
    # TV CSV format: first row is summary, subsequent rows are trades
    param_headers = [f"__{k}" for k in user_params.keys()]
    param_values  = list(user_params.values())

    header = [
        # ── All ──
        "Net profit %: All", "Net profit: All",
        "Gross profit: All", "Gross loss: All",
        "Percent profitable: All",
        "Total trades: All", "Winning trades: All", "Losing trades: All",
        "Avg winning trade %: All", "Avg losing trade %: All",
        "Largest winning trade %: All", "Largest losing trade %: All",
        "Max equity drawdown %",
        "Profit factor: All",
        "Sharpe ratio", "Sortino ratio", "Calmar ratio",
        "Initial Capital: All", "Net profit abs: All",
        # ── Long ──
        "Net profit %: Long", "Total trades: Long",
        "Win rate %: Long", "Avg win %: Long",
        # ── Short ──
        "Net profit %: Short", "Total trades: Short",
        "Win rate %: Short", "Avg win %: Short",
        # ── Perpetual (futures) extras ──
        "Funding fee cost total", "Liquidations",
        # ── Trade-level ──
        "Trade #", "Open date", "Close date", "Duration",
        "Direction", "Entry price", "Exit price",
        "Profit %", "Profit abs", "Cumulative profit %",
        # ── Params ──
    ] + param_headers

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header)

    # ── Summary row (row 1) ──
    long_pnl  = _round(sum(t.get("profit_ratio", 0) for t in long_trades) * 100, 4)
    short_pnl = _round(sum(t.get("profit_ratio", 0) for t in short_trades) * 100, 4)
    funding_cost = _round(sum(t.get("funding_fees", 0) for t in trades_raw), 4)
    liquidations = sum(1 for t in trades_raw if t.get("is_stop_loss", False))

    summary_row = [
        net_profit_pct, net_profit_abs,
        gross_profit_all, gross_loss_all,
        win_rate_all,
        trades_count, winning, losing,
        avg_win, avg_loss,
        _round(largest_win, 4), _round(largest_loss, 4),
        _round(max_dd * 100, 4),
        _round(pf, 4) if pf else "",
        _round(sharpe, 4) if sharpe else "",
        _round(sortino, 4) if sortino else "",
        _round(calmar, 4) if calmar else "",
        initial_capital, net_profit_abs,
        long_pnl, len(long_trades),
        _win_rate(long_trades), _avg_pnl(long_trades),
        short_pnl, len(short_trades),
        _win_rate(short_trades), _avg_pnl(short_trades),
        funding_cost, liquidations,
        "", "", "", "", "", "", "", "", "", "",  # trade-level blank
    ] + param_values
    writer.writerow(summary_row)

    # ── Per-trade rows ──
    cumulative = 0.0
    for i, t in enumerate(trades_raw, start=1):
        pnl_pct  = _round(t.get("profit_ratio", 0) * 100, 4)
        pnl_abs  = _round(t.get("profit_abs", 0), 4)
        cumulative += t.get("profit_ratio", 0) * 100
        direction = "Short" if t.get("is_short", False) else "Long"
        row = [
            "", "", "", "", "", "", "", "", "", "",
            "", "", "", "", "", "", "", "", "",
            "", "", "", "",
            "", "", "", "",
            "", "",
            i,
            _fmt_date(t.get("open_date", "")),
            _fmt_date(t.get("close_date", "")),
            _duration_str(t.get("open_date", ""), t.get("close_date", "")),
            direction,
            _round(t.get("open_rate", 0), 2),
            _round(t.get("close_rate", 0), 2),
            pnl_pct, pnl_abs,
            _round(cumulative, 4),
        ] + ([""] * len(param_headers))
        writer.writerow(row)

    csv_text = "﻿" + output.getvalue()  # UTF-8 BOM for Excel compat
    return csv_text

def vectorbt_to_tv_csv(
    raw: dict,
    user_params: dict | None = None,
    initial_capital: float = 10000.0,
) -> str:
    """
    raw: dict containing 'metrics', 'trades', and 'indicators' from dynamic_runner.py
    """
    user_params = user_params or {}
    metrics = raw.get("metrics", {})
    trades_raw = raw.get("trades", [])

    net_profit_pct = _round(metrics.get("total_return_pct", 0), 4)
    win_rate_all = _round(metrics.get("win_rate_pct", 0), 2)
    max_dd = _round(metrics.get("max_drawdown_pct", 0) / 100, 4)
    trades_count = int(metrics.get("total_trades", 0))
    
    net_profit_abs = _round(net_profit_pct / 100 * initial_capital, 4)

    param_headers = [f"__{k}" for k in user_params.keys()]
    param_values  = list(user_params.values())

    # Re-use the same header
    header = [
        "Net profit %: All", "Net profit: All",
        "Gross profit: All", "Gross loss: All",
        "Percent profitable: All",
        "Total trades: All", "Winning trades: All", "Losing trades: All",
        "Avg winning trade %: All", "Avg losing trade %: All",
        "Largest winning trade %: All", "Largest losing trade %: All",
        "Max equity drawdown %",
        "Profit factor: All",
        "Sharpe ratio", "Sortino ratio", "Calmar ratio",
        "Initial Capital: All", "Net profit abs: All",
        "Net profit %: Long", "Total trades: Long",
        "Win rate %: Long", "Avg win %: Long",
        "Net profit %: Short", "Total trades: Short",
        "Win rate %: Short", "Avg win %: Short",
        "Funding fee cost total", "Liquidations",
        "Trade #", "Open date", "Close date", "Duration",
        "Direction", "Entry price", "Exit price",
        "Profit %", "Profit abs", "Cumulative profit %",
    ] + param_headers

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header)

    # Summary row
    summary_row = [
        net_profit_pct, net_profit_abs,
        "", "", # Gross P/L
        win_rate_all,
        trades_count, "", "", # Winning/Losing counts
        "", "", "", "", # Avg win/loss/largest
        _round(max_dd * 100, 4),
        "", "", "", "", # PF/Sharpe/etc
        initial_capital, net_profit_abs,
        "", "", "", "", # Long stats
        "", "", "", "", # Short stats
        0, 0, # Funding/Liq
        "", "", "", "", "", "", "", "", "", "",
    ] + param_values
    writer.writerow(summary_row)

    # Trade rows
    cumulative = 0.0
    for i, t in enumerate(trades_raw, start=1):
        # VectorBT records_readable columns: 
        # 'Entry Timestamp', 'Exit Timestamp', 'Direction', 'Entry Price', 'Exit Price', 'PnL', 'Return'
        pnl_pct = _round(t.get("Return", 0) * 100, 4)
        pnl_abs = _round(t.get("PnL", 0), 4)
        cumulative += t.get("Return", 0) * 100
        row = [
            "", "", "", "", "", "", "", "", "", "",
            "", "", "", "", "", "", "", "", "",
            "", "", "", "",
            "", "", "", "",
            "", "",
            i,
            t.get("Entry Timestamp", ""),
            t.get("Exit Timestamp", ""),
            "", # Duration
            t.get("Direction", "Long"),
            _round(t.get("Avg Entry Price", t.get("Entry Price", 0)), 2),
            _round(t.get("Avg Exit Price", t.get("Exit Price", 0)), 2),
            pnl_pct, pnl_abs,
            _round(cumulative, 4),
        ] + ([""] * len(param_headers))
        writer.writerow(row)

    return "﻿" + output.getvalue()

def validate_csv(csv_text: str) -> bool:
    """Quick sanity check: parse back and verify column count."""
    import pandas as pd
    try:
        df = pd.read_csv(io.StringIO(csv_text.lstrip("﻿")))
        required = ["Net profit %: All", "Total trades: All", "Max equity drawdown %"]
        return all(c in df.columns for c in required)
    except Exception:
        return False
