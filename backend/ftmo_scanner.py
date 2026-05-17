"""
FTMO 合规扫描器
默认按 FTMO Swing 规则：每日亏损 5% / 总亏损 10% / 盈利目标 10% / 允许周末与隔夜持仓。

输入：
  - equity_points: [{"time": <unix秒>, "equity": <float>}, ...]   来自 dynamic_runner 返回的 equity
  - trades: [{"Entry Timestamp": ISO, "Exit Timestamp": ISO, "PnL": float, ...}, ...]
  - initial_capital: 初始本金
  - rules: dict 可覆盖默认规则

输出：4 大核心指标 + 违规明细
"""
import math
import random
from datetime import datetime, timezone


# FTMO Swing 默认规则
FTMO_SWING_DEFAULTS = {
    "daily_loss_pct": 5.0,        # 单日亏损上限（% of 当日起始净值）
    "total_loss_pct": 10.0,       # 总亏损上限（% of 初始本金）
    "profit_target_pct": 10.0,    # 盈利目标（% of 初始本金）
    "min_trading_days": 4,        # 最少交易日数
    "max_eval_days": 0,           # 0 表示不限期；FTMO Swing 实际无固定天数
    "allow_weekend": True,        # Swing 允许周末持仓
}


def _parse_ts(ts_val):
    """ISO 字符串或 unix 秒 → datetime (UTC)"""
    if ts_val is None:
        return None
    if isinstance(ts_val, (int, float)):
        return datetime.fromtimestamp(ts_val, tz=timezone.utc)
    s = str(ts_val).strip()
    if not s or s in ('nan', 'None'):
        return None
    try:
        # 兼容 '2020-01-06T04:00:00' / '2020-01-06 04:00:00' / 带 +00:00
        s2 = s.replace(' ', 'T').replace('Z', '+00:00')
        dt = datetime.fromisoformat(s2)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _equity_to_daily(equity_points, initial_capital):
    """
    把高频权益曲线压缩为「每日收盘净值」。
    返回 [(date_str, day_open, day_close, day_low), ...] 按日期升序。
    """
    if not equity_points:
        return []
    by_day = {}
    for p in equity_points:
        t = p.get("time")
        v = p.get("equity")
        if t is None or v is None:
            continue
        dt = datetime.fromtimestamp(int(t), tz=timezone.utc)
        d = dt.date().isoformat()
        if d not in by_day:
            by_day[d] = {"open": v, "close": v, "low": v, "high": v, "first_ts": t, "last_ts": t}
        else:
            rec = by_day[d]
            if t < rec["first_ts"]:
                rec["first_ts"] = t
                rec["open"] = v
            if t > rec["last_ts"]:
                rec["last_ts"] = t
                rec["close"] = v
            if v < rec["low"]:
                rec["low"] = v
            if v > rec["high"]:
                rec["high"] = v

    days = sorted(by_day.items(), key=lambda kv: kv[0])
    # 修正每日 open：用前一日 close 作为 day_open（FTMO 规则按"当日起始权益"算）
    prev_close = initial_capital
    fixed = []
    for d, rec in days:
        day_open = prev_close
        fixed.append((d, day_open, rec["close"], rec["low"]))
        prev_close = rec["close"]
    return fixed


def _scan_daily_loss_violations(daily, rule_pct):
    """
    检查每日亏损（基于日内最低点 vs 当日起始权益）。
    返回触发的日期列表 [{"date": "2024-01-15", "daily_loss_pct": 6.3, "day_open": 50000, "day_low": 46850}, ...]
    """
    violations = []
    max_dl = 0.0
    worst_day = None
    for d, day_open, _close, day_low in daily:
        if day_open <= 0:
            continue
        dl_pct = (day_open - day_low) / day_open * 100  # 正数 = 亏损
        if dl_pct > max_dl:
            max_dl = dl_pct
            worst_day = d
        if dl_pct >= rule_pct:
            violations.append({
                "date": d,
                "daily_loss_pct": round(dl_pct, 2),
                "day_open": round(day_open, 2),
                "day_low": round(day_low, 2),
            })
    return violations, round(max_dl, 2), worst_day


def _scan_total_loss_violations(equity_points, initial_capital, rule_pct):
    """
    检查相对初始本金的最大亏损（FTMO Loss 基准 = 初始本金，固定不上移）。
    返回 (是否触发, 最大相对初始本金跌幅%, 触发时间戳)
    """
    threshold = initial_capital * (1 - rule_pct / 100)
    worst_v = initial_capital
    worst_ts = None
    triggered_ts = None
    for p in equity_points:
        v = p.get("equity")
        if v is None:
            continue
        if v < worst_v:
            worst_v = v
            worst_ts = p.get("time")
        if v <= threshold and triggered_ts is None:
            triggered_ts = p.get("time")
    max_loss_pct = (initial_capital - worst_v) / initial_capital * 100 if initial_capital > 0 else 0
    return {
        "violated": triggered_ts is not None,
        "max_loss_pct": round(max_loss_pct, 2),
        "worst_time": worst_ts,
        "triggered_time": triggered_ts,
    }


