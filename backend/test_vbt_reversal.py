import pandas as pd
import vectorbt as vbt
import pandas_ta as ta
import numpy as np

close = pd.Series(np.random.normal(100, 5, 1000).cumsum())

fast_ema = ta.ema(close, length=20)
slow_ema = ta.ema(close, length=50)

entries = (fast_ema > slow_ema) & (fast_ema.shift(1) <= slow_ema.shift(1))
short_entries = (fast_ema < slow_ema) & (fast_ema.shift(1) >= slow_ema.shift(1))

# Default
try:
    portfolio = vbt.Portfolio.from_signals(
        close=close,
        entries=entries,
        exits=short_entries,
        short_entries=short_entries,
        short_exits=entries,
        init_cash=10000.0,
        fees=0.0005,
        direction='both',
    )
    print("Default sizing works.")
except Exception as e:
    print("Error with default sizing:", e)

# 100% Value
try:
    portfolio2 = vbt.Portfolio.from_signals(
        close=close,
        entries=entries,
        exits=short_entries,
        short_entries=short_entries,
        short_exits=entries,
        init_cash=10000.0,
        fees=0.0005,
        direction='both',
        size=100,
        size_type='value'
    )
    print("Value sizing works.")
except Exception as e:
    print("Error with value sizing:", e)

# 1.0 Percent using size_type=None
try:
    portfolio3 = vbt.Portfolio.from_signals(
        close=close,
        entries=entries,
        exits=short_entries,
        short_entries=short_entries,
        short_exits=entries,
        init_cash=10000.0,
        fees=0.0005,
        direction='both',
        size=1.0, # 1.0 units? No, size_type defaults to amount
    )
    print("1.0 size works.")
except Exception as e:
    print("Error with 1.0 size:", e)
