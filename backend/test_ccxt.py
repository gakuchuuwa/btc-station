import ccxt
okx = ccxt.okx()
try:
    data = okx.fetch_ohlcv('BTC/USDT', '4h', limit=2000)
    print("Fetched:", len(data))
except Exception as e:
    print("Error:", e)
