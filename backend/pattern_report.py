"""
形态归因分析路由 — POST /api/pattern-report/analyze
接收 TradingView 导出的策略测试器交易清单（xlsx / csv），
按"交易 #"合并进场/出场行，正则 (P\\d+) 提取形态标签，
聚合各形态的胜率与盈亏，并附加文件内的汇总风险指标。
"""
import io
import re
from typing import List, Dict, Any, Optional

import pandas as pd
from fastapi import APIRouter, UploadFile, File, HTTPException

router = APIRouter()

PATTERN_RE = re.compile(r"P\d+")

# 列名容错映射 — TradingView 中英文/不同版本可能略有差异
# 英文别名以 TradingView 原生导出为准（实测：Net P&L USDT / Net P&L % / Date and time）
COL_ALIASES = {
    "交易 #":    ["交易 #", "交易#", "交易编号", "Trade #", "trade_num"],
    "类型":      ["类型", "Type"],
    "信号":      ["信号", "Signal"],
    "日期和时间":  ["日期和时间", "Date and time", "Date/Time"],
    "净损益 USDT": ["净损益 USDT", "净利润 USDT", "净盈亏 USDT", "Net P&L USDT", "Net Profit USDT", "P&L USDT"],
    "净损益 %":   ["净损益 %", "净利润 %", "净盈亏 %", "Net P&L %", "Net Profit %", "P&L %"],
}

# Sheet 名中英别名（TradingView 英文导出 / BTC Station 中文导出）
SHEET_ALIASES = {
    "表现":            ["表现", "Performance"],
    "风险调整后的表现":   ["风险调整后的表现", "Risk-adjusted performance"],
    "交易分析":         ["交易分析", "Trades analysis"],
}

# 列标题中英别名（汇总 sheet 顶部表头）
SUMMARY_COL_ALIASES = {
    "全部 USDT": ["全部 USDT", "All USDT"],
    "全部 %":    ["全部 %",    "All %"],
}

# 从 TradingView 汇总 sheet 里要提取的指标行 → 返回字段名
# 格式: { sheet逻辑名: [(行关键字列表[中英], 列逻辑名, 返回key), ...] }
# 行关键字用 str.contains 模糊匹配，任一关键字命中即可；首条命中行胜出。
SUMMARY_METRICS = {
    "表现": [
        (["净利润",       "Net profit"],          "全部 USDT", "net_profit_usdt"),
        (["净利润",       "Net profit"],          "全部 %",    "net_profit_pct"),
        # "最大回撤（intrabar）" 为 TradingView 新版中文导出的行名（即旧版"最大净值回撤"）
        (["最大净值回撤", "最大回撤（intrabar）", "Max equity drawdown"], "全部 USDT", "max_drawdown_usdt"),
        (["最大净值回撤", "最大回撤（intrabar）", "Max equity drawdown"], "全部 %",    "max_drawdown_pct"),
        (["年化收益率",   "Annualized return"],   "全部 %",    "cagr_pct"),
        (["已支付佣金",   "Commission paid"],     "全部 USDT", "commission_usdt"),
    ],
    "风险调整后的表现": [
        (["夏普比率",    "Sharpe ratio"],   "全部 USDT", "sharpe"),
        (["Sortino比率", "Sortino ratio"],  "全部 USDT", "sortino"),
        (["盈利因子",    "Profit factor"],  "全部 USDT", "profit_factor"),
    ],
    "交易分析": [
        (["总交易",           "Total trades"],          "全部 USDT", "total_trades_sheet"),
        (["获利百分比",        "Percent profitable"],    "全部 %",    "win_rate_sheet"),
        (["平均盈利交易",      "Avg winning trade"],     "全部 USDT", "avg_win_usdt"),
        (["平均亏损交易",      "Avg losing trade"],      "全部 USDT", "avg_loss_usdt"),
        (["最大盈利交易",      "Largest winning trade"], "全部 USDT", "max_win_usdt_sheet"),
        (["最大亏损交易",      "Largest losing trade"],  "全部 USDT", "max_loss_usdt_sheet"),
        (["平均胜率/平均负率", "Ratio avg win"],         "全部 USDT", "win_loss_ratio"),
    ],
}


