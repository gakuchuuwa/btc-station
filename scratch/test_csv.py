import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend")))
from csv_converter import freqtrade_json_to_tv_csv

raw = {
    "strategy_comparison": [{"profit_total": 0.05, "max_drawdown_account": 0.01}],
    "trades": [
        {
            "is_short": False,
            "profit_ratio": 0.05,
            "profit_abs": 500,
            "is_stop_loss": False,
            "funding_fees": 0,
            "open_date": "2024-01-01 00:00:00",
            "close_date": "2024-01-02 00:00:00",
            "open_rate": 40000,
            "close_rate": 42000
        }
    ]
}

try:
    csv = freqtrade_json_to_tv_csv(raw)
    print("Success, length:", len(csv))
except Exception as e:
    import traceback
    traceback.print_exc()
