import types
import importlib.util
import traceback
import ast
import pandas as pd
import math


# ─── 安全沙箱：AST 白名单 ────────────────────────────────────────────────────
# 防止用户提交的策略代码执行任意系统操作（窃取 SUPABASE_SERVICE_KEY、读文件、网络请求、反向 shell 等）。
# 设计原则：白名单 > 黑名单。只放行策略代码确实需要的能力，其他全部拒绝。

# 内置策略实测仅用 pandas/numpy/vectorbt 三个 import，零 dunder 属性。
# 这里多给几个常用但安全的科学计算模块作备用。
_ALLOWED_IMPORTS = {
    "pandas", "numpy", "vectorbt", "pandas_ta",
    "math", "statistics", "datetime", "decimal", "itertools", "functools", "collections",
}

# 危险的内置函数与名字（即使没显式 import，也能用来突破沙箱）
_FORBIDDEN_NAMES = {
    "__import__", "eval", "exec", "compile",
    "open", "input", "breakpoint",
    "getattr", "setattr", "delattr", "hasattr",
    "globals", "locals", "vars", "dir",
    "memoryview", "type",  # type(x).__bases__ 是经典逃逸链入口
    "help", "exit", "quit",
}


def _validate_safe_ast(code_string: str) -> None:
    """对用户提交的策略代码做 AST 级别的安全校验。

    校验失败抛 ValueError，由 run_dynamic_code 包装成 HTTP 400 返回。
    校验通过 = 代码没有明显的沙箱逃逸 / 任意 import / 危险 builtin 用法。

    注意：这是「**预防式**」沙箱——不能 100% 杜绝所有逃逸（Python 的 exec 本质不可能完全沙箱化），
    但能挡住 99% 的真实攻击载荷（爬虫脚本、`import os`、`__import__("os")`、
    `().__class__.__bases__[0].__subclasses__()` 这类经典逃逸链）。
    """
    try:
        tree = ast.parse(code_string)
    except SyntaxError as e:
        raise ValueError(f"策略代码语法错误：{e}")

    for node in ast.walk(tree):
        # ── 拒绝危险 import ──
        if isinstance(node, ast.Import):
            for alias in node.names:
                root = alias.name.split(".")[0]
                if root not in _ALLOWED_IMPORTS:
                    raise ValueError(
                        f"安全沙箱拒绝：不允许 import '{alias.name}'。"
                        f"策略代码只能使用 {sorted(_ALLOWED_IMPORTS)} 这些模块。"
                    )
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if root not in _ALLOWED_IMPORTS:
                raise ValueError(
                    f"安全沙箱拒绝：不允许 from '{node.module}' import。"
                    f"策略代码只能使用 {sorted(_ALLOWED_IMPORTS)} 这些模块。"
                )

        # ── 拒绝所有双下划线属性访问（_dunder 是 Python 沙箱逃逸的标准入口）──
        # 例：obj.__class__.__bases__[0].__subclasses__() → 拿到 type 的所有子类 → file/os 等都能拿到
        elif isinstance(node, ast.Attribute):
            if node.attr.startswith("__") and node.attr.endswith("__"):
                raise ValueError(
                    f"安全沙箱拒绝：不允许访问 dunder 属性 '.{node.attr}'。"
                    f"这是 Python 沙箱逃逸的常用入口，已被禁止。"
                )

        # ── 拒绝危险名字的使用（即使没 import 也能调用的内置）──
        elif isinstance(node, ast.Name):
            if node.id in _FORBIDDEN_NAMES:
                raise ValueError(
                    f"安全沙箱拒绝：禁止使用 '{node.id}'。"
                    f"该名字属于危险内置（eval/exec/__import__/open 等）。"
                )


def _extract_param_defaults(code_string: str) -> dict:
    """
    扫描策略代码,提取所有 parameters.get('xxx', DEFAULT) 或 p.get('xxx', DEFAULT) 的默认值。
    用于在没有用户覆盖时,在 metrics 里展示真实使用的参数。
    """
    defaults = {}
    try:
        tree = ast.parse(code_string)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call): continue
            if not isinstance(node.func, ast.Attribute): continue
            if node.func.attr != 'get': continue
            # parameters.get / p.get
            obj_name = node.func.value.id if isinstance(node.func.value, ast.Name) else ''
            if obj_name not in ('parameters', 'p'): continue
            if len(node.args) < 1: continue
            key_node = node.args[0]
            if not isinstance(key_node, ast.Constant) or not isinstance(key_node.value, str): continue
            key = key_node.value
            if key.startswith('_'): continue  # 跳过内部字段
            # 默认值(第二参数)
            default_val = None
            if len(node.args) >= 2:
                dn = node.args[1]
                if isinstance(dn, ast.Constant):
                    default_val = dn.value
                elif isinstance(dn, ast.UnaryOp) and isinstance(dn.op, ast.USub) and isinstance(dn.operand, ast.Constant):
                    default_val = -dn.operand.value
            # 只保留有具体默认值的参数,跳过 None
            if default_val is not None:
                defaults[key] = default_val
    except Exception:
        pass
    return defaults