def _resolve_col(df: pd.DataFrame, key: str) -> str:
    for cand in COL_ALIASES[key]:
        if cand in df.columns:
            return cand
    raise HTTPException(status_code=400, detail=f"未找到必需列 '{key}'，候选: {COL_ALIASES[key]}")


def _load_dataframe(filename: str, raw: bytes) -> tuple[pd.DataFrame, Optional[pd.ExcelFile]]:
    """返回 (交易清单 DataFrame, ExcelFile对象或None)。csv 时 ExcelFile 为 None。"""
    lower = filename.lower()
    if lower.endswith(".csv"):
        try:
            return pd.read_csv(io.BytesIO(raw)), None
        except UnicodeDecodeError:
            return pd.read_csv(io.BytesIO(raw), encoding="gbk"), None

    if lower.endswith(".xlsx") or lower.endswith(".xls"):
        xls = pd.ExcelFile(io.BytesIO(raw))
        target = None
        # 兼容 BTC Station 中文（"交易清单"）、TradingView 新版中文（"交易"）
        # 与 TradingView 英文（"List of trades"，小写 t）。
        # 注意："交易" 必须精确匹配，不能用子串，否则会误中 "交易分析" 汇总表；
        # 同理英文不能用宽松的 "trades" 子串，否则 "Trades analysis" 会先命中。
        for name in xls.sheet_names:
            name_lower = name.lower()
            if "交易清单" in name or name == "交易" or "list of trades" in name_lower:
                target = name
                break
        if target is None:
            target = xls.sheet_names[0]
        return pd.read_excel(xls, sheet_name=target), xls

    raise HTTPException(status_code=400, detail="仅支持 .xlsx 或 .csv 文件")


def _resolve_sheet(xls: pd.ExcelFile, logical_name: str) -> Optional[str]:
    """按中英别名在 xls 里找到实际的 sheet 名。"""
    for cand in SHEET_ALIASES.get(logical_name, [logical_name]):
        if cand in xls.sheet_names:
            return cand
    return None


def _resolve_summary_col(columns: pd.Index, logical_name: str) -> Optional[str]:
    """按中英别名在 DataFrame 列里找到实际列名。"""
    for cand in SUMMARY_COL_ALIASES.get(logical_name, [logical_name]):
        if cand in columns:
            return cand
    return None


def _extract_sheet_metrics(xls: pd.ExcelFile) -> Dict[str, Any]:
    """从 TradingView 汇总 sheet 提取风险指标，找不到的字段静默跳过。

    支持中英双语：sheet 名 / 列名 / 行关键字三层都按别名查找。
    """
    result: Dict[str, Any] = {}
    for logical_sheet, metrics in SUMMARY_METRICS.items():
        actual_sheet = _resolve_sheet(xls, logical_sheet)
        if actual_sheet is None:
            continue
        df = pd.read_excel(xls, sheet_name=actual_sheet)
        # 第一列为行标签，统一转字符串便于模糊匹配
        label_col = df.columns[0]
        df[label_col] = df[label_col].astype(str)
        for row_keywords, logical_col, return_key in metrics:
            actual_col = _resolve_summary_col(df.columns, logical_col)
            if actual_col is None:
                continue
            # 任一关键字命中即可（中文 / 英文都试一遍）
            matched_val = None
            for kw in row_keywords:
                mask = df[label_col].str.contains(kw, na=False, regex=False)
                m = df.loc[mask, actual_col]
                if not m.empty:
                    matched_val = m.iloc[0]
                    break
            if matched_val is None or pd.isna(matched_val):
                continue
            try:
                result[return_key] = round(float(matched_val), 4)
            except (ValueError, TypeError):
                result[return_key] = str(matched_val)
    return result


def _extract_direction(type_str: str) -> str:
    """从类型列（如'空头进场'/'多头进场'）提取方向标签。"""
    if "空头" in type_str or "short" in type_str.lower():
        return "short"
    if "多头" in type_str or "long" in type_str.lower():
        return "long"
    return "unknown"


_DIR_SUFFIX = {"long": "多", "short": "空"}


