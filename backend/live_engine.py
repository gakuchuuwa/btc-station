import os
import time
import ccxt
import requests
import traceback
import importlib
import pandas as pd
from dotenv import load_dotenv
from data_feeder import DataFeeder

# Load environment variables
load_dotenv()

OKX_API_KEY = os.getenv('OKX_API_KEY')
OKX_SECRET = os.getenv('OKX_SECRET')
OKX_PASSWORD = os.getenv('OKX_PASSWORD')
TELEGRAM_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID')

SYMBOL = os.getenv('SYMBOL', 'BTC/USDT')
TIMEFRAME = os.getenv('TIMEFRAME', '1h')
TRADE_SIZE = float(os.getenv('TRADE_SIZE_BTC', '0.01'))

def send_telegram_msg(msg):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print(f"[Telegram Not Configured] {msg}")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": msg}
    try:
        requests.post(url, json=payload)
    except Exception as e:
        print(f"Failed to send telegram message: {e}")

def init_exchange():
    exchange = ccxt.okx({
        'apiKey': OKX_API_KEY,
        'secret': OKX_SECRET,
        'password': OKX_PASSWORD,
        'enableRateLimit': True,
    })
    # Optional: Test authentication
    try:
        balance = exchange.fetch_balance()
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] OKX Authentication Successful.")
    except Exception as e:
        print(f"OKX Auth Failed (Are keys valid?): {e}")
        # We don't exit here so the user can run dry-run without valid keys
    return exchange

def execute_live_cycle(exchange, feeder, parameters):
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Waking up. Fetching latest {TIMEFRAME} data for {SYMBOL}...")
    
    # 1. Fetch fresh data
    try:
        df = feeder.fetch_ohlcv(SYMBOL, TIMEFRAME, limit=200)
    except Exception as e:
        print(f"Error fetching data: {e}")
        return

    # 2. Load custom strategy dynamically
    try:
        import custom_strategy
        importlib.reload(custom_strategy) # Reload to get latest saved changes
    except ImportError:
        print("custom_strategy.py not found! Please save a strategy from the UI first.")
        return
    except Exception as e:
        print(f"Error loading custom_strategy.py: {e}")
        return

    # 3. Run Strategy
    try:
        portfolio = custom_strategy.execute(df, parameters)
        entries = portfolio.entries
        exits = portfolio.exits
        
        # 4. Check signals on the CURRENT (latest) closed candle
        # Typically, index -1 is the current forming candle, -2 is the last closed candle.
        # But depending on strategy logic, we check the last signal. Let's check iloc[-1].
        last_entry = entries.iloc[-1]
        last_exit = exits.iloc[-1]
        current_price = df['close'].iloc[-1]
        
        # --- DRY RUN LOGIC (replace with real exchange.create_market_order() when ready) ---
        if last_entry:
            msg = f"🟢 [LONG SIGNAL] {SYMBOL} @ {current_price}\nExecuting BUY for {TRADE_SIZE} BTC."
            print(msg)
            send_telegram_msg(msg)
            # exchange.create_market_buy_order(SYMBOL, TRADE_SIZE)
            
        elif last_exit:
            msg = f"🔴 [CLOSE SIGNAL] {SYMBOL} @ {current_price}\nExecuting SELL."
            print(msg)
            send_telegram_msg(msg)
            # exchange.create_market_sell_order(SYMBOL, TRADE_SIZE) # simplified
            
        else:
            print("No signal generated on this candle.")
            
    except Exception as e:
        error_msg = f"⚠️ [STRATEGY ERROR]\n{traceback.format_exc()}"
        print(error_msg)
        send_telegram_msg(error_msg)

if __name__ == "__main__":
    print("=========================================")
    print("   BTC Quant Platform - Live Engine      ")
    print("=========================================")
    print(f"Target: {SYMBOL} | Interval: {TIMEFRAME}")
    
    feeder = DataFeeder('okx') # Switch to OKX for data fetching
    exchange = init_exchange()
    
    send_telegram_msg("🚀 Live Engine Started.")
    
    # Define default parameters (you can load these from a DB or file later)
    current_parameters = {"s1_period": 55, "s2_period": 144}
    
    # The Daemon Loop
    while True:
        execute_live_cycle(exchange, feeder, current_parameters)
        
        # Sleep until next candle close
        sleep_map = {'1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400}
        sleep_seconds = sleep_map.get(TIMEFRAME, 3600)
        print(f"Going to sleep for {sleep_seconds}s ({TIMEFRAME} interval)...")
        time.sleep(sleep_seconds)
