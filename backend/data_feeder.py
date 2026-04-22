import ccxt
import pandas as pd
from typing import List, Dict, Any
import os

class DataFeeder:
    def __init__(self, exchange_id: str = 'binance'):
        # Initialize exchange via CCXT
        exchange_class = getattr(ccxt, exchange_id)
        self.exchange = exchange_class({
            'enableRateLimit': True,
        })
        # Local storage directory for K-lines
        self.data_dir = 'data'
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)

    def fetch_ohlcv(self, symbol: str = 'BTC/USDT', timeframe: str = '1h', limit: int = 1000) -> pd.DataFrame:
        """
        Fetches OHLCV (K-line) data from the exchange.
        """
        print(f"Fetching {limit} candles of {timeframe} for {symbol} from {self.exchange.id}...")
        ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
        
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        
        # Save to local CSV for caching
        safe_symbol = symbol.replace('/', '_')
        filepath = os.path.join(self.data_dir, f"{safe_symbol}_{timeframe}.csv")
        df.to_csv(filepath, index=False)
        print(f"Saved to {filepath}")
        
        return df

    def get_local_data(self, symbol: str = 'BTC/USDT', timeframe: str = '1h') -> pd.DataFrame:
        """
        Retrieves data from local cache if it exists.
        """
        safe_symbol = symbol.replace('/', '_')
        filepath = os.path.join(self.data_dir, f"{safe_symbol}_{timeframe}.csv")
        if os.path.exists(filepath):
            return pd.read_csv(filepath)
        return pd.DataFrame()

if __name__ == '__main__':
    # Test the feeder
    feeder = DataFeeder('binance')
    df = feeder.fetch_ohlcv('BTC/USDT', '1h', limit=100)
    print(df.head())
