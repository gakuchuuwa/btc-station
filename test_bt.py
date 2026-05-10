import requests
import json

payload = {
    "strategy_id": "test",
    "timeframe": "4h",
    "timerange": "20230101-20231231",
    "market": "futures",
    "initial_capital": 10000,
    "leverage": 1
}

try:
    resp = requests.post("http://127.0.0.1:8000/api/backtests", json=payload)
    print("STATUS:", resp.status_code)
    print("RESPONSE:", resp.text)
except Exception as e:
    print("ERROR:", e)
