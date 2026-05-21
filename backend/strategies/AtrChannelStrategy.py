"""
ATR 通道动态止损策略 — VectorBT 格式

逻辑：收盘价突破 EMA + ATR*倍数上轨买入，跌破 EMA 中线出场
调参建议：atr_period 7~28，ema_period 20~100，channel_mult 1.0~3.0

资金/仓位约定（与所有内置策略统一）：
- init_cash         : 初始资金（USDT），默认 10000
- position_size_pct : 每次开仓使用当前权益的百分比（0-100），默认 100 = 全仓
- fees              : 单边手续费率，默认 0.0005 = 0.05%
"""
import vectorbt as vbt
import pandas as pd
import numpy as np


def execute(df, parameters):
    # ── 资金/仓位（统一参数）──
    init_cash         = float(parameters.get("init_cash", 10000))
    position_size_pct = float(parameters.get("position_size_pct", 100))
    fees              = float(parameters.get("fees", 0.0005))

    # ── 策略参数 ──
    atr_period   = int(parameters.get("atr_period", 14))
    ema_period   = int(parameters.get("ema_period", 50))
    channel_mult = float(parameters.get("channel_mult", 1.5))

    # Manual ATR calculation
    high, low, close = df["high"], df["low"], df["close"]
    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(window=atr_period).mean()

    ema     = close.ewm(span=ema_period, adjust=False).mean()
    upper   = ema + channel_mult * atr

    entries = close > upper.shift(1)
    exits   = close < ema.shift(1)

    pf = vbt.Portfolio.from_signals(
        close, entries, exits,
        init_cash=init_cash,
        fees=fees,
        size=position_size_pct / 100.0,
        size_type='percent',
    )

    return pf, {"EMA中线": ema, "ATR上轨": upper}
