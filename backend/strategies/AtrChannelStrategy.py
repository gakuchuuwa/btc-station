"""
ATR 通道动态止损策略 — VectorBT 格式

逻辑：收盘价突破 EMA + ATR*倍数上轨买入，跌破 EMA 中线出场
调参建议：atr_period 7~28，ema_period 20~100，channel_mult 1.0~3.0
"""
import vectorbt as vbt
import pandas_ta as ta
import pandas as pd


def execute(df, parameters):
    atr_period   = int(parameters.get("atr_period", 14))
    ema_period   = int(parameters.get("ema_period", 50))
    channel_mult = float(parameters.get("channel_mult", 1.5))

    atr     = ta.atr(df["high"], df["low"], df["close"], length=atr_period)
    ema     = df["close"].ewm(span=ema_period, adjust=False).mean()
    upper   = ema + channel_mult * atr

    entries = df["close"] > upper.shift(1)
    exits   = df["close"] < ema.shift(1)

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=10000, fees=0.0005,
    )

    return pf, {"EMA中线": ema, "ATR上轨": upper}
