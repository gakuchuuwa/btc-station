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

    def fetch_ohlcv(self, symbol: str = 'BTC/USDT', timeframe: str = '1h', limit: int = 1500) -> pd.DataFrame:
        """
        Fetches OHLCV (K-line) data from the exchange with pagination to handle large limits.
        Intelligently updates cache if sufficient data already exists.
        """
        safe_symbol = symbol.replace('/', '_')
        filepath = os.path.join(self.data_dir, f"{safe_symbol}_{timeframe}.csv")
        
        cached_df = pd.DataFrame()
        if os.path.exists(filepath):
            cached_df = pd.read_csv(filepath)
            
        # 1. SMART UPDATE: If we already have a large enough cache, just fetch the latest 100 candles
        if not cached_df.empty and len(cached_df) >= limit * 0.8:
            print(f"Cache found with {len(cached_df)} rows. Quick updating latest candles...")
            try:
                recent_ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, limit=100)
                recent_df = pd.DataFrame(recent_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                recent_df['timestamp'] = pd.to_datetime(recent_df['timestamp'], unit='ms')
                
                cached_df['timestamp'] = pd.to_datetime(cached_df['timestamp'])
                df = pd.concat([cached_df, recent_df]).drop_duplicates(subset=['timestamp'], keep='last')
                df = df.sort_values('timestamp').tail(limit)
                
                df.to_csv(filepath, index=False)
                return df
            except Exception as e:
                print(f"Error during quick update, falling back to full fetch: {e}")

        # 2. FULL FETCH: If cache is missing or too small, paginate to get the full history
        print(f"Fetching {limit} candles of {timeframe} for {symbol} from {self.exchange.id} (may take a while)...")
        all_ohlcv = []
        try:
            tf_ms = self.exchange.parse_timeframe(timeframe) * 1000
            now_ms = self.exchange.milliseconds()
            since = now_ms - (limit * tf_ms)
            
            while len(all_ohlcv) < limit:
                fetch_limit = min(limit - len(all_ohlcv), 100)
                batch = self.exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=fetch_limit)
                
                if not batch or len(batch) == 0:
                    break
                    
                all_ohlcv.extend(batch)
                since = batch[-1][0] + tf_ms  # Next candle timestamp
                
                import time
                time.sleep(self.exchange.rateLimit / 1000.0)
                
        except Exception as e:
            print(f"Error during pagination fetch: {e}")
            
        if not all_ohlcv:
            all_ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, limit=min(limit, 300))
            
        df = pd.DataFrame(all_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.to_csv(filepath, index=False)
        print(f"Saved {len(df)} rows to {filepath}")
        return df

    def get_local_data(self, symbol: str = 'BTC/USDT', timeframe: str = '1h') -> pd.DataFrame:
        """
        Retrieves data from local cache if it exists.
        """
        safe_symbol = symbol.replace('/', '_')
        filepath = os.path.join(self.data_dir, f"{safe_symbol}_{timeframe}.csv")
        if os.path.exists(filepath):
            df = pd.read_csv(filepath)
            # Ensure timestamp is parsed as datetime (consistent with freshly fetched data)
            if 'timestamp' in df.columns:
                df['timestamp'] = pd.to_datetime(df['timestamp'])
            return df
        return pd.DataFrame()

    def preload_cache(self, symbol: str = 'BTC/USDT', timeframes: List[str] = ['1h', '4h', '1d'], limit: int = 16500):
        """
        [SaaS Upgrade] Global background method to fetch and update huge datasets into the cache.
        Should be run async on server startup.
        """
        print(f"[Data Syncer] Preloading cache for {symbol} across {timeframes} (limit={limit})...")
        for tf in timeframes:
            try:
                self.fetch_ohlcv(symbol, tf, limit=limit)
                print(f"[Data Syncer] OK {tf} synchronized.")
            except Exception as e:
                print(f"[Data Syncer] ERR syncing {tf}: {e}")


if __name__ == '__main__':
    # Test the feeder
    feeder = DataFeeder('binance')
    df = feeder.fetch_ohlcv('BTC/USDT', '1h', limit=100)
    print(df.head())
