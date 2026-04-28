# -*- coding: utf-8 -*-
import sys
sys.path.append('.')
from dynamic_runner import run_dynamic_code
from data_feeder import DataFeeder
import json

feeder = DataFeeder('okx')
df = feeder.get_local_data('BTC/USDT', '4h')

code = '''
import pandas as pd
import vectorbt as vbt

def execute(df, parameters):
    s1 = int(parameters.get('s1_period', 55))
    s2 = int(parameters.get('s2_period', 144))

    close = df['close']
    high  = df['high']
    low   = df['low']

    s1_high = high.rolling(window=s1).max().shift(1)
    s1_low  = low.rolling(window=s1).min().shift(1)
    s2_high = high.rolling(window=s2).max().shift(1)

    entries = (high > s1_high) & (close > s2_high)
    exits   = (low  < s1_low)

    portfolio = vbt.Portfolio.from_signals(
        close=close,
        entries=entries,
        exits=exits,
        fees=0.001,
        init_cash=10000,
        freq='4h'
    )

    ts_index = pd.to_datetime(df['timestamp'])
    indicators = {
        'S1 High': s1_high.set_axis(ts_index),
        'S1 Low':  s1_low.set_axis(ts_index),
        'S2 High': s2_high.set_axis(ts_index),
    }
    return portfolio, indicators
'''

try:
    res, err = run_dynamic_code(code, df, {'s1_period': 55, 's2_period': 144})
    if err:
        print("DYNAMIC ERROR:", err)
    else:
        print("SUCCESS METRICS:", res['metrics'])
        # Try JSON serialization which is what FastAPI does
        json.dumps(res)
        print("JSON DUMP SUCCESS")
except Exception as e:
    import traceback
    traceback.print_exc()
