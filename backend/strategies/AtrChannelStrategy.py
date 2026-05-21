"""
ATR 通道动态止损策略 — VectorBT 格式

逻辑：收盘价突破 EMA + ATR*倍数上轨买入，跌破 EMA 中线出场
调参建议：atr_period 7~28，ema_period 20~100，channel_mult 1.0~3.0
"""
import vectorbt as vbt
import pandas as pd
import numpy as np


def execute(df, parameters):
    atr_period   = int(parameters.get("atr_period", 14))
    ema_period   = int(parameters.get("ema_period", 50))
    channel_mult = float(parameters.get("channel_mult", 1.5))

    # Manual ATR calculation (replaces pandas_ta.atr)
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
        init_cash=10000, fees=0.0005,
    )

    return pf, {"EMA中线": ema, "ATR上轨": upper}

