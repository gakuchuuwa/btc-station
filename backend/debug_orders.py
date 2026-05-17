"""
Debug: Check how VectorBT handles order_size accumulation at same timestamp
"""
import pandas as pd
import numpy as np
import sys
sys.path.insert(0, '.')

from data_feeder import DataFeeder
from strategies.TurtleSslDualStrategy import execute, _rma, _ssl_channel, _macd, _obv_osc

feeder = DataFeeder('okx')
df = feeder.get_local_data('BTC/USDT', '4h')
df2 = df.copy()
if 'timestamp' in df2.columns:
    df2 = df2.set_index('timestamp')
    df2.index = pd.to_datetime(df2.index)

# Monkey-patch to capture raw orders
import vectorbt as vbt

p = {"initial_capital": 10000}
pf, indicators = execute(df2, p)

# Look at the raw order_size used by from_orders
# Let's re-extract by checking the portfolio's orders
orders = pf.orders.records_readable
print("=== VBT Orders (first 30) ===")
print(orders.head(30).to_string())

print("\n\n=== Checking for same-timestamp multiple orders ===")
ts_counts = orders['Timestamp'].value_counts()
dups = ts_counts[ts_counts > 1]
print(f"Timestamps with >1 order: {len(dups)}")
if len(dups) > 0:
    print(dups.head(20))
    print("\nDetailed view of duplicate-timestamp orders:")
    for ts in dups.head(5).index:
        print(f"\n--- {ts} ---")
        print(orders[orders['Timestamp'] == ts].to_string())

# Key finding: VBT accumulates order_size per timestamp
# If we have +qty (buy to open long) and then -qty (sell to close) at the same bar
# they may net out or create weird averaged prices

print("\n\n=== Trades around trade #21-24 (2020-02-05 to 2020-04-29) ===")
mask = (orders['Timestamp'] >= '2020-02-01') & (orders['Timestamp'] <= '2020-05-01')
print(orders[mask].to_string())

# Check portfolio value
print(f"\n\nFinal portfolio value: {pf.value().iloc[-1]:.2f}")
print(f"Initial cash: {pf.init_cash}")
print(f"Total return: {pf.total_return() * 100:.2f}%")
