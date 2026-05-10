import os
import sys
import pandas as pd
from pathlib import Path

# Add backend to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from dynamic_runner import run_dynamic_code
from data_feeder import DataFeeder
from csv_converter import vectorbt_to_tv_csv

def test_vbt():
    print("Testing VectorBT Flow...")
    
    # 1. Get Data
    feeder = DataFeeder('okx')
    symbol = 'BTC/USDT'
    timeframe = '1h'
    
    print(f"Fetching data for {symbol} {timeframe}...")
    df = feeder.fetch_ohlcv(symbol, timeframe, limit=500)
    
    # 2. Strategy Code (VectorBT Format)
    strategy_code = """
import vectorbt as vbt
import pandas as pd

def execute(df, parameters):
    fast_ma = vbt.MA.run(df['close'], parameters.get('fast', 10))
    slow_ma = vbt.MA.run(df['close'], parameters.get('slow', 20))
    
    entries = fast_ma.ma_crossed_above(slow_ma)
    exits = fast_ma.ma_crossed_below(slow_ma)
    
    pf = vbt.Portfolio.from_signals(df['close'], entries, exits, init_cash=10000)
    
    # Return indicators for plotting
    indicators = {
        "Fast MA": fast_ma.ma,
        "Slow MA": slow_ma.ma
    }
    return pf, indicators
"""
    
    # 3. Run
    params = {'fast': 20, 'slow': 50}
    print("Running VectorBT strategy...")
    res_data, err = run_dynamic_code(strategy_code, df, params)
    
    if err:
        print(f"FAILED: {err}")
        return
    
    print("SUCCESS! Metrics:")
    print(res_data['metrics'])
    print(f"Trades count: {len(res_data['trades'])}")
    
    # 4. CSV Conversion
    print("Testing CSV conversion...")
    csv_text = vectorbt_to_tv_csv(res_data, params, 10000)
    print(f"CSV Length: {len(csv_text)} chars")
    
    if len(csv_text) > 100:
        print("CSV Generation: OK")
    else:
        print("CSV Generation: FAILED")

if __name__ == "__main__":
    test_vbt()
