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
COL_ALIASES = {
    "交易 #":    ["交易 #", "交易#", "Trade #", "trade_num"],
    "类型":      ["类型", "Type"],
    "信号":      ["信号", "Signal"],
    "日期和时间":  ["日期和时间", "Date/Time"],
    "净损益 USDT": ["净损益 USDT", "净利润 USDT", "P&L USDT", "净盈亏 USDT"],
    "净损益 %":   ["净损益 %", "净利润 %", "P&L %", "净盈亏 %"],
}

# 从 TradingView 汇总 sheet 里要提取的指标行 → 返回字段名
# 格式: { sheet名: [(行标签关键字, 列, 返回key), ...] }
SUMMARY_METRICS = {
    "表现": [
        ("净利润",          "全部 USDT", "net_profit_usdt"),
        ("净利润",          "全部 %",    "net_profit_pct"),
        ("最大净值回撤",     "全部 USDT", "max_drawdown_usdt"),
        ("最大净值回撤",     "全部 %",    "max_drawdown_pct"),
        ("年化收益率",       "全部 %",    "cagr_pct"),
        ("已支付佣金",      "全部 USDT", "commission_usdt"),
    ],
    "风险调整后的表现": [
        ("夏普比率",    "全部 USDT", "sharpe"),
        ("Sortino比率", "全部 USDT", "sortino"),
        ("盈利因子",    "全部 USDT", "profit_factor"),
    ],
    "交易分析": [
        ("总交易",            "全部 USDT", "total_trades_sheet"),
        ("获利百分比",        "全部 %",    "win_rate_sheet"),
        ("平均盈利交易",      "全部 USDT", "avg_win_usdt"),
        ("平均亏损交易",      "全部 USDT", "avg_loss_usdt"),
        ("最大盈利交易",      "全部 USDT", "max_win_usdt_sheet"),
        ("最大亏损交易",      "全部 USDT", "max_loss_usdt_sheet"),
        ("平均胜率/平均负率", "全部 USDT", "win_loss_ratio"),
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
        for name in xls.sheet_names:
            if "交易清单" in name or "List of Trades" in name or "trades" in name.lower():
                target = name
                break
        if target is None:
            target = xls.sheet_names[0]
        return pd.read_excel(xls, sheet_name=target), xls

    raise HTTPException(status_code=400, detail="仅支持 .xlsx 或 .csv 文件")


def _extract_sheet_metrics(xls: pd.ExcelFile) -> Dict[str, Any]:
    """从 TradingView 汇总 sheet 提取风险指标，找不到的字段静默跳过。"""
    result: Dict[str, Any] = {}
    for sheet_name, metrics in SUMMARY_METRICS.items():
        if sheet_name not in xls.sheet_names:
            continue
        df = pd.read_excel(xls, sheet_name=sheet_name)
        # 第一列为行标签，统一转字符串便于模糊匹配
        label_col = df.columns[0]
        df[label_col] = df[label_col].astype(str)
        for row_keyword, col_name, return_key in metrics:
            if col_name not in df.columns:
                continue
            # 用 str.contains 做模糊匹配，避免 TradingView 版本差异
            mask = df[label_col].str.contains(row_keyword, na=False)
            matched = df.loc[mask, col_name]
            if matched.empty:
                continue
            val = matched.iloc[0]
            if pd.notna(val):
                try:
                    result[return_key] = round(float(val), 4)
                except (ValueError, TypeError):
                    result[return_key] = str(val)
    return result


def _extract_direction(type_str: str) -> str:
    """从类型列（如'空头进场'/'多头进场'）提取方向标签。"""
    if "空头" in type_str or "short" in type_str.lower():
        return "short"
    if "多头" in type_str or "long" in type_str.lower():
        return "long"
    return "unknown"


def _extract_pattern(sig: Any) -> str:
    """正则提取 P 编号；未匹配则保留原信号名。"""
    s = str(sig)
    m = PATTERN_RE.search(s)
    return m.group(0) if m else s


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

    type_str = df[col_type].astype(str)
    entries = df[type_str.str.contains("进场", na=False)].copy()
    exits   = df[type_str.str.contains("出场", na=False)].copy()

    if entries.empty or exits.empty:
        raise HTTPException(status_code=400, detail="未识别到进场/出场记录（类型列需含'进场'和'出场'）")

    # 从进场行提取形态和方向
    entries["形态"]    = entries[col_signal].apply(_extract_pattern)
    entries["方向"]    = entries[col_type].apply(_extract_direction)
    entries["进场信号"] = entries[col_signal].astype(str)

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
