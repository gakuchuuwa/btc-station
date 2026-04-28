import pandas as pd
import numpy as np

class VectorBTTurtle:
    """
    Core VectorBT Engine for the Turtle S1/S2 Strategy.
    """
    def __init__(self, df: pd.DataFrame):
        self.df = df.copy()
        # Ensure we have datetime index for vbt
        if 'timestamp' in self.df.columns:
            self.df.set_index('timestamp', inplace=True)
            
    def run_backtest(self, s1_period: int = 55, s2_period: int = 144):
        high = self.df['high']
        low = self.df['low']
        close = self.df['close']
        
        # Calculate Donchian Channels (shifted by 1 to prevent look-ahead bias, identical to Pine Script [1])
        s1_high = high.rolling(window=s1_period).max().shift(1)
        s1_low = low.rolling(window=s1_period).min().shift(1)
        
        s2_high = high.rolling(window=s2_period).max().shift(1)
        s2_low = low.rolling(window=s2_period).min().shift(1)
        
        # S1 Breakout Logic (Long Only for MVP baseline)
        # s1_breakout_long = close > s1_high_long and close[1] <= s1_high_long[1]
        entries = (close > s1_high) & (close.shift(1) <= s1_high.shift(1))
        
        # Simple exit logic for MVP: Price drops below S1 low (like standard Turtle)
        exits = (close < s1_low) & (close.shift(1) >= s1_low.shift(1))
        
        # Build VectorBT Portfolio (lazy import — not supported on Python 3.13)
        import vectorbt as vbt
        portfolio = vbt.Portfolio.from_signals(
            close,
            entries,
            exits,
            init_cash=10000,
            fees=0.0006,
            freq='1h'
        )

        stats = portfolio.stats()
        trades = portfolio.trades.records_readable
        
        # Convert Timestamp columns to strings for JSON serialization
        trades_list = []
        if not trades.empty:
            trades['Entry Timestamp'] = trades['Entry Timestamp'].astype(str)
            trades['Exit Timestamp'] = trades['Exit Timestamp'].astype(str)
            if 'Direction' in trades.columns:
                trades['Direction'] = trades['Direction'].astype(str).str.replace('Direction.', '', regex=False)
            trades_list = trades.to_dict(orient='records')
        
        return {
            "Total Return [%]": stats.get('Total Return [%]', 0),
            "Win Rate [%]": stats.get('Win Rate [%]', 0),
            "Max Drawdown [%]": stats.get('Max Drawdown [%]', 0),
            "Total Trades": stats.get('Total Trades', 0),
            "trades": trades_list
        }
