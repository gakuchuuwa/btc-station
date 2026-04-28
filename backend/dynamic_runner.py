import types
import importlib.util
import traceback
import pandas as pd
import math

def _clean_float(val):
    if pd.isna(val) or math.isnan(val):
        return 0.0
    return float(val)

def run_dynamic_code(code_string: str, df, parameters: dict):
    """
    Executes a user-provided python strategy string dynamically.
    The string MUST contain a function named 'execute(df, parameters)'.
    
    execute() can return:
      - A vbt.Portfolio object (standard)
      - A tuple (portfolio, indicators) where indicators is a dict:
          {
            "S1 High": pd.Series(...),   # overlay line on chart
            "S2 High": pd.Series(...),
          }
    """
    try:
        module_name = "dynamic_strategy"
        spec = importlib.util.spec_from_loader(module_name, loader=None)
        dynamic_module = importlib.util.module_from_spec(spec)
        exec(code_string, dynamic_module.__dict__)
        
        if not hasattr(dynamic_module, 'execute'):
            raise ValueError("Your code must contain a function named 'execute(df, parameters)'.")
            
        result = dynamic_module.execute(df, parameters)
        
        # Support tuple return: (portfolio, indicators_dict)
        if isinstance(result, tuple) and len(result) == 2:
            portfolio, raw_indicators = result
        else:
            portfolio, raw_indicators = result, {}

        # --- Format portfolio metrics ---
        stats = portfolio.stats()
        trades_df = portfolio.trades.records_readable
        
        trades_list = []
        if not trades_df.empty:
            trades_df['Entry Timestamp'] = trades_df['Entry Timestamp'].astype(str)
            trades_df['Exit Timestamp'] = trades_df['Exit Timestamp'].astype(str)
            if 'Direction' in trades_df.columns:
                trades_df['Direction'] = trades_df['Direction'].astype(str).str.replace('Direction.', '', regex=False)
            trades_list = trades_df.to_dict(orient='records')

        # --- Format indicator series for chart overlay ---
        # Each indicator must be a pd.Series with a DatetimeIndex
        indicators_out = {}
        if raw_indicators and isinstance(raw_indicators, dict):
            for name, series in raw_indicators.items():
                if not isinstance(series, pd.Series):
                    continue
                points = []
                for ts, val in series.items():
                    try:
                        if pd.isna(val):
                            continue
                        if hasattr(ts, 'timestamp'):
                            t = int(ts.timestamp())
                        else:
                            t = int(pd.Timestamp(str(ts)).timestamp())
                        points.append({"time": t, "value": round(float(val), 6)})
                    except Exception:
                        continue
                indicators_out[name] = sorted(points, key=lambda x: x["time"])

        results = {
            "metrics": {
                "total_return_pct": _clean_float(stats.get("Total Return [%]", 0.0)),
                "win_rate_pct": _clean_float(stats.get("Win Rate [%]", 0.0)),
                "max_drawdown_pct": _clean_float(stats.get("Max Drawdown [%]", 0.0)),
                "total_trades": int(stats.get("Total Trades", 0))
            },
            "trades": trades_list,
            "indicators": indicators_out,
        }
        return results, None
    except Exception as e:
        error_msg = traceback.format_exc()
        return None, error_msg

