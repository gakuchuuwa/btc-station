"""
海龟 SSL 双系统 6形态 ATR 动态止损策略 — VectorBT 格式
基于 Pine Script v6 版本移植

核心逻辑：
- 双 SSL 通道（RMA高/低）识别 6 种市场形态
- 牛熊过滤器（P4试探空/S2下轨突破确认）
- 双系统唐奇安突破（S1短周期/S2长周期）
- MACD 接力做多（P2/P3）/ 做空（P5/P6）
- OBV 振荡器过滤
- ATR 初始止损 + 追踪止损
- 金字塔加仓（追踪激活时加仓）

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
    """SSL 通道：返回 (hlv, ssl_up, ssl_down)"""
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
    return hlv, pd.Series(ssl_up, index=close.index), pd.Series(ssl_down, index=close.index)


def _macd(close, fast, slow, signal):
    ema_fast = close.ewm(span=fast, adjust=False).mean()
    ema_slow = close.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    return macd_line, signal_line


def _obv_osc(close, volume, length):
    chg = close.diff()
    obv_raw = np.where(chg > 0, volume, np.where(chg < 0, -volume, 0))
    obv = pd.Series(obv_raw, index=close.index).cumsum()
    osc = obv - obv.ewm(span=length, adjust=False).mean()
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
    base_risk_percent    = float(p.get("base_risk_percent", 1.0))
    init_cash            = float(p.get("init_cash", 10000))
    fees                 = float(p.get("fees", 0.0006))
    use_real_capital     = _bool_param(p.get("use_real_capital"), False)
    real_capital         = float(p.get("real_capital", 10000))
    enable_max_qty       = _bool_param(p.get("enable_max_qty"), False)
    max_qty              = float(p.get("max_qty", 10.0))
    qty_step             = float(p.get("qty_step", 0.001))
    min_qty              = float(p.get("min_qty", 0.001))
    slippage_ticks       = float(p.get("slippage_ticks", 10))
    tick_size            = float(p.get("tick_size", 0.1))
    atr_period           = system1_period
    atr_mult_init        = float(p.get("atr_mult_init", 2.0))
    atr_mult_long_trail  = float(p.get("atr_mult_long_trail", 11.0))
    atr_mult_short_trail = float(p.get("atr_mult_short_trail", 3.0))
    profit_atr_mult_long = float(p.get("profit_atr_mult_long", 5.0))
    profit_atr_mult_short= float(p.get("profit_atr_mult_short", 5.0))
    enable_trailing      = _bool_param(p.get("enable_trailing_stop"), True)
    use_breakeven        = _bool_param(p.get("use_breakeven"), True)
    enable_regime        = _bool_param(p.get("enable_regime_filter"), True)
    enable_obv           = _bool_param(p.get("enable_obv_filter"), True)
    use_dual_system      = _bool_param(p.get("use_dual_system"), False)
    use_s1_filter        = _bool_param(p.get("use_s1_filter"), True)
    pyramid_enable       = _bool_param(p.get("pyramid_enable"), True)
    pyramid_max_long     = int(p.get("pyramid_max_count_long", 1))
    pyramid_max_short    = int(p.get("pyramid_max_count_short", 0))
    pyramid_mult         = float(p.get("pyramid_mult_u2", 0.5))
    realtime_stop_pct    = float(p.get("realtime_stop_percent", 4.0))
    enable_rt_stop       = _bool_param(p.get("enable_realtime_stop"), True)
    enable_p1_switch_exit= _bool_param(p.get("enable_p1_switch_exit"), True)
    enable_p4_switch_exit= _bool_param(p.get("enable_p4_switch_exit"), True)
    enable_p1_cooldown   = _bool_param(p.get("enable_p1_cooldown"), True)
    p1_cooldown_bars     = int(p.get("p1_cooldown_bars", system2_period))
    p1_cooldown_mult     = float(p.get("p1_cooldown_mult", 1.0))
    # 固定数量模式（传入 fixed_qty=1 时跳过风险计算，每笔固定 1 单位，用于与 TV 对比）
    fixed_qty            = p.get("fixed_qty", None)
    if fixed_qty is not None:
        fixed_qty = float(fixed_qty)
    # 数据起点裁剪（传入 start_date="2019-12-16 13:00:00" 使 Python 与 TV 图表从同一根K线开始预热）
    start_date           = p.get("start_date", None)
    # 与 TurtleClassicStrategy / TurtleAtrTrailStrategy 共享参数（Dual 不使用，仅接收）
    _atr_period_ignored  = p.get("atr_period", None)   # Dual 用 system1_period 作为 ATR 周期
    _max_units_ignored   = p.get("max_units", None)     # Dual 用 pyramid 代替海龟分批加仓
    _unit_add_atr_ignored= p.get("unit_add_atr", None)
    _use_long_ignored    = p.get("use_long", None)      # Dual 由形态/过滤器决定方向
    _use_short_ignored   = p.get("use_short", None)

    # 形态仓位倍数
    mult = {
        (1, True) : float(p.get("mult_p1_l", 2.0)),
        (2, True) : float(p.get("mult_p2_l", 1.5)),
        (3, True) : float(p.get("mult_p3_l", 1.3)),
        (4, False): float(p.get("mult_p4_s", 1.8)),
        (5, True) : float(p.get("mult_p5_l", 1.0)),
        (5, False): float(p.get("mult_p5_s", 1.1)),
        (6, True) : float(p.get("mult_p6_l", 1.1)),
        (6, False): float(p.get("mult_p6_s", 1.0)),
    }

    # ── 数据起点裁剪（对齐 TV 图表第一根 K 线）────────────────────────────────
    if start_date is not None:
        df = df[df.index >= pd.Timestamp(start_date)]
        if df.empty:
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
    hlv1, ssl_up1, ssl_down1 = _ssl_channel(high, low, close, ma1_length)
    hlv2, ssl_up2, ssl_down2 = _ssl_channel(high, low, close, ma3_length)

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
    c1_gt_c2 = (ssl_up1 > ssl_up2) & (ssl_down1 > ssl_down2)
    c1_lt_c2 = (ssl_up1 < ssl_up2) & (ssl_down1 < ssl_down2)

    # ── 逐K线状态机 ─────────────────────────────────────────────────────────────
    order_times, order_prices, order_sizes, order_dirs = [], [], [], []

    _strategy_trades   = []
    # 当前持仓内所有未平仓"腿"（首入 + N 次加仓），平仓时每条独立结算 PnL
    # 每条 leg 结构：{'entry_ts', 'entry_px', 'qty', 'signal'}
    _open_legs         = []

    pos = 0.0
    pos_avg = 0.0
    cash = init_cash

    bull = True
    bear = False
    p6_locked = False
    regime_test = None

    s1_last_failed = False
    entry_system = None
    entry_pattern = 0
    entry_atr_val = 0.0
    entry_price_first = 0.0
    entry_mult_val = 1.0

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

    cur_pat = 1
    p1_loss_bar = None

    # 加仓 pending：避免当根K线用 next_open 更新 pos_avg 后立刻影响同根止损判断（未来函数漏洞）
    _pending_add_qty_long  = 0.0
    _pending_add_qty_short = 0.0

    def _calc_qty(entry_px, atr_v, m):
        if fixed_qty is not None:
            return fixed_qty
        account_equity = real_capital if use_real_capital else cash
        risk_amt = account_equity * base_risk_percent / 100 * m
        stop_dist = max(atr_v * atr_mult_init, 0.01)
        raw = risk_amt / stop_dist
        q = np.floor(raw / qty_step + 1e-9) * qty_step
        q = round(float(q), 6)
        if enable_max_qty:
            q = min(q, max_qty)
        return 0.0 if q < min_qty else q

    def _record(idx_val, px, size, direction):
        slip = slippage_ticks * tick_size
        fill_px = px + slip if direction == 1 else px - slip
        order_times.append(idx_val)
        order_prices.append(fill_px)
        order_sizes.append(abs(size))
        order_dirs.append(direction)

    def _close_legs(direction_str, exit_ts, exit_px, exit_signal, status='Closed'):
        """平仓时遍历 _open_legs，每条腿独立结算 PnL 并 append 到 _strategy_trades。
        对齐 TV：每次入场+加仓都是独立 trade，出场共享同一 exit_ts/exit_px/exit_signal。
        返回总 PnL（含双边手续费），用于更新 cash 和后续过滤器状态。
        """
        total_pnl = 0.0
        for leg in _open_legs:
            ep = float(leg['entry_px']); ex = float(exit_px); q = float(leg['qty'])
            if direction_str == 'Long':
                gross = (ex - ep) * q
                ret   = (ex - ep) / ep if ep else 0
            else:
                gross = (ep - ex) * q
                ret   = (ep - ex) / ep if ep else 0
            leg_fees = (ep * q * fees) + (ex * q * fees)
            pnl = gross - leg_fees
            total_pnl += pnl
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
                _record(idx[i], cl, pos, -1)
                cash += _close_legs('Long', idx[i], cl, 'Liquidation', status='Liquidated')
            elif pos < 0:
                _record(idx[i], cl, abs(pos), 1)
                cash += _close_legs('Short', idx[i], cl, 'Liquidation', status='Liquidated')
            pos = 0.0; pos_avg = 0.0; cash = 0.0
            _open_legs = []
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

        # 牛熊过滤：c1_gt_c2 即切回牛市
        if enable_regime and gt:
            bull = True; bear = False; p6_locked = False; regime_test = None

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

        # 上一根K线 pending 的加仓，在本根K线开盘后正式更新均价（避免未来函数）
        if _pending_add_qty_long > 0 and pos > 0:
            pos_avg = (pos_avg * (pos - _pending_add_qty_long) + open_.iloc[i] * _pending_add_qty_long) / pos
            if use_breakeven:
                long_stop = max(long_stop, pos_avg)
            _pending_add_qty_long = 0.0
        if _pending_add_qty_short > 0 and pos < 0:
            pos_avg = (pos_avg * (abs(pos) - _pending_add_qty_short) + open_.iloc[i] * _pending_add_qty_short) / abs(pos)
            _pending_add_qty_short = 0.0
        # 注：旧版有 _trade_total_qty/_trade_entry_price 全局聚合，新版改为 _open_legs，
        # 每条腿在 _close_legs 内独立结算，无需全局更新

        # ── 当前持多 ──────────────────────────────────────────────────────
        if pos > 0:
            if cur_pat == 1: has_p1 = True
            exit_pat = enable_p1_switch_exit and has_p1 and cur_pat != 1

            # ATR 追踪止损更新
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
                pyramid_long_cnt += 1
                base_q = _calc_qty(next_open, atr_v, entry_mult_val)
                add_q = round(base_q * pyramid_mult // 0.001 * 0.001, 6)
                if add_q >= 0.001:
                    _record(next_ts, next_open, add_q, 1)
                    pos += add_q
                    _pending_add_qty_long = add_q
                    _open_legs.append({
                        'entry_ts': next_ts,
                        'entry_px': next_open,
                        'qty':      add_q,
                        'signal':   f"Scale-in Long {pyramid_long_cnt}",
                    })

            long_trail_just = False

            # 加仓后追踪止损常规上移（use_breakeven 分支的均价在下一根才更新，此处只处理非保本分支）
            if pyramid_long_cnt > 0 and long_trail and not use_breakeven:
                new_s = max(cl - atr_v * atr_mult_long_trail, entry_price_first)
                long_stop = max(long_stop, new_s)

            # 止损触发判断
            # ATR/形态止损：TV 用 strategy.close_all()，在下一根开盘成交
            # Price SL：TV 用 strategy.exit(stop=price)，在当K线内精准止损价成交
            hit_init_sl  = (not long_trail) and (not np.isnan(long_stop)) and cl < long_stop
            hit_trail_sl = long_trail and (not np.isnan(long_stop)) and cl < long_stop
            rt_stop_long = pos_avg * (1 - realtime_stop_pct / 100)
            hit_rt_sl    = enable_rt_stop and lo <= rt_stop_long
            do_exit_long = exit_pat or hit_init_sl or hit_trail_sl or hit_rt_sl

            if do_exit_long:
                if hit_rt_sl and not hit_init_sl and not hit_trail_sl and not exit_pat:
                    exit_px = rt_stop_long
                    exit_ts = idx[i]
                    exit_signal = 'Price SL'
                else:
                    exit_px = next_open
                    exit_ts = next_ts
                    if exit_pat:
                        exit_signal = 'P1 Pattern Switch Exit Long'
                    elif hit_trail_sl:
                        exit_signal = 'Trailing SL'
                    else:
                        exit_signal = 'ATR SL'
                _record(exit_ts, exit_px, pos, -1)
                pnl = _close_legs('Long', exit_ts, exit_px, exit_signal)
                cash += pnl
                if entry_system == 'S1' and use_s1_filter:
                    s1_last_failed = pnl <= 0
                if entry_system == 'S2' and pnl > 0:
                    s1_last_failed = False
                if enable_p1_cooldown and entry_pattern == 1 and pnl <= 0:
                    p1_loss_bar = i
                if enable_regime and regime_test == 'P4_bear_test':
                    if pnl > 0 or entry_system == 'S2':
                        bull = False; bear = True
                    regime_test = None
                pos = 0.0; pos_avg = 0.0
                long_stop = np.nan; long_trail = False; long_trail_just = False
                entry_pattern = 0; entry_system = None
                has_p1 = False; has_p4 = False
                p2_ready = False; p3_ready = False
                pyramid_long_cnt = 0; _pending_add_qty_long = 0.0
                _open_legs = []
                continue

        # ── 当前持空 ──────────────────────────────────────────────────────
        elif pos < 0:
            if cur_pat == 4: has_p4 = True
            exit_pat = enable_p4_switch_exit and has_p4 and cur_pat != 4

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
                pyramid_short_cnt += 1
                base_q = _calc_qty(next_open, atr_v, entry_mult_val)
                add_q = round(base_q * pyramid_mult // 0.001 * 0.001, 6)
                if add_q >= 0.001:
                    _record(next_ts, next_open, add_q, -1)
                    pos -= add_q
                    _pending_add_qty_short = add_q
                    _open_legs.append({
                        'entry_ts': next_ts,
                        'entry_px': next_open,
                        'qty':      add_q,
                        'signal':   f"Scale-in Short {pyramid_short_cnt}",
                    })

            short_trail_just = False

            if pyramid_short_cnt > 0 and short_trail and not use_breakeven:
                new_s = min(cl + atr_v * atr_mult_short_trail, entry_price_first)
                short_stop = min(short_stop, new_s)

            hit_init_sl  = (not short_trail) and (not np.isnan(short_stop)) and cl > short_stop
            hit_trail_sl = short_trail and (not np.isnan(short_stop)) and cl > short_stop
            rt_stop_short = pos_avg * (1 + realtime_stop_pct / 100)
            hit_rt_sl    = enable_rt_stop and hi >= rt_stop_short
            do_exit_short = exit_pat or hit_init_sl or hit_trail_sl or hit_rt_sl

            if do_exit_short:
                if hit_rt_sl and not hit_init_sl and not hit_trail_sl and not exit_pat:
                    exit_px = rt_stop_short
                    exit_ts = idx[i]
                    exit_signal = 'Price SL'
                else:
                    exit_px = next_open
                    exit_ts = next_ts
                    if exit_pat:
                        exit_signal = 'P4 Pattern Switch Exit Short'
                    elif hit_trail_sl:
                        exit_signal = 'Trailing SL'
                    else:
                        exit_signal = 'ATR SL'
                _record(exit_ts, exit_px, abs(pos), 1)
                pnl = _close_legs('Short', exit_ts, exit_px, exit_signal)
                cash += pnl
                if entry_system == 'S1' and use_s1_filter:
                    s1_last_failed = pnl <= 0
                if entry_system == 'S2' and pnl > 0:
                    s1_last_failed = False
                if enable_regime and regime_test == 'P4_bear_test':
                    if pnl > 0 or entry_system == 'S2':
                        bull = False; bear = True
                    regime_test = None
                if bear and entry_pattern in (5, 6) and pnl <= 0:
                    p6_locked = True
                pos = 0.0; pos_avg = 0.0
                short_stop = np.nan; short_trail = False; short_trail_just = False
                entry_pattern = 0; entry_system = None
                has_p1 = False; has_p4 = False
                p5_ready = False; p6_ready = False
                pyramid_short_cnt = 0; _pending_add_qty_short = 0.0
                _open_legs = []
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
                    if cur_pat == 4:
                        if s1_bs: signal_short = 'S1'
                        elif s2_bs: signal_short = 'S2'
                    if cur_pat == 5 and p5_ready and md and not p6_locked:
                        if signal_short is None: signal_short = 'MACD'
                    if cur_pat == 6 and p6_ready and md and not p6_locked:
                        if signal_short is None: signal_short = 'MACD'
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

            # 做多入场（TV 在信号K线收盘确认，下一根开盘成交）
            if signal_long:
                m = mult.get((cur_pat, True), 1.0)
                if cur_pat == 1 and enable_p1_cooldown and p1_loss_bar is not None and (i - p1_loss_bar) <= p1_cooldown_bars:
                    m = p1_cooldown_mult
                qty = _calc_qty(next_open, atr_v, m)
                if qty >= min_qty:
                    _record(next_ts, next_open, qty, 1)
                    pos = qty; pos_avg = next_open
                    entry_system = signal_long; entry_pattern = cur_pat
                    entry_atr_val = atr_v; entry_mult_val = m
                    long_stop = next_open - atr_v * atr_mult_init
                    long_trail = False; long_trail_just = False
                    has_p1 = (cur_pat == 1)
                    p2_ready = False; p3_ready = False
                    pyramid_long_cnt = 0; entry_price_first = next_open
                    _open_legs = [{
                        'entry_ts': next_ts,
                        'entry_px': next_open,
                        'qty':      qty,
                        'signal':   f"{signal_long} Long-P{cur_pat}",
                    }]
                    if enable_regime and bull and cur_pat == 4:
                        regime_test = 'P4_bear_test'

            # 做空入场（TV 在信号K线收盘确认，下一根开盘成交）
            elif signal_short:
                m = mult.get((cur_pat, False), 1.0)
                qty = _calc_qty(next_open, atr_v, m)
                if qty >= min_qty:
                    _record(next_ts, next_open, qty, -1)
                    pos = -qty; pos_avg = next_open
                    entry_system = signal_short; entry_pattern = cur_pat
                    entry_atr_val = atr_v; entry_mult_val = m
                    short_stop = next_open + atr_v * atr_mult_init
                    short_trail = False; short_trail_just = False
                    has_p4 = (cur_pat == 4)
                    p5_ready = False; p6_ready = False
                    pyramid_short_cnt = 0; entry_price_first = next_open
                    _open_legs = [{
                        'entry_ts': next_ts,
                        'entry_px': next_open,
                        'qty':      qty,
                        'signal':   f"{signal_short} Short-P{cur_pat}",
                    }]
                    if enable_regime and bull and cur_pat == 4:
                        regime_test = 'P4_bear_test'

    # 强制平仓（回测结束，用最后一根收盘价）
    if pos != 0.0 and _open_legs:
        last_i = n - 1
        last_cl = close.iloc[last_i]
        if pos > 0:
            _record(idx[last_i], last_cl, pos, -1)
            _close_legs('Long', idx[last_i], last_cl, 'End of Backtest', status='Open')
        else:
            _record(idx[last_i], last_cl, abs(pos), 1)
            _close_legs('Short', idx[last_i], last_cl, 'End of Backtest', status='Open')

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
