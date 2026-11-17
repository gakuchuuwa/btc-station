"""
海龟 SSL 双系统 6形态 形态倍数全 1.0 策略 — VectorBT 格式
基于 TurtleSslDualStrategy 复制，唯一区别：形态仓位倍数（P1~P7）全部 1.0，
不做形态差异化仓位管理（主策略是凯利收缩后的差异化倍数）。

用途：检验「形态差异化仓位管理」是否带来真实收益——本策略是全 1.0 基准，对照主策略的差异化倍数。
- 信号逻辑、ATR 动态仓位、加仓、止损体系与主策略 100% 一致
- 仅形态倍数 mult_p1_l ~ mult_p7 统一为 1.0

调参建议：
  system1_period 20~80, system2_period 100~200
  atr_mult_init 1.5~3.0, atr_mult_long_trail 5~15
"""
import pandas as pd
import numpy as np
import vectorbt as vbt


# ── 工具函数 ──────────────────────────────────────────────────────────────────

def _rma(series: pd.Series, length: int) -> pd.Series:
    """
    严格模拟 Pine Script ta.rma：
    - 前 length-1 根返回 NaN
    - 第 length 根用简单均值（SMA）作为锚点
    - 之后用 alpha=1/length 的指数平滑
    Pandas ewm(adjust=False) 从第1根就开始平滑，冷启动结果与 Pine 不一致。
    """
    alpha = 1.0 / length
    result = np.full(len(series), np.nan)
    vals = series.values
    start = length - 1
    while start < len(vals) and np.isnan(vals[start - length + 1 : start + 1]).any():
        start += 1
    if start >= len(vals):
        return pd.Series(result, index=series.index)
    result[start] = np.nanmean(vals[start - length + 1 : start + 1])
    for j in range(start + 1, len(vals)):
        if np.isnan(vals[j]):
            result[j] = np.nan
        else:
            result[j] = alpha * vals[j] + (1 - alpha) * result[j - 1]
    return pd.Series(result, index=series.index)


def _ssl_channel(high, low, close, length):
    """SSL 通道：返回 (hlv, ssl_up, ssl_down, ma_high, ma_low)。
    ma_high/ma_low 一并返回，供 c1_gt_c2 复用，避免重复计算 RMA。"""
    ma_high = _rma(high, length)
    ma_low = _rma(low, length)

    hlv = pd.Series(np.nan, index=close.index)
    hlv_val = np.nan
    for i in range(len(close)):
        c = close.iloc[i]
        mh = ma_high.iloc[i]
        ml = ma_low.iloc[i]
        if c > mh:
            hlv_val = 1
        elif c < ml:
            hlv_val = -1
        hlv.iloc[i] = hlv_val

    ssl_up = np.where(hlv < 0, ma_low, ma_high)
    ssl_down = np.where(hlv < 0, ma_high, ma_low)
    return (hlv,
            pd.Series(ssl_up, index=close.index),
            pd.Series(ssl_down, index=close.index),
            ma_high,
            ma_low)


def _ema(series: pd.Series, length: int) -> pd.Series:
    """
    严格模拟 Pine Script ta.ema（与 _rma 同构，只是 alpha 不同）：
    - 前 length-1 根返回 NaN
    - 第 length 根用简单均值（SMA）作为锚点
    - 之后用 alpha=2/(length+1) 的指数平滑
    pandas ewm(adjust=False) 直接拿首值起步，裁剪数据后预热路径与 Pine 分叉。
    """
    alpha = 2.0 / (length + 1.0)
    result = np.full(len(series), np.nan)
    vals = series.values.astype(float)
    start = length - 1
    while start < len(vals) and np.isnan(vals[start - length + 1 : start + 1]).any():
        start += 1
    if start >= len(vals):
        return pd.Series(result, index=series.index)
    result[start] = np.nanmean(vals[start - length + 1 : start + 1])
    for j in range(start + 1, len(vals)):
        if np.isnan(vals[j]):
            result[j] = np.nan
        else:
            result[j] = alpha * vals[j] + (1 - alpha) * result[j - 1]
    return pd.Series(result, index=series.index)


def _macd(close, fast, slow, signal):
    """对齐 Pine ta.macd：内部三条线全部使用 Pine 口径的 ta.ema。"""
    macd_line = _ema(close, fast) - _ema(close, slow)
    signal_line = _ema(macd_line, signal)
    return macd_line, signal_line


def _obv_osc(close, volume, length):
    chg = close.diff()
    obv_raw = np.where(chg > 0, volume, np.where(chg < 0, -volume, 0))
    obv = pd.Series(obv_raw, index=close.index).cumsum()
    osc = obv - _ema(obv, length)
    return osc


def _bool_param(value, default=False):
    """从 JSON/表单字段传入的布尔参数安全解析。"""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


# ── 主策略函数 ────────────────────────────────────────────────────────────────