def _clean_float(val):
    if val is None: return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, 4)
    except Exception:
        return None

def _safe(val, decimals=2):
    """把 VectorBT stats 值安全转为 float，无效返回 None。"""
    if val is None: return None
    try:
        f = float(val)
        return None if (math.isnan(f) or math.isinf(f)) else round(f, decimals)
    except Exception:
        return None

_TF_TO_FREQ = {
    '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
    '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '12h': '12h',
    '1d': '1D', '1w': '1W',
}

# 每根 K 线对应小时数，用于计算持仓 K 线数
_TF_TO_HOURS = {
    '1m': 1/60, '5m': 5/60, '15m': 0.25, '30m': 0.5,
    '1h': 1, '2h': 2, '4h': 4, '6h': 6, '12h': 12,
    '1d': 24, '1w': 168,
}


def run_dynamic_code(code_string: str, df, parameters: dict, timeframe: str = '4h'):
    """
    动态执行用户策略代码。
    策略必须包含 execute(df, parameters) 函数，返回 (portfolio, indicators_dict) 或 portfolio。
    返回完整的 TV 风格 metrics。
    """
    try:
        # ── 安全沙箱：AST 白名单校验（在 exec 之前）──
        # 任何不在白名单的 import / dunder 属性 / 危险名字会立刻抛 ValueError，
        # 由下面的 except 包装成 traceback 返回给前端，HTTP 400。
        _validate_safe_ast(code_string)

        module_name = "dynamic_strategy"
        spec = importlib.util.spec_from_loader(module_name, loader=None)
        dynamic_module = importlib.util.module_from_spec(spec)
        exec(code_string, dynamic_module.__dict__)

        if not hasattr(dynamic_module, 'execute'):
            raise ValueError("策略代码必须包含 execute(df, parameters) 函数。")

        if 'timestamp' in df.columns:
            df = df.set_index('timestamp')

        # start_date / end_date 裁剪：对齐 TV 图表的 Backtesting range
        # 用法：parameters 里传 "start_date": "2019-12-16 13:00:00" 和/或 "end_date": "2026-05-15"
        start_date = parameters.get("start_date")
        end_date = parameters.get("end_date")
        if start_date:
            df = df[df.index >= pd.Timestamp(start_date)].copy()
            if df.empty:
                raise ValueError(f"start_date={start_date} 之后无数据，请检查时间格式或数据范围。")
        if end_date:
            df = df[df.index <= pd.Timestamp(end_date)].copy()
            if df.empty:
                raise ValueError(f"end_date={end_date} 之前无数据，请检查时间格式或数据范围。")

        result = dynamic_module.execute(df, parameters)

        # 支持 3 元素返回：(portfolio, indicators, _strategy_trades)
        strategy_trades_raw = None
        if isinstance(result, tuple) and len(result) == 3:
            portfolio, raw_indicators, strategy_trades_raw = result
        elif isinstance(result, tuple) and len(result) == 2:
            portfolio, raw_indicators = result
        elif isinstance(result, tuple) and len(result) == 1:
            portfolio, raw_indicators = result[0], {}
        else:
            portfolio = result
            raw_indicators = {}

        if not hasattr(portfolio, 'stats'):
            raise ValueError(f"execute() 返回的 portfolio 不是 VectorBT Portfolio 对象，实际类型：{type(portfolio)}")

        # 注入 freq，让 Sharpe/Sortino/Calmar 按正确时间尺度计算
        # portfolio.replace() 在部分 VBT 版本返回 tuple 而非 Portfolio，改为直接传给 stats()
        freq = _TF_TO_FREQ.get(timeframe, '4h')
        try:
            stats = portfolio.stats(settings=dict(freq=freq))
        except Exception:
            stats = portfolio.stats()

        # ── 处理 trades 列 ──────────────────────────────────────────
        # trades_df 始终从 VBT 获取，用于统计计算
        trades_df = portfolio.trades.records_readable.copy()
        if not trades_df.empty:
            trades_df['Entry Timestamp'] = trades_df['Entry Timestamp'].astype(str)
            trades_df['Exit Timestamp']  = trades_df['Exit Timestamp'].astype(str)
            if 'Direction' in trades_df.columns:
                trades_df['Direction'] = trades_df['Direction'].astype(str).str.replace('Direction.', '', regex=False)

        # 优先使用策略自主记录的真实交易明细（解决 VBT 金字塔分解失真）
        if strategy_trades_raw and isinstance(strategy_trades_raw, list) and len(strategy_trades_raw) > 0:
            trades_list = strategy_trades_raw
        else:
            trades_list = trades_df.to_dict(orient='records') if not trades_df.empty else []

        # 统一时间戳格式为 ISO 8601（带 T 分隔符），避免浏览器按本地时区解析
        def _to_iso(ts_val):
            if ts_val is None:
                return None
            s = str(ts_val).strip()
            if not s or s == 'nan' or s == 'None':
                return None
            # 已经是 ISO 格式则直接返回
            if 'T' in s:
                return s
            # '2020-01-06 04:00:00' → '2020-01-06T04:00:00'
            return s.replace(' ', 'T')

        for t in trades_list:
            if 'Entry Timestamp' in t:
                t['Entry Timestamp'] = _to_iso(t['Entry Timestamp'])
            if 'Exit Timestamp' in t:
                t['Exit Timestamp'] = _to_iso(t['Exit Timestamp'])
            # VBT records_readable 在极端情况(入场价=0/未平仓)的 PnL/Return 会是 NaN,
            # Python NaN 进 JSON 后浏览器解析会变 NaN/null,前端 Number(NaN ?? 0) = NaN
            # 触发蒙特卡洛兜底逻辑,导致复利模式失效。这里统一把数值字段的 NaN 写成 0。
            for _k in ('PnL', 'Return', 'Size', 'Avg Entry Price', 'Avg Exit Price'):
                if _k in t:
                    _v = t[_k]
                    try:
                        if _v is None or (isinstance(_v, float) and (_v != _v)):  # NaN check
                            t[_k] = 0
                    except Exception:
                        pass

        # ── 指标 overlay 序列 ────────────────────────────────────────
        indicators_out = {}
        if raw_indicators and isinstance(raw_indicators, dict):
            for name, series in raw_indicators.items():
                # vbt 指标属性（如 .ma）常返回单列 DataFrame，自动压缩为 Series
                if isinstance(series, pd.DataFrame):
                    if series.shape[1] == 1:
                        series = series.iloc[:, 0]
                    else:
                        # 多列时每列单独输出，名称加后缀
                        for col in series.columns:
                            col_series = series[col].dropna()
                            col_points = []
                            for ts, val in col_series.items():
                                try:
                                    t = int(ts.timestamp()) if hasattr(ts, 'timestamp') else int(pd.Timestamp(str(ts)).timestamp())
                                    col_points.append({"time": t, "value": round(float(val), 6)})
                                except Exception:
                                    continue
                            if col_points:
                                indicators_out[f"{name}_{col}"] = sorted(col_points, key=lambda x: x["time"])
                        continue
                if not isinstance(series, pd.Series):
                    continue
                points = []
                for ts, val in series.items():
                    try:
                        if pd.isna(val): continue
                        t = int(ts.timestamp()) if hasattr(ts, 'timestamp') else int(pd.Timestamp(str(ts)).timestamp())
                        points.append({"time": t, "value": round(float(val), 6)})
                    except Exception:
                        continue
                indicators_out[name] = sorted(points, key=lambda x: x["time"])

        # ── 资金曲线 (Downsample if needed) ──────────────────────────
        equity_points = []
        try:
            pf_val = portfolio.value()
            total_points = len(pf_val)
            step = max(1, total_points // 1000)
            
            for i in range(0, total_points, step):
                ts = pf_val.index[i]
                val = pf_val.iloc[i]
                if pd.isna(val): continue
                t = int(ts.timestamp()) if hasattr(ts, 'timestamp') else int(pd.Timestamp(str(ts)).timestamp())
                equity_points.append({"time": t, "equity": round(float(val), 2)})
                
            # Always ensure the last point is included for exact final equity
            if total_points > 0 and (total_points - 1) % step != 0:
                ts = pf_val.index[-1]
                val = pf_val.iloc[-1]
                if not pd.isna(val):
                    t = int(ts.timestamp()) if hasattr(ts, 'timestamp') else int(pd.Timestamp(str(ts)).timestamp())
                    equity_points.append({"time": t, "equity": round(float(val), 2)})
        except Exception:
            pass

        # ── 基础数值 ─────────────────────────────────────────────────
        init_cash  = float(portfolio.init_cash) if hasattr(portfolio, 'init_cash') else 10000.0
        pf_value   = portfolio.value()
        end_value  = float(pf_value.iloc[-1]) if len(pf_value) > 0 else init_cash
        net_profit = round(end_value - init_cash, 2)

        # 根据用户的需求，基础的“最大回撤”仅按照平仓后的结算资金（Closed Trade Balance）计算
        closed_equity_list = [init_cash]
        closed_equity_idx = [pf_value.index[0] if len(pf_value) else pd.Timestamp.now()]
        for t in trades_list:
            ex_ts = t.get("Exit Timestamp")
            if ex_ts:
                closed_equity_list.append(closed_equity_list[-1] + float(t.get("PnL", 0)))
                closed_equity_idx.append(pd.Timestamp(ex_ts))
        
        closed_equity_series = pd.Series(closed_equity_list, index=closed_equity_idx)
        _peak = closed_equity_series.cummax()
        _dd_pct = ((closed_equity_series - _peak) / _peak * 100).clip(upper=0)
        _max_dd_pct = round(abs(float(_dd_pct.min())), 4) if len(_dd_pct) else 0.0

        max_dd_peak_ts = None
        max_dd_trough_ts = None
        try:
            if len(_dd_pct) > 0 and _dd_pct.min() < 0:
                trough_idx = _dd_pct.idxmin()
                max_dd_trough_ts = int(trough_idx.timestamp())
                peak_idx = closed_equity_series.loc[:trough_idx].idxmax()
                max_dd_peak_ts = int(peak_idx.timestamp())
        except Exception:
            pass

        # FTMO 式最大回撤（相对初始本金，基准固定不上移）
        _ftmo_dd_pct = round(abs(float(((pf_value - init_cash) / init_cash * 100).clip(upper=0).min())), 4) if len(pf_value) else 0.0

        # ── 从 trades_list 算所有统计量（与交易明细表格保持一致）──────
        pnl_all   = pd.Series(dtype=float)
        ret_all   = pd.Series(dtype=float)
        pnl_long  = pd.Series(dtype=float)
        pnl_short = pd.Series(dtype=float)
        long_mask = pd.Series(dtype=bool)
        short_mask = pd.Series(dtype=bool)
        bars = pd.Series(dtype=float)
        win_trades_n = loss_trades_n = 0
        win_trades_long = loss_trades_long = 0
        win_trades_short = loss_trades_short = 0

        avg_win_abs = avg_loss_abs = None
        avg_win_pct = avg_loss_pct = None
        max_win_abs = max_loss_abs = 0.0
        max_win_pct = max_loss_pct = 0.0
        gross_profit = gross_loss = 0.0
        gross_profit_long = gross_loss_long = 0.0
        gross_profit_short = gross_loss_short = 0.0
        expectancy_abs = None
        payoff_ratio = None

        # 持仓 K 线数
        tf_hours = _TF_TO_HOURS.get(timeframe, 4)
        avg_bars_all = avg_bars_win = avg_bars_loss = None

        # 优先从策略自记录统计（金字塔加仓时 VBT trades_df 会拆分加仓单导致笔数虚高）
        stat_source = trades_list if trades_list else (trades_df.to_dict(orient='records') if not trades_df.empty else [])
        total_trades_n = len(stat_source)

        if stat_source:
            orig = pd.DataFrame(stat_source)
            # 统一列名
            if 'Direction' in orig.columns:
                orig['Direction'] = orig['Direction'].astype(str).str.replace('Direction.', '', regex=False)

            pnl_all  = orig['PnL'].apply(lambda x: float(x) if not pd.isna(x) else 0.0)
            ret_all  = orig['Return'].apply(lambda x: float(x) if not pd.isna(x) else 0.0) * 100 \
                       if 'Return' in orig.columns else pd.Series(dtype=float)

            winners = pnl_all[pnl_all > 0]
            losers  = pnl_all[pnl_all < 0]
            win_trades_n  = len(winners)
            loss_trades_n = len(losers)

            gross_profit = round(float(winners.sum()), 2)
            gross_loss   = round(abs(float(losers.sum())), 2)
            max_win_abs  = round(float(pnl_all.max()), 2) if len(pnl_all) else 0.0
            max_loss_abs = round(abs(float(pnl_all.min())), 2) if len(pnl_all) else 0.0
            avg_win_abs  = round(float(winners.mean()), 2) if len(winners) else None
            avg_loss_abs = round(abs(float(losers.mean())), 2) if len(losers) else None

            if len(ret_all):
                ret_win  = ret_all[pnl_all > 0]
                ret_loss = ret_all[pnl_all < 0]
                max_win_pct  = round(float(ret_all.max()), 4) if len(ret_all) else 0.0
                max_loss_pct = round(abs(float(ret_all.min())), 4) if len(ret_all) else 0.0
                avg_win_pct  = round(float(ret_win.mean()), 4) if len(ret_win) else None
                avg_loss_pct = round(abs(float(ret_loss.mean())), 4) if len(ret_loss) else None

            # 期望收益（USDT）= (胜率 × 平均盈 - 败率 × 平均亏）
            if avg_win_abs is not None and avg_loss_abs is not None and total_trades_n > 0:
                wr = win_trades_n / total_trades_n
                expectancy_abs = round(wr * avg_win_abs - (1 - wr) * avg_loss_abs, 2)

            # 盈亏比
            if avg_win_abs and avg_loss_abs and avg_loss_abs > 0:
                payoff_ratio = round(avg_win_abs / avg_loss_abs, 4)

            # 多头 / 空头分开统计
            if 'Direction' in orig.columns:
                long_mask  = orig['Direction'].str.lower().str.contains('long')
                short_mask = orig['Direction'].str.lower().str.contains('short')
                pnl_long  = pnl_all[long_mask]
                pnl_short = pnl_all[short_mask]
                win_trades_long   = int((pnl_long  > 0).sum())
                loss_trades_long  = int((pnl_long  < 0).sum())
                win_trades_short  = int((pnl_short > 0).sum())
                loss_trades_short = int((pnl_short < 0).sum())
                gross_profit_long  = round(float(pnl_long[pnl_long > 0].sum()), 2)
                gross_loss_long    = round(abs(float(pnl_long[pnl_long < 0].sum())), 2)
                gross_profit_short = round(float(pnl_short[pnl_short > 0].sum()), 2)
                gross_loss_short   = round(abs(float(pnl_short[pnl_short < 0].sum())), 2)

            # 持仓 K 线数（从 Duration 计算）
            try:
                dur_col = None
                for c in ['Duration', 'Trade Duration']:
                    if c in orig.columns:
                        dur_col = c; break
                if dur_col is None:
                    # 用 Entry/Exit Timestamp 自算
                    entry_ts = pd.to_datetime(orig['Entry Timestamp'])
                    exit_ts  = pd.to_datetime(orig['Exit Timestamp'])
                    hours = (exit_ts - entry_ts).dt.total_seconds() / 3600
                    bars = hours / tf_hours
                else:
                    dur = orig[dur_col]
                    # timedelta or string
                    hours = pd.to_timedelta(dur).dt.total_seconds() / 3600
                    bars = hours / tf_hours

                win_bars  = bars[pnl_all > 0]
                loss_bars = bars[pnl_all < 0]
                avg_bars_all  = round(float(bars.mean()), 0) if len(bars) else None
                avg_bars_win  = round(float(win_bars.mean()), 0) if len(win_bars) else None
                avg_bars_loss = round(float(loss_bars.mean()), 0) if len(loss_bars) else None
            except Exception:
                pass

        # ── 最大连赢 / 连亏 ──────────────────────────────────────────
        max_consec_win = max_consec_loss = 0
        cur_win = cur_loss = 0
        for pnl_val in pnl_all:
            if pnl_val > 0:
                cur_win += 1; cur_loss = 0
                max_consec_win = max(max_consec_win, cur_win)
            elif pnl_val < 0:
                cur_loss += 1; cur_win = 0
                max_consec_loss = max(max_consec_loss, cur_loss)
            else:
                cur_win = cur_loss = 0

        # ── 买入持有基准 ──────────────────────────────────────────────
        benchmark_return_pct = _safe(stats.get("Benchmark Return [%]"), 2)
        benchmark_return_abs = None
        if benchmark_return_pct is not None:
            benchmark_return_abs = round(init_cash * benchmark_return_pct / 100, 2)

        # ── CAGR 年化收益率 ───────────────────────────────────────────
        cagr_pct = None
        try:
            start_dt = pd.Timestamp(stats.get("Start") or df.index[0])
            end_dt   = pd.Timestamp(stats.get("End")   or df.index[-1])
            years = (end_dt - start_dt).days / 365.25
            if years > 0 and init_cash > 0:
                cagr_pct = round(((end_value / init_cash) ** (1 / years) - 1) * 100, 2)
        except Exception:
            pass

        # ── 最大回撤持续时间（天）────────────────────────────────────
        max_dd_duration_days = None
        try:
            mdd_dur = stats.get("Max Drawdown Duration")
            if mdd_dur is not None:
                max_dd_duration_days = int(pd.Timedelta(mdd_dur).days)
        except Exception:
            pass

        # ── 回撤事件统计：平均回撤持续、平均回撤幅度、最大回撤时刻剩余收益 ──
        avg_dd_duration_days = None
        avg_dd_pct = None
        max_dd_profit_at_trough = None
        try:
            if len(pf_value) > 1:
                peak_series = pf_value.cummax()
                in_dd = pf_value < peak_series  # 是否处于回撤中

                dd_durations = []
                dd_depths = []
                start_idx = None
                local_peak = None
                for i, (ts_i, val) in enumerate(pf_value.items()):
                    pk = float(peak_series.iloc[i])
                    if val < pk:  # 进入回撤
                        if start_idx is None:
                            start_idx = i
                            local_peak = pk
                        depth = (pk - val) / pk * 100
                        dd_depths.append(depth)
                    else:  # 离开回撤
                        if start_idx is not None:
                            dur = i - start_idx
                            # 转换为天数
                            try:
                                t_start = pf_value.index[start_idx]
                                t_end   = pf_value.index[i]
                                dur_days = (t_end - t_start).days
                            except Exception:
                                dur_days = dur
                            dd_durations.append(dur_days)
                            start_idx = None
                            local_peak = None

                if dd_durations:
                    avg_dd_duration_days = round(sum(dd_durations) / len(dd_durations), 1)
                if dd_depths:
                    avg_dd_pct = round(sum(dd_depths) / len(dd_depths), 4)

                # 最大回撤波谷时刻账户净值 - 初始本金 = 剩余利润
                trough_val = float(pf_value.iloc[_dd_pct.argmin()]) if len(_dd_pct) > 0 else init_cash
                max_dd_profit_at_trough = round(trough_val - init_cash, 2)
        except Exception:
            pass

        # ── 回测起止时间 ──────────────────────────────────────────────
        backtest_start = str(stats.get("Start") or df.index[0])[:10]
        backtest_end   = str(stats.get("End")   or df.index[-1])[:10]

        # ── 多/空 CAGR 与回报率 ───────────────────────────────────────
        # 净利润绝对值
        net_profit_long  = round(gross_profit_long  - gross_loss_long,  2)
        net_profit_short = round(gross_profit_short - gross_loss_short, 2)
        # 占初始本金 %
        return_pct_long  = round(net_profit_long  / init_cash * 100, 4) if init_cash else None
        return_pct_short = round(net_profit_short / init_cash * 100, 4) if init_cash else None
        # 多/空 CAGR
        cagr_pct_long = cagr_pct_short = None
        try:
            start_dt = pd.Timestamp(stats.get("Start") or df.index[0])
            end_dt   = pd.Timestamp(stats.get("End")   or df.index[-1])
            years    = (end_dt - start_dt).days / 365.25
            if years > 0 and init_cash > 0:
                cagr_pct_long  = round(((init_cash + net_profit_long)  / init_cash) ** (1/years) * 100 - 100, 2) if net_profit_long  > -init_cash else None
                cagr_pct_short = round(((init_cash + net_profit_short) / init_cash) ** (1/years) * 100 - 100, 2) if net_profit_short > -init_cash else None
        except Exception:
            pass

        # ── 多/空 期望收益与盈亏比 ────────────────────────────────────
        expectancy_long = expectancy_short = None
        payoff_long = payoff_short = None
        avg_win_long_abs = avg_loss_long_abs = None
        avg_win_short_abs = avg_loss_short_abs = None
        avg_win_long_pct = avg_loss_long_pct = None
        avg_win_short_pct = avg_loss_short_pct = None
        max_win_long_abs = max_loss_long_abs = None
        max_win_short_abs = max_loss_short_abs = None
        max_win_long_pct = max_loss_long_pct = None
        max_win_short_pct = max_loss_short_pct = None
        try:
            if len(pnl_long):
                _wl = pnl_long[pnl_long > 0]; _ll = pnl_long[pnl_long < 0]
                if len(_wl): avg_win_long_abs  = round(float(_wl.mean()), 2); max_win_long_abs  = round(float(_wl.max()),  2)
                if len(_ll): avg_loss_long_abs = round(abs(float(_ll.mean())), 2); max_loss_long_abs = round(abs(float(_ll.min())), 2)
                if avg_win_long_abs is not None and avg_loss_long_abs is not None and len(pnl_long):
                    wr_l = len(_wl) / len(pnl_long)
                    expectancy_long = round(wr_l * avg_win_long_abs - (1 - wr_l) * avg_loss_long_abs, 2)
                if avg_win_long_abs and avg_loss_long_abs:
                    payoff_long = round(avg_win_long_abs / avg_loss_long_abs, 4)
            if len(pnl_short):
                _ws = pnl_short[pnl_short > 0]; _ls = pnl_short[pnl_short < 0]
                if len(_ws): avg_win_short_abs  = round(float(_ws.mean()), 2); max_win_short_abs  = round(float(_ws.max()),  2)
                if len(_ls): avg_loss_short_abs = round(abs(float(_ls.mean())), 2); max_loss_short_abs = round(abs(float(_ls.min())), 2)
                if avg_win_short_abs is not None and avg_loss_short_abs is not None and len(pnl_short):
                    wr_s = len(_ws) / len(pnl_short)
                    expectancy_short = round(wr_s * avg_win_short_abs - (1 - wr_s) * avg_loss_short_abs, 2)
                if avg_win_short_abs and avg_loss_short_abs:
                    payoff_short = round(avg_win_short_abs / avg_loss_short_abs, 4)
        except Exception:
            pass

        # ── 多/空 平均 bars 持仓 ───────────────────────────────────────
        avg_bars_long = avg_bars_short = None
        try:
            if stat_source and len(long_mask) and len(bars):
                bl = bars[long_mask];  bs = bars[short_mask]
                if len(bl): avg_bars_long  = round(float(bl.mean()), 0)
                if len(bs): avg_bars_short = round(float(bs.mean()), 0)
        except Exception:
            pass

        # ── Run-up (净值上涨持续/幅度) ─────────────────────────────────
        max_runup_abs = max_runup_pct = None
        avg_runup_abs = avg_runup_pct = None
        avg_runup_duration_days = None
        max_runup_intrabar_abs = max_runup_intrabar_pct = None
        try:
            if len(pf_value) > 1:
                _val_min = pf_value.cummin()
                _runup = pf_value - _val_min        # 当前净值离上一个谷底的距离
                _runup_pct = _runup / _val_min * 100
                max_runup_abs = round(float(_runup.max()), 2)
                max_runup_pct = round(float(_runup_pct.max()), 2)

                # 逐次 run-up 事件:val > val_min 且 val_min 在改变前一次
                runup_durations = []
                runup_depths = []
                start_idx = None
                local_trough = None
                for i, val in enumerate(pf_value.values):
                    tr = float(_val_min.iloc[i])
                    if val > tr:
                        if start_idx is None:
                            start_idx = i
                            local_trough = tr
                        runup_depths.append((val - tr) / tr * 100 if tr else 0)
                    else:
                        if start_idx is not None:
                            try:
                                dur_days = (pf_value.index[i] - pf_value.index[start_idx]).days
                            except Exception:
                                dur_days = i - start_idx
                            runup_durations.append(dur_days)
                            start_idx = None
                            local_trough = None
                if runup_durations:
                    avg_runup_duration_days = round(sum(runup_durations) / len(runup_durations), 1)
                if runup_depths:
                    avg_runup_pct = round(sum(runup_depths) / len(runup_depths), 2)
                    avg_runup_abs = round(avg_runup_pct / 100 * init_cash, 2)

                # intrabar:用 high - cummin(low) 近似(策略层面没逐根 high/low 净值,这里用 close 估算)
                max_runup_intrabar_abs = max_runup_abs
                max_runup_intrabar_pct = max_runup_pct
        except Exception:
            pass

        # ── 最大持仓量 (单笔最大 Size) ──────────────────────────────────
        max_position_size = None
        try:
            if stat_source:
                sizes = pd.Series([abs(float(t.get('Size', 0))) for t in stat_source])
                if len(sizes):
                    max_position_size = round(float(sizes.max()), 6)
        except Exception:
            pass

        # ── 占比指标 ───────────────────────────────────────────────────
        # 净利润占最大亏损的%
        net_profit_over_max_loss_pct = None
        try:
            if max_loss_abs:
                net_profit_over_max_loss_pct = round(net_profit / max_loss_abs * 100, 2)
        except Exception:
            pass
        # 最大盈利占总盈利 %
        max_win_over_gross_profit_pct = None
        try:
            if gross_profit:
                max_win_over_gross_profit_pct = round(max_win_abs / gross_profit * 100, 2)
        except Exception:
            pass
        # 最大亏损占总亏损 %
        max_loss_over_gross_loss_pct = None
        try:
            if gross_loss:
                max_loss_over_gross_loss_pct = round(max_loss_abs / gross_loss * 100, 2)
        except Exception:
            pass
        # 策略表现优异 = net_profit_abs - benchmark_return_abs
        strategy_outperformance = None
        try:
            if benchmark_return_abs is not None:
                strategy_outperformance = round(net_profit - benchmark_return_abs, 2)
        except Exception:
            pass

        # ── 组装 metrics ──────────────────────────────────────────────
        m = {
            # === 表现 ===
            "initial_capital":        round(init_cash, 2),
            "end_value":              round(end_value, 2),
            "net_profit_abs":         net_profit,
            "total_return_pct":       round(_safe(stats.get("Total Return [%]"), 4) or 0, 4),
            "gross_profit_abs":       gross_profit,
            "gross_loss_abs":         gross_loss,
            "gross_profit_long":      gross_profit_long,
            "gross_loss_long":        gross_loss_long,
            "gross_profit_short":     gross_profit_short,
            "gross_loss_short":       gross_loss_short,
            "expectancy_abs":         expectancy_abs,
            "commission_paid":        _safe(stats.get("Total Fees Paid"), 2),
            "benchmark_return_pct":   benchmark_return_pct,
            "benchmark_return_abs":   benchmark_return_abs,
            "cagr_pct":               cagr_pct,
            "max_drawdown_pct":       _max_dd_pct,
            "max_dd_peak_ts":         max_dd_peak_ts,
            "max_dd_trough_ts":       max_dd_trough_ts,
            "ftmo_drawdown_pct":      _ftmo_dd_pct,
            "max_drawdown_duration_days": max_dd_duration_days,
            "avg_drawdown_duration_days": avg_dd_duration_days,
            "avg_drawdown_pct":       avg_dd_pct,
            "max_dd_profit_at_trough": max_dd_profit_at_trough,
            "open_trade_pnl":         _safe(stats.get("Open Trade PnL"), 2),

            # === 交易分析 ===
            "total_trades":           total_trades_n,
            "win_trades":             win_trades_n,
            "loss_trades":            loss_trades_n,
            "total_trades_long":      int(len(pnl_long)) if len(pnl_long) else 0,
            "total_trades_short":     int(len(pnl_short)) if len(pnl_short) else 0,
            "win_trades_long":        win_trades_long,
            "loss_trades_long":       loss_trades_long,
            "win_trades_short":       win_trades_short,
            "loss_trades_short":      loss_trades_short,
            "win_rate_pct":           round(win_trades_n / total_trades_n * 100, 4) if total_trades_n > 0 else 0,
            "avg_win_abs":            avg_win_abs,
            "avg_loss_abs":           avg_loss_abs,
            "avg_win_pct":            avg_win_pct,
            "avg_loss_pct":           avg_loss_pct,
            "max_win_abs":            max_win_abs,
            "max_loss_abs":           max_loss_abs,
            "max_win_pct":            max_win_pct,
            "max_loss_pct":           max_loss_pct,
            "payoff_ratio":           payoff_ratio,
            "avg_bars_all":           avg_bars_all,
            "avg_bars_win":           avg_bars_win,
            "avg_bars_loss":          avg_bars_loss,
            "max_consec_win":         max_consec_win,
            "max_consec_loss":        max_consec_loss,

            # === 风险调整 ===
            "sharpe":                 _safe(stats.get("Sharpe Ratio"), 4),
            "sortino":                _safe(stats.get("Sortino Ratio"), 4),
            "calmar":                 _safe(stats.get("Calmar Ratio"), 4),
            "omega":                  _safe(stats.get("Omega Ratio"), 4),
            "profit_factor":          _safe(stats.get("Profit Factor"), 4),

            # === 多/空分组扩展 ===
            "net_profit_long":        net_profit_long,
            "net_profit_short":       net_profit_short,
            "return_pct_long":        return_pct_long,
            "return_pct_short":       return_pct_short,
            "cagr_pct_long":          cagr_pct_long,
            "cagr_pct_short":         cagr_pct_short,
            "expectancy_long":        expectancy_long,
            "expectancy_short":       expectancy_short,
            "payoff_long":            payoff_long,
            "payoff_short":           payoff_short,
            "avg_win_long_abs":       avg_win_long_abs,
            "avg_loss_long_abs":      avg_loss_long_abs,
            "avg_win_short_abs":      avg_win_short_abs,
            "avg_loss_short_abs":     avg_loss_short_abs,
            "max_win_long_abs":       max_win_long_abs,
            "max_loss_long_abs":      max_loss_long_abs,
            "max_win_short_abs":      max_win_short_abs,
            "max_loss_short_abs":     max_loss_short_abs,
            "avg_bars_long":          avg_bars_long,
            "avg_bars_short":         avg_bars_short,

            # === 净值上涨(run-up) ===
            "max_runup_abs":          max_runup_abs,
            "max_runup_pct":          max_runup_pct,
            "avg_runup_abs":          avg_runup_abs,
            "avg_runup_pct":          avg_runup_pct,
            "avg_runup_duration_days": avg_runup_duration_days,
            "max_runup_intrabar_abs": max_runup_intrabar_abs,
            "max_runup_intrabar_pct": max_runup_intrabar_pct,

            # === 持仓量 ===
            "max_position_size":      max_position_size,

            # === 占比 ===
            "net_profit_over_max_loss_pct": net_profit_over_max_loss_pct,
            "max_win_over_gross_profit_pct": max_win_over_gross_profit_pct,
            "max_loss_over_gross_loss_pct":  max_loss_over_gross_loss_pct,
            "strategy_outperformance":       strategy_outperformance,

            # === 元信息 ===
            "backtest_start":         backtest_start,
            "backtest_end":           backtest_end,
            "timeframe":              timeframe,
            "raw_parameters":         {**_extract_param_defaults(code_string), **(parameters or {})},
        }

        # ── 计算完结资金曲线 (Balance Curve) ─────────────────────────
        balance_points = []
        try:
            cum_bal = init_cash
            if trades_list:
                # Add initial point
                first_ts = equity_points[0]["time"] if equity_points else 0
                balance_points.append({"time": first_ts, "equity": cum_bal})
                for t in trades_list:
                    # Parse exit timestamp
                    ex_ts = t.get("Exit Timestamp")
                    if ex_ts:
                        # Convert to unix timestamp if it's an ISO string
                        if isinstance(ex_ts, str):
                            t_val = int(pd.Timestamp(ex_ts).timestamp())
                        else:
                            t_val = int(ex_ts)
                        cum_bal += float(t.get("PnL", 0))
                        balance_points.append({"time": t_val, "equity": round(cum_bal, 2)})
        except Exception:
            pass

        return {"metrics": m, "trades": trades_list, "indicators": indicators_out, "equity": equity_points, "balance": balance_points}, None

    except Exception as e:
        return None, traceback.format_exc()
