import ccxt
import time
exchange = ccxt.okx({'enableRateLimit': True})
symbol = 'BTC/USDT'
timeframe = '4h'
limit = 1500

tf_ms = exchange.parse_timeframe(timeframe) * 1000
now_ms = exchange.milliseconds()
since = now_ms - (limit * tf_ms)

all_ohlcv = []
while len(all_ohlcv) < limit:
    fetch_limit = min(limit - len(all_ohlcv), 100)
    batch = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=fetch_limit)
    if not batch or len(batch) == 0:
        print("Empty batch, breaking")
        break
    all_ohlcv.extend(batch)
    since = batch[-1][0] + tf_ms
    print(f"Fetched {len(batch)}, total {len(all_ohlcv)}, next since: {since}")
    time.sleep(exchange.rateLimit / 1000.0)

print(f"Total fetched: {len(all_ohlcv)}")