def execute(df, parameters):
    # ── 参数读取 ────────────────────────────────────────────────────────────────
    p = parameters
    system1_period       = int(p.get("system1_period", 55))
    system2_period       = int(p.get("system2_period", 144))
    ma1_length           = int(p.get("ma1_length", 144))
    ma3_length           = int(p.get("ma3_length", 576))
    macd_fast            = int(p.get("macd_fast", 13))
    macd_slow            = int(p.get("macd_slow", 21))
    macd_signal_period   = int(p.get("macd_signal", 8))
    obv_length           = int(p.get("obv_length", 13))
    base_risk_percent    = float(p.get("base_risk_percent", 4.0))
    # 前端表单字段名为 initial_capital，此处兼容两种写法（否则页面设置的本金不生效）
    init_cash            = float(p.get("init_cash", p.get("initial_capital", 27000)))
    fees                 = float(p.get("fees", 0.001))          # Pine commission_value=0.1%
    use_real_capital     = _bool_param(p.get("use_real_capital"), True)
    real_capital         = float(p.get("real_capital", 27000))
    qty_step             = float(p.get("qty_step", 0.001))
    min_qty              = float(p.get("min_qty", 0.001))
    # 滑点两种口径，二选一：
    #   slippage_pct  —— 按成交价百分比计（跨品种通用，换标的不用改）
    #   slippage_ticks × tick_size —— 固定绝对值（Pine slippage=50 的复刻，仅适配 OKX BTC）
    # 不传 slippage_pct 时沿用 ticks 口径，保证已有 BTC 回测结果不变。
    slippage_pct         = p.get("slippage_pct", None)
    slippage_pct         = float(slippage_pct) if slippage_pct is not None else None
    slippage_ticks       = float(p.get("slippage_ticks", 50))   # Pine slippage=50
    tick_size            = float(p.get("tick_size", 0.1))
    atr_period           = system1_period
    # 固定滑点口径的合理性校验：滑点超过最低价的 1% 说明 tick_size 与标的不匹配。
    # 放任不管会得到"看起来能跑、其实全错"的回测结果，所以这里直接拦下并给出改法。
    if slippage_pct is None and len(df) > 0:
        try:
            _lo_px = float(pd.Series(df["low"]).min())
        except Exception:
            _lo_px = 0.0   # 列名异常时不拦截，交由后续正常流程报错
        _abs_slip = slippage_ticks * tick_size
        if _lo_px > 0 and _abs_slip > _lo_px * 0.01:
            raise ValueError(
                "固定滑点 %.6f（slippage_ticks=%g × tick_size=%g）达到标的最低价 %.6f 的 %.1f%%，"
                "该 tick_size 是按 OKX BTC 校准的，不适用于本标的。"
                "请改用百分比口径 slippage_pct（BTC 的等价值约 0.0125），"
                "或传入本标的真实的 tick_size。"
                % (_abs_slip, slippage_ticks, tick_size, _lo_px, 100 * _abs_slip / _lo_px))
    atr_mult_init        = float(p.get("atr_mult_init", 2.0))
    atr_mult_long_trail  = float(p.get("atr_mult_long_trail", 11.0))
    atr_mult_short_trail = float(p.get("atr_mult_short_trail", 3.0))
    profit_atr_mult_long = float(p.get("profit_atr_mult_long", 4.0))
    profit_atr_mult_short= float(p.get("profit_atr_mult_short", 5.0))
    enable_trailing      = _bool_param(p.get("enable_trailing_stop"), True)
    use_breakeven        = _bool_param(p.get("use_breakeven"), True)
    enable_regime        = _bool_param(p.get("enable_regime_filter"), True)
    enable_obv           = _bool_param(p.get("enable_obv_filter"), False)
    use_dual_system      = _bool_param(p.get("use_dual_system"), False)
    use_s1_filter        = _bool_param(p.get("use_s1_filter"), True)
    pyramid_enable       = _bool_param(p.get("pyramid_enable"), True)
    pyramid_max_long     = int(p.get("pyramid_max_count_long", 1))
    pyramid_max_short    = int(p.get("pyramid_max_count_short", 0))
    # 加仓统一按 P7 形态：绝对倍数，与底仓形态无关（对齐 Pine mult_p7）
    # 兼容旧参数名 pyramid_mult_u2：仅在未传 mult_p7 时作为相对倍数回退
    _mult_p7_raw         = p.get("mult_p7", None)
    mult_p7              = float(_mult_p7_raw) if _mult_p7_raw is not None else 1.0
    pyramid_mult         = float(p.get("pyramid_mult_u2", 0.5))
    # 熊转牛：P6 试探做多（对齐 Pine enable_p6_bull_switch）
    enable_p6_bull_switch= _bool_param(p.get("enable_p6_bull_switch"), True)
    p6_bull_bear_days    = int(p.get("p6_bull_bear_days", 180))
    # 起始牛熊状态：'牛市' / '熊市'（对齐 Pine initial_regime）
    initial_regime       = str(p.get("initial_regime", "熊市"))
    realtime_stop_pct    = float(p.get("realtime_stop_percent", 4.0))
    enable_rt_stop       = _bool_param(p.get("enable_realtime_stop"), True)
    enable_p1_switch_exit= _bool_param(p.get("enable_p1_switch_exit"), True)
    enable_p4_switch_exit= _bool_param(p.get("enable_p4_switch_exit"), True)
    # 形态切换平仓的最短持仓天数（对齐 Pine switch_exit_min_days）：
    # 底仓入场未满该天数时形态切换不平仓；ATR止损/价格止损/通道平仓不受此限。0=关闭
    switch_exit_min_days = int(p.get("switch_exit_min_days", 1))
    # 通道反向突破平仓（对齐 Pine enable_channel_exit）
    enable_channel_exit  = _bool_param(p.get("enable_channel_exit"), True)
    channel_exit_source  = str(p.get("channel_exit_source", "系统2(长周期)"))
    channel_exit_long    = _bool_param(p.get("channel_exit_long"), True)
    channel_exit_short   = _bool_param(p.get("channel_exit_short"), True)
    ce_use_s1            = channel_exit_source == "系统1(短周期)"
    # 固定数量模式（传入 fixed_qty=1 时跳过风险计算，每笔固定 1 单位，用于与 TV 对比）
    fixed_qty            = p.get("fixed_qty", None)
    if fixed_qty is not None:
        fixed_qty = float(fixed_qty)
    # start_date = 入场窗口起点（对齐 TV 的 Live Start Time，只过滤入场信号）。
    # 对齐 Pine：enable_time_filter 默认 true、start_time 默认 2022-01-01。
    start_date           = p.get("start_date", None)
    if not _bool_param(p.get("enable_time_filter"), True):
        start_date = None
    elif start_date is None:
        start_date = "2022-01-01 00:00:00"
    # data_start_date = 数据起点裁剪（对齐 TV 图表第一根 K 线，使 RMA/hlv 等无限记忆指标预热路径一致）
    data_start_date      = p.get("data_start_date", "2022-01-01")
    # 与 TurtleClassicStrategy / TurtleAtrTrailStrategy 共享参数（Dual 不使用，仅接收）
    _atr_period_ignored  = p.get("atr_period", None)   # Dual 用 system1_period 作为 ATR 周期
    _max_units_ignored   = p.get("max_units", None)     # Dual 用 pyramid 代替海龟分批加仓
    _unit_add_atr_ignored= p.get("unit_add_atr", None)
    _use_long_ignored    = p.get("use_long", None)      # Dual 由形态/过滤器决定方向
    _use_short_ignored   = p.get("use_short", None)

    # 形态仓位倍数（本策略全部 1.0，无差异化仓位管理；对齐 Pine 20260921 的默认值）
    mult = {
        (1, True) : float(p.get("mult_p1_l", 1.0)),
        (2, True) : float(p.get("mult_p2_l", 1.0)),
        (3, True) : float(p.get("mult_p3_l", 1.0)),
        (4, False): float(p.get("mult_p4_s", 1.0)),
        (5, True) : float(p.get("mult_p5_l", 1.0)),
        (5, False): float(p.get("mult_p5_s", 1.0)),
        (6, True) : float(p.get("mult_p6_l", 1.0)),
        (6, False): float(p.get("mult_p6_s", 1.0)),
    }

    # ── 数据起点裁剪（对齐 TV 图表第一根 K 线）────────────────────────────────
    if data_start_date is not None:
        df = df[df.index >= pd.Timestamp(data_start_date)]
        if df.empty:
            raise ValueError(f"data_start_date={data_start_date} 之后没有数据。")

    # ── 入场时间闸门（对齐 TV：指标/状态机用全部历史计算，start_date 只过滤入场）──
    # 注意不能用 start_date 裁剪 df：裁剪会让 576 周期 RMA 等指标重新预热约 96 天，
    # 导致 start_date 后约 4 个月无信号，与 Pine（指标算全图、时间窗只挡入场）分叉。
    start_ts = None
    if start_date is not None:
        start_ts = pd.Timestamp(start_date)
        if df[df.index >= start_ts].empty:
            raise ValueError(f"start_date={start_date} 之后没有数据，请检查时间格式或数据范围。")

    # ── 指标计算 ────────────────────────────────────────────────────────────────
    high   = df["high"]
    low    = df["low"]
    close  = df["close"]
    open_  = df["open"]
    volume = df["volume"]
    n      = len(df)

    # ATR
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low  - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    atr = _rma(tr, atr_period)

    # SSL 通道
    hlv1, ssl_up1, ssl_down1, _ma1, _ma2 = _ssl_channel(high, low, close, ma1_length)
    hlv2, ssl_up2, ssl_down2, _ma3, _ma4 = _ssl_channel(high, low, close, ma3_length)

    # MACD
    macd_line, macd_sig = _macd(close, macd_fast, macd_slow, macd_signal_period)
    macd_golden = (macd_line > macd_sig) & (macd_line.shift(1) <= macd_sig.shift(1))
    macd_death  = (macd_line < macd_sig) & (macd_line.shift(1) >= macd_sig.shift(1))

    # OBV 振荡器
    obv_osc = _obv_osc(close, volume, obv_length)

    # 双系统唐奇安通道（偏移1，Pine 里 [1] 表示前一根）
    s1_high = high.rolling(system1_period).max().shift(1)
    s1_low  = low.rolling(system1_period).min().shift(1)
    s2_high = high.rolling(system2_period).max().shift(1)
    s2_low  = low.rolling(system2_period).min().shift(1)

    # 通道大小关系（c1 vs c2）
    # 必须用原始 RMA 高/低通道比较，对齐 Pine:
    #   c1_gt_c2 = ma1 > ma3 and ma2 > ma4
    # 不能用 ssl_up/ssl_down —— 那两条已按 hlv 正负互换过，当 hlv1 与 hlv2 符号相反时
    # 比较的是 (ma2>ma3 and ma1>ma4) 这种错位组合，与 Pine 不等价。
    # _ma1~_ma4 由上方 _ssl_channel 一并返回，此处直接复用，不重复算 RMA。
    c1_gt_c2 = (_ma1 > _ma3) & (_ma2 > _ma4)
    c1_lt_c2 = (_ma1 < _ma3) & (_ma2 < _ma4)

    # ── 逐K线状态机 ─────────────────────────────────────────────────────────────
    order_times, order_prices, order_sizes, order_dirs = [], [], [], []

    _strategy_trades   = []
    # 当前持仓内所有未平仓"腿"（首入 + N 次加仓），平仓时每条独立结算 PnL
    # 每条 leg 结构：{'entry_ts', 'entry_px', 'qty', 'signal'}
    _open_legs         = []
    _base_pnl_box      = [0.0]   # _close_legs 写入底仓 PnL（对齐 Pine base_trade_profit）

    pos = 0.0
    pos_avg = 0.0
    cash = init_cash

    # 起始牛熊状态（对齐 Pine：置位发生在 start_date 那一根，见主循环）
    bull = initial_regime != "熊市"
    bear = initial_regime == "熊市"
    p6_locked = False
    regime_test = None
    # 熊转牛状态
    regime_initialized = False
    bear_start_ts = None        # 进入熊市的时间戳
    p6_trial_done = False       # 同一段 P6 形态内只试探一次，形态离开 P6 即重置

    s1_last_failed = False
    entry_system = None
    entry_pattern = 0
    entry_atr_val = 0.0
    entry_price_first = 0.0
    entry_mult_val = 1.0
    entry_time_ts = None        # 底仓入场时间戳，用于形态切换平仓的最短持仓天数判定

    long_stop = np.nan
    long_trail = False
    long_trail_just = False
    short_stop = np.nan
    short_trail = False
    short_trail_just = False

    pyramid_long_cnt = 0
    pyramid_short_cnt = 0

    p2_ready = False
    p3_ready = False
    p5_ready = False
    p6_ready = False
    has_p1 = False
    has_p4 = False

    cur_pat = 0   # 0 = 形态未定：MA 预热期六个条件全不成立，初值为 1 会让开局凭空显示成 P1

    # 加仓 pending：避免当根K线用 next_open 更新 pos_avg 后立刻影响同根止损判断（未来函数漏洞）
    _pending_add_qty_long  = 0.0
    _pending_add_qty_short = 0.0
    _pending_add_px_long   = 0.0
    _pending_add_px_short  = 0.0
    # Price SL 挂单基准：TV 的 strategy.exit 是上一根收盘提交的，盘中监控价位用
    # 上一根收盘时的均价；加仓当根盘中仍挂旧均价的止损单，下一根才换新均价
    prev_avg = 0.0
    # 进场成交根（fill bar）：TV 在该根收盘才提交 Price SL 挂单且不更新追踪止损
    entry_fill_i = -1

    def _calc_qty(atr_v, m, equity):
        """仓位计算。equity 对齐 TV strategy.equity（已实现 + 未实现浮盈），
        入场时无持仓 equity=cash，加仓时必须加上当前浮盈，否则加仓单偏小。"""
        if fixed_qty is not None:
            return fixed_qty
        account_equity = real_capital if use_real_capital else equity
        risk_amt = account_equity * base_risk_percent / 100 * m
        stop_dist = max(atr_v * atr_mult_init, 0.01)
        raw = risk_amt / stop_dist
        q = np.floor(raw / qty_step + 1e-9) * qty_step
        q = round(float(q), 6)
        return 0.0 if q < min_qty else q

    def _record(idx_val, px, size, direction, slip=True):
        """记录订单并返回含滑点成交价。TV 的 position_avg_price / 清单价格 /
        Price SL 成交价全部含滑点，后续均价、止损、PnL 都必须用返回的 fill 价。"""
        if not slip:
            s = 0.0
        elif slippage_pct is not None:
            s = abs(px) * slippage_pct / 100.0
        else:
            s = slippage_ticks * tick_size
        fill_px = px + s if direction == 1 else px - s
        if fill_px <= 0:
            raise ValueError(
                "滑点把成交价算成了非正数（基准价 %.6f，滑点 %.6f）。"
                "固定滑点 slippage_ticks×tick_size=%.6f 是按 OKX BTC 校准的，"
                "换到低价标的会失真。请改用百分比口径，例如 slippage_pct=0.0125。"
                % (px, s, slippage_ticks * tick_size))
        order_times.append(idx_val)
        order_prices.append(fill_px)
        order_sizes.append(abs(size))
        order_dirs.append(direction)
        return fill_px

    def _close_legs(direction_str, exit_ts, exit_px, exit_signal, status='Closed', charge_exit_fee=True):
        """平仓时遍历 _open_legs，每条腿独立结算 PnL 并 append 到 _strategy_trades。
        对齐 TV：每次入场+加仓都是独立 trade，出场共享同一 exit_ts/exit_px/exit_signal。
        entry_px/exit_px 均为含滑点成交价，PnL 口径与 TV 净损益一致。
        charge_exit_fee=False 用于回测末未平仓强平（TV 对敞口交易不计出场手续费）。
        返回总 PnL，用于更新 cash 和后续过滤器状态。
        """
        total_pnl = 0.0
        _base_pnl_box[0] = 0.0   # 底仓那一笔的 PnL，供 P6 试探转牛裁决（加仓不计入）
        for _leg_i, leg in enumerate(_open_legs):
            ep = float(leg['entry_px']); ex = float(exit_px); q = float(leg['qty'])
            if direction_str == 'Long':
                gross = (ex - ep) * q
                ret   = (ex - ep) / ep if ep else 0
            else:
                gross = (ep - ex) * q
                ret   = (ep - ex) / ep if ep else 0
            leg_fees = (ep * q * fees) + (ex * q * fees if charge_exit_fee else 0.0)
            pnl = gross - leg_fees
            total_pnl += pnl
            if _leg_i == 0:
                _base_pnl_box[0] = pnl
            _strategy_trades.append({
                'Entry Timestamp': str(leg['entry_ts']),
                'Exit Timestamp':  str(exit_ts),
                'Avg Entry Price': round(float(ep), 2),
                'Avg Exit Price':  round(float(ex), 2),
                'Direction':       direction_str,
                'Size':            round(float(q), 6),
                'PnL':             round(float(pnl), 2),
                'Return':          round(float(ret), 6),
                'Status':          status,
                'Signal':          leg['signal'],
                'ExitSignal':      exit_signal,
            })
        return total_pnl

    idx = df.index

    # 循环到 n-2，保证 i+1 合法（入场/出场在下一根开盘成交）
    bankrupt = False  # 爆仓标志
    for i in range(1, n - 1):
        cl    = close.iloc[i]
        hi    = high.iloc[i]
        lo    = low.iloc[i]
        atr_v = atr.iloc[i]
        # 下一根开盘价和时间戳，模拟 TV strategy.entry 在下一根 bar 开盘成交
        next_open = open_.iloc[i + 1]
        next_ts   = idx[i + 1]

        if np.isnan(atr_v) or atr_v <= 0:
            continue

        # 爆仓检测：用本K线最坏浮亏计算实时净值，<=0 则强制平仓并终止
        if pos > 0:
            current_equity = cash + (lo - pos_avg) * pos   # 多头最坏：最低价
        elif pos < 0:
            current_equity = cash + (pos_avg - hi) * abs(pos)  # 空头最坏：最高价
        else:
            current_equity = cash
        if current_equity <= 0 and not bankrupt:
            bankrupt = True
            if pos > 0:
                fill = _record(idx[i], cl, pos, -1)
                cash += _close_legs('Long', idx[i], fill, 'Liquidation', status='Liquidated')
            elif pos < 0:
                fill = _record(idx[i], cl, abs(pos), 1)
                cash += _close_legs('Short', idx[i], fill, 'Liquidation', status='Liquidated')
            pos = 0.0; pos_avg = 0.0; cash = 0.0
            _open_legs = []
            entry_time_ts = None
            break

        h1 = hlv1.iloc[i]
        h2 = hlv2.iloc[i]
        gt = c1_gt_c2.iloc[i]
        lt = c1_lt_c2.iloc[i]

        # 更新形态
        if   h1 == 1  and h2 == 1  and gt: cur_pat = 1
        elif h1 == -1 and h2 == 1  and gt: cur_pat = 2
        elif h1 == -1 and h2 == -1 and gt: cur_pat = 3
        elif h1 == -1 and h2 == -1 and lt: cur_pat = 4
        elif h1 == 1  and h2 == -1 and lt: cur_pat = 5
        elif h1 == 1  and h2 == 1  and lt: cur_pat = 6

        # 牛熊过滤（对齐 Pine）：这里只做起点强制置位。
        # 熊→牛的两条路径都要求"真正开出多单"，不再有凭形态或通道排列的自动切换：
        #   路径①：熊市中 P1 形态开出突破多单 → 当场转牛（见「做多入场」）
        #   路径②：熊市满设定天数后 P6 开出试探多单，且该单底仓盈利平仓 → 转牛（见各平仓出口）
        if enable_regime:
            _ts = idx[i]
            _start_ok = (start_ts is None) or (_ts >= start_ts)
            if (not regime_initialized) and _start_ok:
                regime_initialized = True
                bull = initial_regime != "熊市"
                bear = initial_regime == "熊市"
                p6_locked = False
                regime_test = None
                bear_start_ts = _ts if bear else None

        # P6 试探做多：同一段 P6 形态内只试探一次，形态离开 P6 即重置（对齐 Pine p6_trial_done）
        if cur_pat != 6:
            p6_trial_done = False

        # P6做空锁定解锁
        if p6_locked and cur_pat == 4:
            p6_locked = False

        # OBV 过滤
        obv_v = obv_osc.iloc[i]
        obv_long_ok  = (not enable_obv) or (obv_v > 0)
        obv_short_ok = (not enable_obv) or (obv_v < 0)

        # S1/S2 突破
        s1h = s1_high.iloc[i]; s1l = s1_low.iloc[i]
        s2h = s2_high.iloc[i]; s2l = s2_low.iloc[i]
        s1h_prev = s1_high.iloc[i - 1]; s1l_prev = s1_low.iloc[i - 1]
        s2h_prev = s2_high.iloc[i - 1]; s2l_prev = s2_low.iloc[i - 1]
        cl_prev = close.iloc[i - 1]
        s1_bl = use_dual_system and (not np.isnan(s1h)) and (not np.isnan(s1h_prev)) and cl > s1h and cl_prev <= s1h_prev
        s1_bs = use_dual_system and (not np.isnan(s1l)) and (not np.isnan(s1l_prev)) and cl < s1l and cl_prev >= s1l_prev
        s2_bl = (not np.isnan(s2h)) and (not np.isnan(s2h_prev)) and cl > s2h and cl_prev <= s2h_prev
        s2_bs = (not np.isnan(s2l)) and (not np.isnan(s2l_prev)) and cl < s2l and cl_prev >= s2l_prev

        if use_s1_filter and s1_last_failed:
            s1_bl = False; s1_bs = False

        mg = macd_golden.iloc[i]
        md = macd_death.iloc[i]

        # MACD 就绪更新
        if cur_pat not in (2, 3): p2_ready = False; p3_ready = False
        if cur_pat in (2, 3) and (not np.isnan(s2l)) and cl < s2l:
            p2_ready = True; p3_ready = True
        if cur_pat not in (5, 6): p5_ready = False; p6_ready = False
        if cur_pat in (5, 6) and s2_bl:
            p5_ready = True; p6_ready = True

        # Price SL 挂单基准：先记录上一根收盘时的均价，再做加仓 pending 更新
        prev_avg = pos_avg
        # 上一根K线 pending 的加仓，在本根K线开盘后正式更新均价（避免未来函数）
        if _pending_add_qty_long > 0 and pos > 0:
            pos_avg = (pos_avg * (pos - _pending_add_qty_long) + _pending_add_px_long * _pending_add_qty_long) / pos
            if use_breakeven:
                long_stop = max(long_stop, pos_avg)
            _pending_add_qty_long = 0.0
        if _pending_add_qty_short > 0 and pos < 0:
            pos_avg = (pos_avg * (abs(pos) - _pending_add_qty_short) + _pending_add_px_short * _pending_add_qty_short) / abs(pos)
            _pending_add_qty_short = 0.0
        # 注：旧版有 _trade_total_qty/_trade_entry_price 全局聚合，新版改为 _open_legs，
        # 每条腿在 _close_legs 内独立结算，无需全局更新

        # ── 当前持多 ──────────────────────────────────────────────────────
        if pos > 0:
            if cur_pat == 1: has_p1 = True
            # 最短持仓天数闸门（对齐 Pine switch_exit_aged）：底仓入场未满设定天数时
            # 形态切换不平仓；ATR止损、价格止损、通道平仓不受此限
            _switch_aged = (
                (entry_time_ts is not None)
                and ((idx[i] - entry_time_ts).total_seconds() >= switch_exit_min_days * 86400)
            )
            exit_pat = enable_p1_switch_exit and has_p1 and cur_pat != 1 and _switch_aged
            # 通道反向突破平多：收盘跌破最低价下轨（对齐 Pine exit_long_channel）
            _ce_low = s1l if ce_use_s1 else s2l
            exit_chan = enable_channel_exit and channel_exit_long and \
                        (not np.isnan(_ce_low)) and cl < _ce_low
            is_fill_bar = (i == entry_fill_i)

            # Price SL：TV 的 strategy.exit 在上一根收盘提交，本根盘中按
            # prev_avg 基准价位监控；进场成交根挂单尚未提交，不触发。
            # 盘中触发先于一切收盘判断（exit_pat/ATR 止损都是下根开盘才成交）。
            rt_stop_long = prev_avg * (1 - realtime_stop_pct / 100)
            hit_rt_sl = enable_rt_stop and (not is_fill_bar) and lo <= rt_stop_long
            if hit_rt_sl:
                # 开盘已低于止损价则按开盘价成交（gap），成交价再减滑点
                fill = _record(idx[i], min(open_.iloc[i], rt_stop_long), pos, -1)
                pnl = _close_legs('Long', idx[i], fill, 'Price SL')
                cash += pnl
                if entry_system == 'S1' and use_s1_filter:
                    s1_last_failed = pnl <= 0
                if entry_system == 'S2' and pnl > 0:
                    s1_last_failed = False
                if enable_regime and regime_test is not None:
                    if regime_test == 'P4_bear_test':
                        if pnl > 0 or entry_system == 'S2':
                            bull = False; bear = True
                            # 熊市计时从进入熊市这一刻起算（对齐 Pine）
                            bear_start_ts = idx[i]
                    elif regime_test == 'P6_bull_test':
                        # 熊→牛路径②：只认底仓那一笔盈亏，加仓单不参与裁决（对齐 Pine base_trade_profit）
                        if _base_pnl_box[0] > 0:
                            bull = True; bear = False
                            p6_locked = False; bear_start_ts = None
                    regime_test = None
                pos = 0.0; pos_avg = 0.0
                long_stop = np.nan; long_trail = False; long_trail_just = False
                entry_pattern = 0; entry_system = None
                has_p1 = False; has_p4 = False
                # TV 的 position_closed 清全部 4 个 ready 标志，且清理发生在 ready
                # 更新段之前——盘中出场当根若再次满足 ready 条件要立即重新置位
                p2_ready = False; p3_ready = False; p5_ready = False; p6_ready = False
                if cur_pat in (2, 3) and (not np.isnan(s2l)) and cl < s2l:
                    p2_ready = True; p3_ready = True
                if cur_pat in (5, 6) and s2_bl:
                    p5_ready = True; p6_ready = True
                pyramid_long_cnt = 0; _pending_add_qty_long = 0.0
                _open_legs = []
                entry_time_ts = None
                # 不 continue：TV 中本根收盘已无持仓，可立即生成新入场信号
            else:
                # ATR 追踪止损更新（TV 在进场成交根只设初始止损，下一根才开始追踪）
                if not is_fill_bar:
                    profit_long = hi - pos_avg
                    if enable_trailing:
                        if not long_trail and profit_long >= atr_v * profit_atr_mult_long:
                            long_trail = True; long_trail_just = True
                            calc = hi - atr_v * atr_mult_long_trail
                            long_stop = max(pos_avg, calc) if use_breakeven else calc
                        if long_trail and not long_trail_just:
                            new_s = cl - atr_v * atr_mult_long_trail
                            long_stop = max(long_stop, new_s)

                    # 加仓（追踪激活于本K线，加仓单下一根开盘成交；均价 pending 避免未来函数）
                    if pyramid_enable and pyramid_max_long > 0 and pyramid_long_cnt < pyramid_max_long and long_trail_just:
                        equity_now = cash + (cl - pos_avg) * pos
                        if mult_p7 is not None:
                            # P7 统一算法：绝对倍数一步算出，与底仓形态无关（对齐 Pine）
                            add_q = _calc_qty(atr_v, mult_p7, equity_now)
                        else:
                            base_q = _calc_qty(atr_v, entry_mult_val, equity_now)
                            add_q = round(base_q * pyramid_mult // 0.001 * 0.001, 6)
                        if add_q >= 0.001:
                            pyramid_long_cnt += 1
                            fill = _record(next_ts, next_open, add_q, 1)
                            pos += add_q
                            _pending_add_qty_long = add_q
                            _pending_add_px_long = fill
                            _open_legs.append({
                                'entry_ts': next_ts,
                                'entry_px': fill,
                                'qty':      add_q,
                                'signal':   f"Scale-in Long {pyramid_long_cnt}",
                            })

                    # 加仓后追踪止损常规上移（use_breakeven 分支的均价在下一根才更新，此处只处理非保本分支；
                    # TV 在激活当根跳过此块）
                    if pyramid_long_cnt > 0 and long_trail and not long_trail_just and not use_breakeven:
                        new_s = max(cl - atr_v * atr_mult_long_trail, entry_price_first)
                        long_stop = max(long_stop, new_s)

                # 收盘止损判断（TV 用 strategy.close_all()，在下一根开盘成交；
                # 追踪激活当根不判断追踪止损，标志在本根末尾才重置）
                hit_init_sl  = (not long_trail) and (not np.isnan(long_stop)) and cl < long_stop
                hit_trail_sl = long_trail and (not long_trail_just) and (not np.isnan(long_stop)) and cl < long_stop
                long_trail_just = False
                if exit_pat or exit_chan or hit_init_sl or hit_trail_sl:
                    if exit_pat:
                        exit_signal = 'P1 Pattern Switch Exit Long'
                    elif exit_chan:
                        exit_signal = 'Channel Exit Long'
                    elif hit_trail_sl:
                        exit_signal = 'Trailing SL'
                    else:
                        exit_signal = 'ATR SL'
                    fill = _record(next_ts, next_open, pos, -1)
                    pnl = _close_legs('Long', next_ts, fill, exit_signal)
                    cash += pnl
                    if entry_system == 'S1' and use_s1_filter:
                        s1_last_failed = pnl <= 0
                    if entry_system == 'S2' and pnl > 0:
                        s1_last_failed = False
                    if enable_regime and regime_test is not None:
                        if regime_test == 'P4_bear_test':
                            if pnl > 0 or entry_system == 'S2':
                                bull = False; bear = True
                                # 熊市计时从进入熊市这一刻起算（对齐 Pine）
                                bear_start_ts = idx[i]
                        elif regime_test == 'P6_bull_test':
                            # 熊→牛路径②：只认底仓那一笔盈亏，加仓单不参与裁决（对齐 Pine base_trade_profit）
                            if _base_pnl_box[0] > 0:
                                bull = True; bear = False
                                p6_locked = False; bear_start_ts = None
                        regime_test = None
                    pos = 0.0; pos_avg = 0.0
                    long_stop = np.nan; long_trail = False; long_trail_just = False
                    entry_pattern = 0; entry_system = None
                    has_p1 = False; has_p4 = False
                    # TV position_closed 清全部 4 个 ready；下根循环开头会按条件重演
                    p2_ready = False; p3_ready = False; p5_ready = False; p6_ready = False
                    pyramid_long_cnt = 0; _pending_add_qty_long = 0.0
                    _open_legs = []
                    entry_time_ts = None
                    continue

        # ── 当前持空 ──────────────────────────────────────────────────────
        elif pos < 0:
            if cur_pat == 4: has_p4 = True
            _switch_aged = (
                (entry_time_ts is not None)
                and ((idx[i] - entry_time_ts).total_seconds() >= switch_exit_min_days * 86400)
            )
            exit_pat = enable_p4_switch_exit and has_p4 and cur_pat != 4 and _switch_aged
            # 通道反向突破平空：收盘升破最高价上轨（对齐 Pine exit_short_channel）
            _ce_high = s1h if ce_use_s1 else s2h
            exit_chan = enable_channel_exit and channel_exit_short and \
                        (not np.isnan(_ce_high)) and cl > _ce_high
            is_fill_bar = (i == entry_fill_i)

            # Price SL：同多头，prev_avg 基准、进场成交根不触发、盘中优先
            rt_stop_short = prev_avg * (1 + realtime_stop_pct / 100)
            hit_rt_sl = enable_rt_stop and (not is_fill_bar) and hi >= rt_stop_short
            if hit_rt_sl:
                fill = _record(idx[i], max(open_.iloc[i], rt_stop_short), abs(pos), 1)
                pnl = _close_legs('Short', idx[i], fill, 'Price SL')
                cash += pnl
                if entry_system == 'S1' and use_s1_filter:
                    s1_last_failed = pnl <= 0
                if entry_system == 'S2' and pnl > 0:
                    s1_last_failed = False
                if enable_regime and regime_test is not None:
                    if regime_test == 'P4_bear_test':
                        if pnl > 0 or entry_system == 'S2':
                            bull = False; bear = True
                            # 熊市计时从进入熊市这一刻起算（对齐 Pine）
                            bear_start_ts = idx[i]
                    elif regime_test == 'P6_bull_test':
                        # 熊→牛路径②：只认底仓那一笔盈亏，加仓单不参与裁决（对齐 Pine base_trade_profit）
                        if _base_pnl_box[0] > 0:
                            bull = True; bear = False
                            p6_locked = False; bear_start_ts = None
                    regime_test = None
                if bear and entry_pattern in (5, 6) and pnl <= 0:
                    p6_locked = True
                pos = 0.0; pos_avg = 0.0
                short_stop = np.nan; short_trail = False; short_trail_just = False
                entry_pattern = 0; entry_system = None
                has_p1 = False; has_p4 = False
                # 同多头：全清 4 个 ready 并按本根条件重演（TV 清理在 ready 更新段之前）
                p2_ready = False; p3_ready = False; p5_ready = False; p6_ready = False
                if cur_pat in (2, 3) and (not np.isnan(s2l)) and cl < s2l:
                    p2_ready = True; p3_ready = True
                if cur_pat in (5, 6) and s2_bl:
                    p5_ready = True; p6_ready = True
                pyramid_short_cnt = 0; _pending_add_qty_short = 0.0
                _open_legs = []
                entry_time_ts = None
                # 不 continue：本根收盘可立即生成新入场信号
            else:
                if not is_fill_bar:
                    profit_short = pos_avg - lo
                    if enable_trailing:
                        if not short_trail and profit_short >= atr_v * profit_atr_mult_short:
                            short_trail = True; short_trail_just = True
                            calc = lo + atr_v * atr_mult_short_trail
                            short_stop = min(pos_avg, calc) if use_breakeven else calc
                        if short_trail and not short_trail_just:
                            new_s = cl + atr_v * atr_mult_short_trail
                            short_stop = min(short_stop, new_s)

                    # 加仓（空头，均价 pending 避免未来函数）
                    if pyramid_enable and pyramid_max_short > 0 and pyramid_short_cnt < pyramid_max_short and short_trail_just:
                        equity_now = cash + (pos_avg - cl) * abs(pos)
                        if mult_p7 is not None:
                            # 与多头加仓同一套算法（对齐 Pine）
                            add_q = _calc_qty(atr_v, mult_p7, equity_now)
                        else:
                            base_q = _calc_qty(atr_v, entry_mult_val, equity_now)
                            add_q = round(base_q * pyramid_mult // 0.001 * 0.001, 6)
                        if add_q >= 0.001:
                            pyramid_short_cnt += 1
                            fill = _record(next_ts, next_open, add_q, -1)
                            pos -= add_q
                            _pending_add_qty_short = add_q
                            _pending_add_px_short = fill
                            _open_legs.append({
                                'entry_ts': next_ts,
                                'entry_px': fill,
                                'qty':      add_q,
                                'signal':   f"Scale-in Short {pyramid_short_cnt}",
                            })

                    if pyramid_short_cnt > 0 and short_trail and not short_trail_just and not use_breakeven:
                        new_s = min(cl + atr_v * atr_mult_short_trail, entry_price_first)
                        short_stop = min(short_stop, new_s)

                hit_init_sl  = (not short_trail) and (not np.isnan(short_stop)) and cl > short_stop
                hit_trail_sl = short_trail and (not short_trail_just) and (not np.isnan(short_stop)) and cl > short_stop
                short_trail_just = False
                if exit_pat or exit_chan or hit_init_sl or hit_trail_sl:
                    if exit_pat:
                        exit_signal = 'P4 Pattern Switch Exit Short'
                    elif exit_chan:
                        exit_signal = 'Channel Exit Short'
                    elif hit_trail_sl:
                        exit_signal = 'Trailing SL'
                    else:
                        exit_signal = 'ATR SL'
                    fill = _record(next_ts, next_open, abs(pos), 1)
                    pnl = _close_legs('Short', next_ts, fill, exit_signal)
                    cash += pnl
                    if entry_system == 'S1' and use_s1_filter:
                        s1_last_failed = pnl <= 0
                    if entry_system == 'S2' and pnl > 0:
                        s1_last_failed = False
                    if enable_regime and regime_test is not None:
                        if regime_test == 'P4_bear_test':
                            if pnl > 0 or entry_system == 'S2':
                                bull = False; bear = True
                                # 熊市计时从进入熊市这一刻起算（对齐 Pine）
                                bear_start_ts = idx[i]
                        elif regime_test == 'P6_bull_test':
                            # 熊→牛路径②：只认底仓那一笔盈亏，加仓单不参与裁决（对齐 Pine base_trade_profit）
                            if _base_pnl_box[0] > 0:
                                bull = True; bear = False
                                p6_locked = False; bear_start_ts = None
                        regime_test = None
                    if bear and entry_pattern in (5, 6) and pnl <= 0:
                        p6_locked = True
                    pos = 0.0; pos_avg = 0.0
                    short_stop = np.nan; short_trail = False; short_trail_just = False
                    entry_pattern = 0; entry_system = None
                    has_p1 = False; has_p4 = False
                    # TV position_closed 清全部 4 个 ready；下根循环开头会按条件重演
                    p2_ready = False; p3_ready = False; p5_ready = False; p6_ready = False
                    pyramid_short_cnt = 0; _pending_add_qty_short = 0.0
                    _open_legs = []
                    entry_time_ts = None
                    continue

        # ── 入场信号（无持仓时） ───────────────────────────────────────────
        if pos == 0.0:
            signal_long = None
            signal_short = None

            if enable_regime:
                if bull:
                    if cur_pat in (1, 5, 6):
                        if s1_bl: signal_long = 'S1'
                        elif s2_bl: signal_long = 'S2'
                    if cur_pat in (2, 3):
                        if (cur_pat == 2 and p2_ready) or (cur_pat == 3 and p3_ready):
                            if mg and signal_long is None: signal_long = 'MACD'
                    if cur_pat == 4:
                        if s1_bs: signal_short = 'S1'
                        elif s2_bs: signal_short = 'S2'
                elif bear:
                    # 熊→牛路径①：P1 形态走上轨突破做多，成交即转牛（对齐 Pine）
                    # 这里用 cl > s2h 的状态判定而非 crossover：均线滞后十余根才翻成 P1，
                    # 要求"突破那一根"和"形态成立那一根"同根会导致永远触发不了
                    if cur_pat == 1:
                        if s1_bl: signal_long = 'S1'
                        elif (not np.isnan(s2h)) and cl > s2h: signal_long = 'S2'
                    # 熊→牛路径②：深熊末期 P6 试探做多，底仓盈利平仓才转牛
                    _p6_trial_unlocked = (
                        enable_p6_bull_switch and (bear_start_ts is not None)
                        and ((idx[i] - bear_start_ts).total_seconds() >= p6_bull_bear_days * 86400)
                    )
                    if _p6_trial_unlocked and cur_pat == 6 and not p6_trial_done:
                        if s1_bl: signal_long = 'S1'
                        elif (not np.isnan(s2h)) and cl > s2h: signal_long = 'S2'
                    if cur_pat == 4:
                        if s1_bs: signal_short = 'S1'
                        elif s2_bs: signal_short = 'S2'
                    # 同根已生成多单信号时做空让位，避免多空对冲下单（对齐 Pine）
                    if cur_pat == 5 and p5_ready and md and not p6_locked:
                        if signal_short is None and signal_long is None: signal_short = 'MACD'
                    if cur_pat == 6 and p6_ready and md and not p6_locked:
                        if signal_short is None and signal_long is None: signal_short = 'MACD'
            else:
                if cur_pat in (1, 5, 6):
                    if s1_bl: signal_long = 'S1'
                    elif s2_bl: signal_long = 'S2'
                if cur_pat in (2, 3):
                    if (cur_pat == 2 and p2_ready) or (cur_pat == 3 and p3_ready):
                        if mg and signal_long is None: signal_long = 'MACD'
                if cur_pat == 4:
                    if s1_bs: signal_short = 'S1'
                    elif s2_bs: signal_short = 'S2'

            if not obv_long_ok:  signal_long = None
            if not obv_short_ok: signal_short = None
            # 实盘时间窗过滤（对齐 Pine in_trade_window：信号K线早于 start_date 不入场）
            if start_ts is not None and idx[i] < start_ts:
                signal_long = None
                signal_short = None

            # 做多入场（TV 在信号K线收盘确认，下一根开盘成交）
            if signal_long:
                m = mult.get((cur_pat, True), 1.0)
                qty = _calc_qty(atr_v, m, cash)
                if qty >= min_qty:
                    fill = _record(next_ts, next_open, qty, 1)
                    pos = qty; pos_avg = fill
                    entry_system = signal_long; entry_pattern = cur_pat
                    entry_atr_val = atr_v; entry_mult_val = m
                    entry_fill_i = i + 1
                    long_stop = fill - atr_v * atr_mult_init
                    long_trail = False; long_trail_just = False
                    has_p1 = (cur_pat == 1)
                    p2_ready = False; p3_ready = False
                    # TV 的 entry_price_first 用信号K线收盘价（仅 use_breakeven=False 时作止损下限）
                    pyramid_long_cnt = 0; entry_price_first = cl
                    _open_legs = [{
                        'entry_ts': next_ts,
                        'entry_px': fill,
                        'qty':      qty,
                        'signal':   f"{signal_long} Long-P{cur_pat}",
                    }]
                    entry_time_ts = next_ts
                    # 牛熊切换只认"真正成交的单"，所以这段放在 qty >= min_qty 之内（对齐 Pine）
                    if enable_regime and bear:
                        if cur_pat == 1:
                            # 熊→牛路径①：P1 突破多单成交 → 当场转牛，不等盈亏
                            bull = True; bear = False
                            p6_locked = False; regime_test = None; bear_start_ts = None
                        elif cur_pat == 6:
                            # 熊→牛路径②：P6 试探多单挂标记，等平仓时按底仓盈亏裁决
                            regime_test = 'P6_bull_test'
                            p6_trial_done = True

            # 做空入场（TV 在信号K线收盘确认，下一根开盘成交）
            elif signal_short:
                m = mult.get((cur_pat, False), 1.0)
                qty = _calc_qty(atr_v, m, cash)
                if qty >= min_qty:
                    fill = _record(next_ts, next_open, qty, -1)
                    pos = -qty; pos_avg = fill
                    entry_system = signal_short; entry_pattern = cur_pat
                    entry_atr_val = atr_v; entry_mult_val = m
                    entry_fill_i = i + 1
                    short_stop = fill + atr_v * atr_mult_init
                    short_trail = False; short_trail_just = False
                    has_p4 = (cur_pat == 4)
                    p5_ready = False; p6_ready = False
                    pyramid_short_cnt = 0; entry_price_first = cl
                    _open_legs = [{
                        'entry_ts': next_ts,
                        'entry_px': fill,
                        'qty':      qty,
                        'signal':   f"{signal_short} Short-P{cur_pat}",
                    }]
                    entry_time_ts = next_ts
                    if enable_regime and bull and cur_pat == 4:
                        regime_test = 'P4_bear_test'

    # 强制平仓（回测结束，用最后一根收盘价；对齐 TV 敞口交易：不加滑点、不扣出场手续费）
    if pos != 0.0 and _open_legs:
        last_i = n - 1
        last_cl = close.iloc[last_i]
        if pos > 0:
            fill = _record(idx[last_i], last_cl, pos, -1, slip=False)
            _close_legs('Long', idx[last_i], fill, 'End of Backtest', status='Open', charge_exit_fee=False)
        else:
            fill = _record(idx[last_i], last_cl, abs(pos), 1, slip=False)
            _close_legs('Short', idx[last_i], fill, 'End of Backtest', status='Open', charge_exit_fee=False)

    # ── 构建 VectorBT 组合 ───────────────────────────────────────────────────
    if not order_times:
        pf = vbt.Portfolio.from_signals(
            close,
            pd.Series(False, index=close.index),
            pd.Series(False, index=close.index),
            init_cash=init_cash, fees=fees,
        )
        return pf, {}

    order_df = pd.DataFrame({
        "timestamp": order_times,
        "price":     order_prices,
        "size":      order_sizes,
        "direction": order_dirs,
    }).set_index("timestamp").sort_index()

    order_size  = pd.Series(0.0, index=close.index)
    order_price = close.copy().astype(float)

    for ts, row in order_df.iterrows():
        signed_size = float(row["size"]) * (1 if int(row["direction"]) == 1 else -1)
        order_size.loc[ts]  += signed_size
        order_price.loc[ts]  = float(row["price"])

    # ── 关键修复 ────────────────────────────────────────────────────────────
    # 问题：策略按固定 real_capital=10000 计算仓位（模拟杠杆/合约账户），
    # 但 VBT 现货模式下现金不够时会触发 lock_cash 砍单，导致 25+ 个加仓单
    # 被砍成极小数量，VBT 重建净值远低于策略已实现 PnL（差额可达 7.6 万）。
    #
    # 修复：用海量 init_cash 让 VBT 不砍单，所有订单 100% 按策略意图成交；
    # 然后把 portfolio.value() 减去多余本金，校准回真实的 init_cash 起点。
    # 这样 VBT 计算的逐 K 线浮动净值才与策略 trades 列表完全对齐。
    _vbt_huge_cash = 1e10
    pf = vbt.Portfolio.from_orders(
        close,
        size=order_size,
        size_type="amount",
        direction="both",
        price=order_price,
        init_cash=_vbt_huge_cash,
        fees=fees,
        freq="4h",
    )
    # 校准：把 pf 的内部 init_cash 替换成真实值，使 value() 起点回到 init_cash
    # vbt 0.x/1.0 都允许通过 replace 修改 init_cash
    try:
        pf = pf.replace(init_cash=init_cash)
    except Exception:
        # 兜底：直接 monkey-patch wrapper 让 value() 减去 (huge - init_cash)
        _offset = _vbt_huge_cash - init_cash
        _orig_value = pf.value
        pf.value = lambda *a, _o=_offset, _v=_orig_value, **kw: _v(*a, **kw) - _o
        _orig_cash = pf.cash
        pf.cash = lambda *a, _o=_offset, _c=_orig_cash, **kw: _c(*a, **kw) - _o

    indicators = {
        "SSL1上轨":  ssl_up1,
        "SSL1下轨":  ssl_down1,
        "SSL2上轨":  ssl_up2,
        "SSL2下轨":  ssl_down2,
        "S1突破上轨": s1_high,
        "S2突破上轨": s2_high,
        "S2突破下轨": s2_low,
    }

    return pf, indicators, _strategy_trades