def _scan_rolling_entry(trades, initial_capital, daily_rule, total_rule):
    """
    滚动起点扫描：把每一笔交易作为"入场起点"，模拟从这笔开始的账户曲线。
    计算有多少起点会触发 FTMO 死线（每日5% / 总10%）。
    """
    n = len(trades)
    if n == 0:
        return {"total_entries": 0, "violations": [], "worst_drawdown_pct": 0.0}

    fail_count = 0
    worst_dd = 0.0
    worst_entry_idx = None

    # 预提取 PnL 数组
    pnls = [float(t.get("PnL") or 0) for t in trades]

    for start_idx in range(n):
        eq = initial_capital
        peak = initial_capital
        local_max_dd = 0.0
        violated = False
        for j in range(start_idx, n):
            eq += pnls[j]
            if eq > peak:
                peak = eq
            # 相对初始本金的跌幅
            rel_loss_pct = (initial_capital - eq) / initial_capital * 100 if initial_capital > 0 else 0
            if rel_loss_pct >= total_rule:
                violated = True
            dd = (peak - eq) / peak * 100 if peak > 0 else 0
            if dd > local_max_dd:
                local_max_dd = dd
        if violated:
            fail_count += 1
        if local_max_dd > worst_dd:
            worst_dd = local_max_dd
            worst_entry_idx = start_idx

    return {
        "total_entries": n,
        "fail_count": fail_count,
        "fail_rate_pct": round(fail_count / n * 100, 2) if n > 0 else 0,
        "worst_drawdown_pct": round(worst_dd, 2),
        "worst_entry_idx": worst_entry_idx,
    }


def _scan_consecutive_losses(trades):
    """
    连续亏损序列扫描。
    返回最大连亏笔数 + 累计亏损金额。
    """
    if not trades:
        return {"max_consec_loss_count": 0, "max_consec_loss_amount": 0.0}
    cur_count = 0
    cur_sum = 0.0
    max_count = 0
    max_sum = 0.0
    for t in trades:
        pnl = float(t.get("PnL") or 0)
        if pnl < 0:
            cur_count += 1
            cur_sum += pnl
            if cur_count > max_count:
                max_count = cur_count
            if cur_sum < max_sum:
                max_sum = cur_sum
        else:
            cur_count = 0
            cur_sum = 0.0
    return {
        "max_consec_loss_count": max_count,
        "max_consec_loss_amount": round(abs(max_sum), 2),
    }


