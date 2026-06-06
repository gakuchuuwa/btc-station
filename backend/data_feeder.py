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
            'options': {'defaultType': 'swap'},  # 永续合约
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
        # 剥离永续后缀（同 get_local_data，避免 Windows NTFS ADS 问题）
        clean_symbol = symbol.split(':')[0]
        safe_symbol = clean_symbol.replace('/', '_')
        filepath = os.path.join(self.data_dir, f"{safe_symbol}_{timeframe}.csv")

        cached_df = pd.DataFrame()
        if os.path.exists(filepath):
            cached_df = pd.read_csv(filepath)
            
        # 1. SMART UPDATE: If we already have a large enough cache, just fetch the latest 300 candles
        if not cached_df.empty and len(cached_df) > 1000:
            print(f"Cache found with {len(cached_df)} rows. Quick updating latest candles...")
            try:
                recent_ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, limit=300)
                recent_df = pd.DataFrame(recent_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                recent_df['timestamp'] = pd.to_datetime(recent_df['timestamp'], unit='ms', utc=True).dt.tz_localize(None)

                cached_df['timestamp'] = pd.to_datetime(cached_df['timestamp']).dt.tz_localize(None)
                df = pd.concat([cached_df, recent_df]).drop_duplicates(subset=['timestamp'], keep='last')
                df = df.sort_values('timestamp').tail(limit)
                
                df.to_csv(filepath, index=False)
                return df
            except Exception as e:
                print(f"Error during quick update, falling back to full fetch: {e}")

        # 2. FULL FETCH: 反向分页——从最新往过去拉，避免 since 设得太早（如交易对未上线日期）导致首批返回空
        print(f"Fetching {limit} candles of {timeframe} for {symbol} from {self.exchange.id} (may take a while)...")
        all_ohlcv = []
        try:
            tf_ms = self.exchange.parse_timeframe(timeframe) * 1000
            import time

            # 第一批：不带 since，OKX 返回最近 ~300 根（最新数据）
            batch = self.exchange.fetch_ohlcv(symbol, timeframe, limit=300)
            if batch:
                all_ohlcv = list(batch)

            # 后续批次：用 since 反向往过去拉
            # 关键：OKX 公共接口 /market/candles 只有最近约 8 个月数据；要拿更早的历史
            # 必须走 /market/history-candles，CCXT 在传 since（不传 until）时会自动路由到该接口
            # Railway 等海外节点访问 OKX 限流更严，遇到 50011 Too Many Requests 必须退避重试
            batch_interval_sec = 0.5  # 拉取间隔 500ms（本地 100ms 在 Railway 上会触发限流）
            while all_ohlcv and len(all_ohlcv) < limit:
                earliest_ms = all_ohlcv[0][0]
                next_since = earliest_ms - 300 * tf_ms

                older = None
                for attempt in range(4):  # 最多 4 次尝试：原始 + 3 次重试
                    try:
                        older = self.exchange.fetch_ohlcv(
                            symbol, timeframe, since=next_since, limit=300
                        )
                        break  # 成功，跳出重试循环
                    except Exception as inner:
                        msg = str(inner)
                        if '50011' in msg or 'Too Many Requests' in msg:
                            # 指数退避：1s, 2s, 4s, 8s
                            backoff = 2 ** attempt
                            print(f"  OKX 限流 (attempt {attempt+1}/4)，等待 {backoff}s 后重试...")
                            time.sleep(backoff)
                            continue
                        # 非限流错误，直接放弃
                        print(f"  Reverse pagination hit non-rate-limit error, stop: {inner}")
                        older = None
                        break

                if older is None:
                    # 4 次重试都失败 → 当前进度保存到 CSV，不再继续
                    print(f"  连续重试失败，停止反向分页。已收集 {len(all_ohlcv)} 根。")
                    break

                if not older:
                    break  # 到达交易对最早数据
                # 过滤已存在的时间戳，防御去重
                existing_ts = {row[0] for row in all_ohlcv}
                new_rows = [row for row in older if row[0] not in existing_ts]
                if not new_rows:
                    break  # 没有更早数据
                all_ohlcv = sorted(new_rows + all_ohlcv, key=lambda r: r[0])
                time.sleep(batch_interval_sec)

        except Exception as e:
            print(f"Error during pagination fetch: {e}")

        if not all_ohlcv:
            all_ohlcv = self.exchange.fetch_ohlcv(symbol, timeframe, limit=min(limit, 300))
            
        df = pd.DataFrame(all_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms', utc=True).dt.tz_localize(None)
        df.to_csv(filepath, index=False)
        print(f"Saved {len(df)} rows to {filepath}")
        return df

    # Global memory cache to prevent repetitive I/O and parsing
    _df_cache: Dict[str, pd.DataFrame] = {}
    _df_mtime: Dict[str, float] = {}

    def get_local_data(self, symbol: str = 'BTC/USDT', timeframe: str = '1h') -> pd.DataFrame:
        """
        Retrieves data from local cache if it exists.
        Windows NTFS 不支持冒号文件名，含 ':USDT' 等永续后缀的 symbol 会被解析为 ADS 流，
        导致读到不完整数据。这里统一剥离 ':XXX' 后缀，回退到现货文件名。
        """
        # 永续合约后缀（如 BTC/USDT:USDT）在 Windows 上会触发 NTFS ADS，必须剥离
        clean_symbol = symbol.split(':')[0]
        safe_symbol = clean_symbol.replace('/', '_')
        filepath = os.path.join(self.data_dir, f"{safe_symbol}_{timeframe}.csv")
        
        if os.path.exists(filepath):
            # Check memory cache first
            current_mtime = os.path.getmtime(filepath)
            if filepath in DataFeeder._df_cache and DataFeeder._df_mtime.get(filepath) == current_mtime:
                return DataFeeder._df_cache[filepath].copy()

            # Cache miss or file updated -> Read from disk
            df = pd.read_csv(filepath)
            if 'timestamp' in df.columns:
                df['timestamp'] = pd.to_datetime(df['timestamp']).dt.tz_localize(None)
            
            # Save to memory cache
            DataFeeder._df_cache[filepath] = df
            DataFeeder._df_mtime[filepath] = current_mtime
            
            return df.copy()
        return pd.DataFrame()

    def preload_cache(self, symbol: str = 'BTC/USDT', timeframes: List[str] = ['1h', '4h', '1d'], limit: int = 16500):
        """
        [SaaS Upgrade] Global background method to fetch and update huge datasets into the cache.
        Should be run async on server startup.
        每个周期所需本数（从2018年起）：1h≈70000，4h≈18000，1d≈3000
        """
        import time
        # 每个周期独立设定本数，覆盖 2018 年至今
        tf_limits = {
            '1m':  500000,
            '5m':  100000,
            '15m':  35000,
            '1h':   70000,
            '4h':   18000,
            '1d':    3000,
            '1w':     500,
        }
        
        while True:
            for tf in timeframes:
                tf_limit = tf_limits.get(tf, limit)
                print(f"[Data Syncer] Preloading {symbol} {tf} (limit={tf_limit})...")
                try:
                    self.fetch_ohlcv(symbol, tf, limit=tf_limit)
                    print(f"[Data Syncer] OK {tf} synchronized.")
                except Exception as e:
                    print(f"[Data Syncer] ERR syncing {tf}: {e}")
            
            print("[Data Syncer] Next sync in 1 hour...")
            time.sleep(3600)


if __name__ == '__main__':
    # Test the feeder
    feeder = DataFeeder('binance')
    df = feeder.fetch_ohlcv('BTC/USDT', '1h', limit=100)
    print(df.head())
