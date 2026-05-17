import pandas as pd

df = pd.read_csv('data/BTC_USDT_4h.csv')
print('Date range:')
print(f'First: {df.timestamp.iloc[0]}')
print(f'Last: {df.timestamp.iloc[-1]}')
print(f'Total rows: {len(df)}')
print()

# Check 2020 data
mask2020 = df.timestamp.str.startswith('2020')
d2020 = df[mask2020]
print(f'2020 rows: {len(d2020)}')
if len(d2020) > 0:
    print('First few 2020:')
    print(d2020[['timestamp','close']].head(5))
    print('Last few 2020:')
    print(d2020[['timestamp','close']].tail(5))

# Check 2021 data
print()
mask2021 = df.timestamp.str.startswith('2021')
d2021 = df[mask2021]
print(f'2021 rows: {len(d2021)}')
if len(d2021) > 0:
    print('First few 2021:')
    print(d2021[['timestamp','close']].head(5))
    print('Last few 2021:')
    print(d2021[['timestamp','close']].tail(5))

# Now run a quick backtest and check trade entry prices
print('\n--- Running quick backtest to check trade prices ---')
import vectorbt as vbt

if 'timestamp' in df.columns:
    df = df.set_index('timestamp')
    df.index = pd.to_datetime(df.index)

fast_ma = vbt.MA.run(df["close"], 10)
slow_ma = vbt.MA.run(df["close"], 30)
entries = fast_ma.ma_crossed_above(slow_ma)
exits = fast_ma.ma_crossed_below(slow_ma)
pf = vbt.Portfolio.from_signals(df["close"], entries, exits, init_cash=10000, fees=0.0005)

trades = pf.trades.records_readable
print(f'\nTotal trades: {len(trades)}')
print('\nFirst 10 trades columns:', list(trades.columns))
print('\nFirst 10 trades:')
print(trades[['Entry Timestamp', 'Avg Entry Price', 'Avg Exit Price', 'PnL', 'Direction']].head(10))