def _extract_pattern(sig: Any, direction: str = "") -> Optional[str]:
    """正则提取 P 编号并拼接方向后缀（如 'P5多' / 'P4空'）。
    未匹配到 P 编号则返回 None，调用方自行决定回填策略（Scale-in 查上一笔底仓 / 其他保留原信号）。
    """
    s = str(sig)
    m = PATTERN_RE.search(s)
    if not m:
        return None
    return m.group(0) + _DIR_SUFFIX.get(direction, "")


@router.post("/pattern-report/analyze")
async def analyze_pattern_report(file: UploadFile = File(...)) -> Dict[str, Any]:
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="文件为空")

    df, xls = _load_dataframe(file.filename or "", raw)

    col_trade    = _resolve_col(df, "交易 #")
    col_type     = _resolve_col(df, "类型")
    col_signal   = _resolve_col(df, "信号")
    col_pnl_usdt = _resolve_col(df, "净损益 USDT")
    col_pnl_pct  = _resolve_col(df, "净损益 %")

    # 日期列可选，缺失时跳过
    col_dt = None
    for cand in COL_ALIASES["日期和时间"]:
        if cand in df.columns:
            col_dt = cand
            break

    # 兼容 BTC Station 中文（进场/出场）与 TradingView 英文（Entry long / Exit short ...）
    type_str = df[col_type].astype(str)
    entries = df[type_str.str.contains(r"进场|Entry", na=False, regex=True, case=False)].copy()
    exits   = df[type_str.str.contains(r"出场|Exit",  na=False, regex=True, case=False)].copy()

    if entries.empty or exits.empty:
        raise HTTPException(status_code=400, detail="未识别到进场/出场记录（类型列需含'进场/出场'或'Entry/Exit'）")

    # 从进场行提取方向 + 形态（形态带方向后缀，如 P5多/P5空，便于双向形态独立归因）
    entries["方向"]    = entries[col_type].apply(_extract_direction)
    entries["形态"]    = entries.apply(
        lambda r: _extract_pattern(r[col_signal], r["方向"]), axis=1
    )
    entries["进场信号"] = entries[col_signal].astype(str)

    # Scale-in 加仓单：信号列形如"Scale-in Long/Short 1"无 P 编号，加仓无法独立成立。
    # 多头加仓：策略设计上由 P1 信号在持仓中触发（仓位为 P1 的一半），全部计入 P1多。
    # 空头加仓：由空头底仓追踪激活触发、与底仓共享同一次出场（close_all），
    # 按"相同出场时间"映射回底仓形态（P4空/P5空/P6空）。
    scale_str = entries[col_signal].astype(str)
    scale_long_mask  = scale_str.str.contains("Scale-in", na=False) & (entries["方向"] == "long")
    scale_short_mask = scale_str.str.contains("Scale-in", na=False) & (entries["方向"] == "short")
    entries.loc[scale_long_mask, "形态"] = "P1多"
    if scale_short_mask.any() and col_dt is not None:
        exit_time_by_trade = dict(zip(exits[col_trade], exits[col_dt]))
        base_by_exit = {}
        base_shorts = entries[entries["形态"].notna() & (entries["方向"] == "short")]
        for _, r in base_shorts.iterrows():
            t = exit_time_by_trade.get(r[col_trade])
            if t is not None:
                base_by_exit[t] = r["形态"]
        entries.loc[scale_short_mask, "形态"] = entries.loc[scale_short_mask, col_trade].map(
            lambda tn: base_by_exit.get(exit_time_by_trade.get(tn))
        )
    # 映射不到的空头加仓（无日期列等情况）走下方 no_pattern 兜底，保留原信号名分组

    # 仍无形态的（如"开盘价"未平仓收尾单）保留原信号名作为分组标签
    no_pattern_mask = entries["形态"].isna()
    entries.loc[no_pattern_mask, "形态"] = entries.loc[no_pattern_mask, col_signal].astype(str)

    entry_cols = [col_trade, "形态", "方向", "进场信号"]
    if col_dt:
        entries["进场时间"] = entries[col_dt]
        exit_df = exits[[col_trade, col_pnl_usdt, col_pnl_pct]].copy()
        exits["出场时间"] = exits[col_dt]
        exit_df = exits[[col_trade, col_pnl_usdt, col_pnl_pct, "出场时间"]].copy()
        entry_cols.append("进场时间")
    else:
        exit_df = exits[[col_trade, col_pnl_usdt, col_pnl_pct]].copy()

    merged = pd.merge(entries[entry_cols], exit_df, on=col_trade, how="inner")

    if merged.empty:
        raise HTTPException(status_code=400, detail="进场/出场未能按'交易 #'匹配")

    merged[col_pnl_usdt] = pd.to_numeric(merged[col_pnl_usdt], errors="coerce")
    merged[col_pnl_pct]  = pd.to_numeric(merged[col_pnl_pct],  errors="coerce")
    merged = merged.dropna(subset=[col_pnl_usdt])
    merged["盈利"] = merged[col_pnl_usdt] > 0

    # ── 按形态聚合 ────────────────────────────────────────────────
    rows: List[Dict[str, Any]] = []
    for pat, g in merged.groupby("形态"):
        total      = int(len(g))
        wins       = int(g["盈利"].sum())
        sum_usdt   = float(g[col_pnl_usdt].sum())
        avg_pct    = float(g[col_pnl_pct].mean()) if g[col_pnl_pct].notna().any() else 0.0
        gross_win  = float(g.loc[g["盈利"],  col_pnl_usdt].sum())
        gross_loss = float(-g.loc[~g["盈利"], col_pnl_usdt].sum())
        max_win    = float(g[col_pnl_usdt].max())
        max_loss   = float(g[col_pnl_usdt].min())

        # 凯利公式 f* = p - (1-p)/b，b = 平均盈利/平均亏损（赔率）。
        # 全亏（b 无法计算）→ kelly 为负的极端值用 -1 表示；
        # 全胜（b 趋于无穷）→ f* 收敛于 p。结果不在此截断，由前端决定展示策略。
        losses_n = total - wins
        avg_win  = gross_win / wins      if wins     else 0.0
        avg_loss = gross_loss / losses_n if losses_n else 0.0
        p = wins / total if total else 0.0
        if avg_loss <= 0:
            kelly = p if wins else -1.0
        elif avg_win <= 0:
            kelly = -1.0
        else:
            b = avg_win / avg_loss
            kelly = p - (1 - p) / b

        # 多空方向分布
        direction_counts = g["方向"].value_counts().to_dict()

        rows.append({
            "pattern":         str(pat),
            "trades":          total,
            "wins":            wins,
            "losses":          total - wins,
            "win_rate":        wins / total if total else 0.0,
            "total_pnl_usdt":  round(sum_usdt, 2),
            "avg_pnl_pct":     round(avg_pct, 4),
            "profit_factor":   round(gross_win / gross_loss, 2) if gross_loss > 0 else None,
            "max_win_usdt":    round(max_win, 2),
            "max_loss_usdt":   round(max_loss, 2),
            "avg_win_usdt":    round(avg_win, 2),
            "avg_loss_usdt":   round(avg_loss, 2),
            "kelly":           round(min(kelly, 1.0), 4),
            "long_trades":     int(direction_counts.get("long", 0)),
            "short_trades":    int(direction_counts.get("short", 0)),
        })

    rows.sort(key=lambda r: r["total_pnl_usdt"], reverse=True)

    # ── 全局汇总 ──────────────────────────────────────────────────
    total_trades = int(len(merged))
    total_wins   = int(merged["盈利"].sum())
    total: Dict[str, Any] = {
        "trades":          total_trades,
        "wins":            total_wins,
        "win_rate":        total_wins / total_trades if total_trades else 0.0,
        "total_pnl_usdt":  round(float(merged[col_pnl_usdt].sum()), 2),
        "avg_pnl_pct":     round(float(merged[col_pnl_pct].mean()), 4) if merged[col_pnl_pct].notna().any() else 0.0,
        "long_trades":     int((merged["方向"] == "long").sum()),
        "short_trades":    int((merged["方向"] == "short").sum()),
    }

    # ── 附加 sheet 汇总指标 ───────────────────────────────────────
    if xls is not None:
        total.update(_extract_sheet_metrics(xls))

    return {"summary": rows, "total": total, "filename": file.filename}
