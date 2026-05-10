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
    """Wilder 平滑均线（Pine ta.rma）"""
    alpha = 1.0 / length
    return series.ewm(alpha=alpha, adjust=False).mean()


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


# ── 主策略函数 ────────────────────────────────────────────────────────────────

def execute(df, parameters):
    # ── 参数读取 ────────────────────────────────────────────────────────────────
    p = parameters
    system1_period      = int(p.get("system1_period", 55))
    system2_period      = int(p.get("system2_period", 144))
    ma1_length          = int(p.get("ma1_length", 144))
    ma3_length          = int(p.get("ma3_length", 576))
    macd_fast           = int(p.get("macd_fast", 13))
    macd_slow           = int(p.get("macd_slow", 21))
    macd_signal_period  = int(p.get("macd_signal", 8))
    obv_length          = int(p.get("obv_length", 13))
    base_risk_percent   = float(p.get("base_risk_percent", 2.5))
    init_cash           = float(p.get("init_cash", 10000))
    fees                = float(p.get("fees", 0.0006))
    atr_period          = system1_period
    atr_mult_init       = float(p.get("atr_mult_init", 2.0))
    atr_mult_long_trail = float(p.get("atr_mult_long_trail", 11.0))
    atr_mult_short_trail= float(p.get("atr_mult_short_trail", 3.0))
    profit_atr_mult_long= float(p.get("profit_atr_mult_long", 5.0))
    profit_atr_mult_short=float(p.get("profit_atr_mult_short", 5.0))
    enable_trailing     = bool(p.get("enable_trailing_stop", True))
    use_breakeven       = bool(p.get("use_breakeven", True))
    enable_regime       = bool(p.get("enable_regime_filter", True))
    enable_obv          = bool(p.get("enable_obv_filter", True))
    use_dual_system     = bool(p.get("use_dual_system", True))
    use_s1_filter       = bool(p.get("use_s1_filter", True))
    pyramid_enable      = bool(p.get("pyramid_enable", True))
    pyramid_max_long    = int(p.get("pyramid_max_count_long", 1))
    pyramid_max_short   = int(p.get("pyramid_max_count_short", 0))
    pyramid_mult        = float(p.get("pyramid_mult_u2", 0.5))
    realtime_stop_pct   = float(p.get("realtime_stop_percent", 4.0))
    enable_rt_stop      = bool(p.get("enable_realtime_stop", True))
    # 形态仓位倍数
    mult = {
        (1, True): float(p.get("mult_p1_l", 1.0)),
        (2, True): float(p.get("mult_p2_l", 1.0)),
        (3, True): float(p.get("mult_p3_l", 1.0)),
        (4, False):float(p.get("mult_p4_s", 1.0)),
        (5, True): float(p.get("mult_p5_l", 1.0)),
        (5, False):float(p.get("mult_p5_s", 1.0)),
        (6, True): float(p.get("mult_p6_l", 1.0)),
        (6, False):float(p.get("mult_p6_s", 1.0)),
    }

    # ── 指标计算 ────────────────────────────────────────────────────────────────
    high  = df["high"]
    low   = df["low"]
    close = df["close"]
    volume= df["volume"]
    n     = len(df)

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
    # 订单记录
    order_times, order_prices, order_sizes, order_dirs = [], [], [], []

    # 状态变量
    pos = 0.0            # 持仓量（正=多，负=空）
    pos_avg = 0.0        # 持仓均价
    cash = init_cash

    bull = True          # 牛市状态
    bear = False
    p6_locked = False    # P6做空锁定
    regime_test = None   # 'P4_bear_test'

    s1_last_failed = False
    entry_system = None
    entry_pattern = 0
    entry_atr_val = 0.0
    entry_price_first = 0.0
    entry_risk = base_risk_percent
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

    # 当前形态
    cur_pat = 1

    prev_pos = 0.0
    trade_entry_idx = -1

    def _calc_qty(entry_px, atr_v, m):
        risk_amt = init_cash * base_risk_percent / 100 * m
        stop_dist = max(atr_v * atr_mult_init, 0.01)
        raw = risk_amt / stop_dist
        q = max(0.0, round(raw // 0.001 * 0.001, 6))
        return q

    def _record(idx_val, px, size, direction):
        order_times.append(idx_val)
        order_prices.append(px)
        order_sizes.append(abs(size))
        order_dirs.append(direction)  # 1=buy, -1=sell

    idx = df.index

    for i in range(1, n):
        cl  = close.iloc[i]
        hi  = high.iloc[i]
        lo  = low.iloc[i]
        atr_v = atr.iloc[i]
        if np.isnan(atr_v) or atr_v <= 0:
            continue

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
        s1_bl = use_dual_system and (not np.isnan(s1h)) and cl > s1h and close.iloc[i-1] <= s1_high.iloc[i-1] if not np.isnan(s1_high.iloc[i-1]) else False
        s1_bs = use_dual_system and (not np.isnan(s1l)) and cl < s1l and close.iloc[i-1] >= s1_low.iloc[i-1] if not np.isnan(s1_low.iloc[i-1]) else False
        s2_bl = (not np.isnan(s2h)) and cl > s2h and close.iloc[i-1] <= s2_high.iloc[i-1] if not np.isnan(s2_high.iloc[i-1]) else False
        s2_bs = (not np.isnan(s2l)) and cl < s2l and close.iloc[i-1] >= s2_low.iloc[i-1] if not np.isnan(s2_low.iloc[i-1]) else False

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

        # 平仓检测（状态机）
        pos_closed = (pos != 0.0 and prev_pos != 0.0) and False  # 由止损触发后处理
        prev_pos = pos

        # ── 当前持多 ──────────────────────────────────────────────────────
        if pos > 0:
            if cur_pat == 1: has_p1 = True
            exit_pat = pos > 0 and has_p1 and cur_pat != 1

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

            # 加仓
            if pyramid_enable and pyramid_max_long > 0 and pyramid_long_cnt < pyramid_max_long and long_trail_just:
                pyramid_long_cnt += 1
                base_q = _calc_qty(cl, atr_v, entry_mult_val)
                add_q = round(base_q * pyramid_mult // 0.001 * 0.001, 6)
                if add_q >= 0.001:
                    _record(idx[i], cl, add_q, 1)
                    pos += add_q
                    pos_avg = (pos_avg * (pos - add_q) + cl * add_q) / pos
                    if use_breakeven:
                        long_stop = max(long_stop, pos_avg)

            long_trail_just = False

            # 加仓后止损调整
            if pyramid_long_cnt > 0 and long_trail and not long_trail_just:
                if use_breakeven:
                    long_stop = max(long_stop, pos_avg)

            # 止损触发
            hit_init_sl = (not long_trail) and (not np.isnan(long_stop)) and cl < long_stop
            hit_trail_sl = long_trail and (not np.isnan(long_stop)) and cl < long_stop
            hit_rt_sl = enable_rt_stop and cl < pos_avg * (1 - realtime_stop_pct / 100)
            do_exit_long = exit_pat or hit_init_sl or hit_trail_sl or hit_rt_sl

            if do_exit_long:
                _record(idx[i], cl, pos, -1)
                # 平仓盈亏更新互锁
                pnl = (cl - pos_avg) * pos * (1 - fees)
                if entry_system == 'S1' and use_s1_filter:
                    s1_last_failed = pnl <= 0
                if entry_system == 'S2' and pnl > 0:
                    s1_last_failed = False
                # 牛熊确认
                if enable_regime and regime_test == 'P4_bear_test':
                    if pnl > 0 or entry_system == 'S2':
                        bull = False; bear = True
                    regime_test = None
                # 重置
                pos = 0.0; pos_avg = 0.0
                long_stop = np.nan; long_trail = False; long_trail_just = False
                entry_pattern = 0; entry_system = None
                has_p1 = False; has_p4 = False
                p2_ready = False; p3_ready = False
                pyramid_long_cnt = 0
                continue

        # ── 当前持空 ──────────────────────────────────────────────────────
        elif pos < 0:
            if cur_pat == 4: has_p4 = True
            exit_pat = pos < 0 and has_p4 and cur_pat != 4

            profit_short = pos_avg - lo
            if enable_trailing:
                if not short_trail and profit_short >= atr_v * profit_atr_mult_short:
                    short_trail = True; short_trail_just = True
                    calc = lo + atr_v * atr_mult_short_trail
                    short_stop = min(pos_avg, calc) if use_breakeven else calc
                if short_trail and not short_trail_just:
                    new_s = cl + atr_v * atr_mult_short_trail
                    short_stop = min(short_stop, new_s)

            # 加仓（空头）
            if pyramid_enable and pyramid_max_short > 0 and pyramid_short_cnt < pyramid_max_short and short_trail_just:
                pyramid_short_cnt += 1
                base_q = _calc_qty(cl, atr_v, entry_mult_val)
                add_q = round(base_q * pyramid_mult // 0.001 * 0.001, 6)
                if add_q >= 0.001:
                    _record(idx[i], cl, add_q, -1)
                    pos -= add_q
                    pos_avg = (pos_avg * (abs(pos) - add_q) + cl * add_q) / abs(pos)

            short_trail_just = False

            hit_init_sl = (not short_trail) and (not np.isnan(short_stop)) and cl > short_stop
            hit_trail_sl = short_trail and (not np.isnan(short_stop)) and cl > short_stop
            hit_rt_sl = enable_rt_stop and cl > pos_avg * (1 + realtime_stop_pct / 100)
            do_exit_short = exit_pat or hit_init_sl or hit_trail_sl or hit_rt_sl

            if do_exit_short:
                _record(idx[i], cl, abs(pos), 1)
                pnl = (pos_avg - cl) * abs(pos) * (1 - fees)
                if entry_system == 'S1' and use_s1_filter:
                    s1_last_failed = pnl <= 0
                if entry_system == 'S2' and pnl > 0:
                    s1_last_failed = False
                if enable_regime and regime_test == 'P4_bear_test':
                    if pnl > 0 or entry_system == 'S2':
                        bull = False; bear = True
                    regime_test = None
                # P5/P6 做空止损锁定
                if bear and entry_pattern in (5, 6) and pnl <= 0:
                    p6_locked = True
                pos = 0.0; pos_avg = 0.0
                short_stop = np.nan; short_trail = False; short_trail_just = False
                entry_pattern = 0; entry_system = None
                has_p1 = False; has_p4 = False
                p5_ready = False; p6_ready = False
                pyramid_short_cnt = 0
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

            # OBV 过滤
            if not obv_long_ok: signal_long = None
            if not obv_short_ok: signal_short = None

            # 做多入场
            if signal_long:
                m = mult.get((cur_pat, True), 1.0)
                qty = _calc_qty(cl, atr_v, m)
                if qty >= 0.001:
                    _record(idx[i], cl, qty, 1)
                    pos = qty; pos_avg = cl
                    entry_system = signal_long; entry_pattern = cur_pat
                    entry_atr_val = atr_v; entry_mult_val = m
                    long_stop = cl - atr_v * atr_mult_init
                    long_trail = False; long_trail_just = False
                    has_p1 = (cur_pat == 1)
                    p2_ready = False; p3_ready = False
                    pyramid_long_cnt = 0; entry_price_first = cl
                    if enable_regime and bull and cur_pat == 4:
                        regime_test = 'P4_bear_test'

            # 做空入场
            elif signal_short:
                m = mult.get((cur_pat, False), 1.0)
                qty = _calc_qty(cl, atr_v, m)
                if qty >= 0.001:
                    _record(idx[i], cl, qty, -1)
                    pos = -qty; pos_avg = cl
                    entry_system = signal_short; entry_pattern = cur_pat
                    entry_atr_val = atr_v; entry_mult_val = m
                    short_stop = cl + atr_v * atr_mult_init
                    short_trail = False; short_trail_just = False
                    has_p4 = (cur_pat == 4)
                    p5_ready = False; p6_ready = False
                    pyramid_short_cnt = 0; entry_price_first = cl
                    if enable_regime and bull and cur_pat == 4:
                        regime_test = 'P4_bear_test'

    # 强制平仓（回测结束）
    if pos != 0.0:
        last_i = n - 1
        last_cl = close.iloc[last_i]
        if pos > 0:
            _record(idx[last_i], last_cl, pos, -1)
        else:
            _record(idx[last_i], last_cl, abs(pos), 1)

    # ── 构建 VectorBT 组合 ───────────────────────────────────────────────────
    if not order_times:
        # 无交易，返回空组合
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

    # 构建 buy/sell Series（对齐到 close 索引）
    buy_mask  = pd.Series(False, index=close.index)
    sell_mask = pd.Series(False, index=close.index)
    buy_price  = pd.Series(np.nan, index=close.index)
    sell_price = pd.Series(np.nan, index=close.index)
    buy_size   = pd.Series(np.nan, index=close.index)
    sell_size  = pd.Series(np.nan, index=close.index)

    for ts, row in order_df.iterrows():
        if row["direction"] == 1:
            buy_mask[ts] = True
            buy_price[ts] = row["price"]
            buy_size[ts]  = row["size"]
        else:
            sell_mask[ts] = True
            sell_price[ts] = row["price"]
            sell_size[ts]  = row["size"]

    pf = vbt.Portfolio.from_signals(
        close,
        buy_mask, sell_mask,
        price=close,
        size=buy_size.fillna(sell_size),
        size_type="amount",
        init_cash=init_cash,
        fees=fees,
        freq="4h",
        short_entries=sell_mask,
        short_exits=buy_mask,
    )

    # ── 指标 overlay ─────────────────────────────────────────────────────────
    indicators = {
        "SSL1上轨": ssl_up1,
        "SSL1下轨": ssl_down1,
        "SSL2上轨": ssl_up2,
        "SSL2下轨": ssl_down2,
        "S1突破上轨": s1_high,
        "S2突破上轨": s2_high,
        "S2突破下轨": s2_low,
    }

    return pf, indicators
