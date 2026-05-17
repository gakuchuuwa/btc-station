"""
Debug: compare strategy internal orders vs VectorBT portfolio trades
"""
import pandas as pd
import numpy as np
import sys
sys.path.insert(0, '.')

from data_feeder import DataFeeder

feeder = DataFeeder('okx')
df = feeder.get_local_data('BTC/USDT', '4h')
print(f"Loaded {len(df)} rows, range: {df.timestamp.iloc[0]} ~ {df.timestamp.iloc[-1]}")

# Set index
df2 = df.copy()
if 'timestamp' in df2.columns:
    df2 = df2.set_index('timestamp')
    df2.index = pd.to_datetime(df2.index)

# Import and run strategy
from strategies.TurtleSslDualStrategy import execute
pf, indicators = execute(df2, {"initial_capital": 10000})

# Check VectorBT trades
trades = pf.trades.records_readable
print(f"\nTotal VectorBT trades: {len(trades)}")
print("\nColumns:", list(trades.columns))
print("\nFirst 15 trades:")
cols = ['Entry Timestamp', 'Avg Entry Price', 'Exit Timestamp', 'Avg Exit Price', 'PnL', 'Return', 'Direction', 'Size']
for c in cols:
    if c not in trades.columns:
        cols.remove(c)
print(trades[cols].head(15).to_string())

# Check 2020 trades specifically
print("\n\n=== 2020 trades ===")
t2020 = trades[trades['Entry Timestamp'].astype(str).str.startswith('2020')]
print(f"2020 trades count: {len(t2020)}")
if len(t2020) > 0:
    print(t2020[cols].head(15).to_string())

# Cross-check: get actual close price at entry timestamps
print("\n\n=== Price verification ===")
for i, row in t2020.head(10).iterrows():
    entry_ts = pd.Timestamp(row['Entry Timestamp'])
    exit_ts = pd.Timestamp(row['Exit Timestamp'])
    
    # Find actual close price at those timestamps
    entry_close = df2.loc[entry_ts, 'close'] if entry_ts in df2.index else 'NOT FOUND'
    exit_close = df2.loc[exit_ts, 'close'] if exit_ts in df2.index else 'NOT FOUND'
    
    print(f"Trade {i}:")
    print(f"  Entry: {entry_ts} | VBT price: {row['Avg Entry Price']:.2f} | Actual close: {entry_close}")
    print(f"  Exit:  {exit_ts}  | VBT price: {row['Avg Exit Price']:.2f}  | Actual close: {exit_close}")
    print(f"  Direction: {row['Direction']} | PnL: {row['PnL']:.2f} | Return: {row['Return']:.6f}")
    print()