def _monte_carlo_pass_rate(trades, initial_capital, rules, n_sims=500, seed=42):
    """
    蒙特卡洛 FTMO 通过率：随机打乱交易顺序，统计有多少次同时满足：
      1. 不触发每日 5% 亏损（按"当日所有交易的 PnL 总和"近似）
      2. 不触发总 10% 亏损（基于初始本金的固定基准）
      3. 达到 +10% 盈利目标
    """
    if len(trades) < 5:
        return None

    pnls_with_dates = []
    for t in trades:
        pnl = float(t.get("PnL") or 0)
        exit_dt = _parse_ts(t.get("Exit Timestamp"))
        pnls_with_dates.append((pnl, exit_dt))

    rng = random.Random(seed)
    pass_count = 0
    fail_daily = 0
    fail_total = 0
    fail_target = 0

    daily_threshold = initial_capital * rules["daily_loss_pct"] / 100
    total_threshold = initial_capital * (1 - rules["total_loss_pct"] / 100)
    target_value = initial_capital * (1 + rules["profit_target_pct"] / 100)

    for _ in range(n_sims):
        shuffled = pnls_with_dates[:]
        rng.shuffle(shuffled)
        # 模拟时仅按顺序累加 PnL（不再使用真实日期，因为打乱后日期无意义）
        # 改为"每 N 笔 = 1 个交易日"的近似，N = 总笔数 / 估算交易日数
        # 简化：用「每笔交易作为独立时刻」校验，daily 用 rolling sum 近似
        eq = initial_capital
        day_open = initial_capital
        trade_idx_in_day = 0
        trades_per_day = max(1, len(shuffled) // max(1, rules.get("_avg_days", 60)))

        hit_daily = False
        hit_total = False
        hit_target = False

        for pnl, _ in shuffled:
            eq += pnl
            trade_idx_in_day += 1
            # 每 trades_per_day 笔交易作为一日结束
            if trade_idx_in_day >= trades_per_day:
                daily_loss = day_open - eq
                if daily_loss >= daily_threshold:
                    hit_daily = True
                    break
                day_open = eq
                trade_idx_in_day = 0
            if eq <= total_threshold:
                hit_total = True
                break
            if eq >= target_value:
                hit_target = True
                break

        if hit_daily:
            fail_daily += 1
        elif hit_total:
            fail_total += 1
        elif hit_target:
            pass_count += 1
        else:
            fail_target += 1  # 既没爆也没达标

    return {
        "n_simulations": n_sims,
        "pass_count": pass_count,
        "pass_rate_pct": round(pass_count / n_sims * 100, 2),
        "fail_daily_loss": fail_daily,
        "fail_total_loss": fail_total,
        "fail_target_not_reached": fail_target,
    }


def scan_ftmo_compliance(equity_points, trades, initial_capital, rules=None):
    """
    主入口。
    返回结构：
    {
      "rules": {...},
      "summary": {
        "daily_loss_status": "pass" | "fail",
        "total_loss_status": "pass" | "fail",
        "target_status": "reached" | "not_reached",
        "overall_verdict": "pass" | "fail" | "borderline"
      },
      "daily_loss": { "max_observed_pct": x, "limit_pct": 5, "violations": [...], "worst_day": "..." },
      "total_loss": { "max_observed_pct": x, "limit_pct": 10, "violated": bool, "triggered_time": ... },
      "rolling_entry": { "total_entries": n, "fail_count": k, "fail_rate_pct": x, "worst_drawdown_pct": y },
      "consecutive_loss": { "max_consec_loss_count": n, "max_consec_loss_amount": x },
      "monte_carlo": { "n_simulations": 500, "pass_rate_pct": x, ... } | None,
      "final_return_pct": x,
    }
    """
    r = dict(FTMO_SWING_DEFAULTS)
    if rules:
        r.update(rules)

    daily = _equity_to_daily(equity_points or [], initial_capital)

    # 1) 日亏损扫描
    daily_violations, max_dl_pct, worst_day = _scan_daily_loss_violations(
        daily, r["daily_loss_pct"]
    )

    # 2) 总亏损扫描
    total_loss = _scan_total_loss_violations(
        equity_points or [], initial_capital, r["total_loss_pct"]
    )

    # 3) 滚动起点
    rolling = _scan_rolling_entry(
        trades or [], initial_capital,
        r["daily_loss_pct"], r["total_loss_pct"]
    )

    # 4) 连亏序列
    consec = _scan_consecutive_losses(trades or [])

    # 5) 蒙特卡洛通过率
    avg_days = max(len(daily), 1)
    rules_for_mc = dict(r)
    rules_for_mc["_avg_days"] = avg_days
    mc = _monte_carlo_pass_rate(trades or [], initial_capital, rules_for_mc)

    # 最终净值与收益率
    final_eq = equity_points[-1]["equity"] if equity_points else initial_capital
    final_return_pct = (final_eq - initial_capital) / initial_capital * 100 if initial_capital > 0 else 0
    target_reached = final_return_pct >= r["profit_target_pct"]

    daily_status = "pass" if not daily_violations else "fail"
    total_status = "fail" if total_loss["violated"] else "pass"
    target_status = "reached" if target_reached else "not_reached"

    if daily_status == "fail" or total_status == "fail":
        verdict = "fail"
    elif target_status == "reached":
        verdict = "pass"
    else:
        verdict = "borderline"

    return {
        "rules": {
            "daily_loss_pct": r["daily_loss_pct"],
            "total_loss_pct": r["total_loss_pct"],
            "profit_target_pct": r["profit_target_pct"],
            "min_trading_days": r["min_trading_days"],
            "allow_weekend": r["allow_weekend"],
            "rule_set": "FTMO_Swing",
        },
        "summary": {
            "daily_loss_status": daily_status,
            "total_loss_status": total_status,
            "target_status": target_status,
            "overall_verdict": verdict,
        },
        "final_return_pct": round(final_return_pct, 2),
        "trading_days": len(daily),
        "daily_loss": {
            "max_observed_pct": max_dl_pct,
            "limit_pct": r["daily_loss_pct"],
            "worst_day": worst_day,
            "violation_count": len(daily_violations),
            "violations": daily_violations[:50],  # 限制返回数量
        },
        "total_loss": {
            "max_observed_pct": total_loss["max_loss_pct"],
            "limit_pct": r["total_loss_pct"],
            "violated": total_loss["violated"],
            "worst_time": total_loss["worst_time"],
            "triggered_time": total_loss["triggered_time"],
        },
        "rolling_entry": rolling,
        "consecutive_loss": consec,
        "monte_carlo": mc,
    }
