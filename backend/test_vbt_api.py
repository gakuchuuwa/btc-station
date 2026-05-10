import requests

url = "http://127.0.0.1:8000/api/vbt/optimize_strategy_csv"
payload = {
    "symbol": "BTC/USDT",
    "timeframe": "4h",
    "fast_ma_range": [10, 20],
    "slow_ma_range": [30, 40],
    "initial_capital": 10000.0
}

print(f"Testing VectorBT Optimization Endpoint at {url}...")
try:
    response = requests.post(url, json=payload)
    if response.status_code == 200:
        print("Success! CSV Content starts with:")
        print(response.text[:500])
        with open("test_output.csv", "w", encoding="utf-8") as f:
            f.write(response.text)
        print("Full CSV saved to test_output.csv")
    else:
        print(f"Failed with status {response.status_code}")
        print(response.text)
except requests.exceptions.ConnectionError:
    print("Backend server is not running. Please start it with 'uvicorn main:app --reload'")
