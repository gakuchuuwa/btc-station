import ccxt
okx = ccxt.okx()
try:
    data = okx.fetch_ohlcv('BTC/USDT', '4h', limit=300)
    print("Fetched 300:", len(data))
except Exception as e:
    print("Error 300:", e)

try:
    data = okx.fetch_ohlcv('BTC/USDT', '4h', limit=100)
    print("Fetched 100:", len(data))
except Exception as e:
    print("Error 100:", e)
