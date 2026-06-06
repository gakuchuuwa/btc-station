"""快速验证 Railway 后端 max_drawdown_pct 和 closed_max_drawdown_pct"""
import json, urllib.request

# 先读取本地策略代码
with open("strategies/TurtleSslDualStrategy.py", encoding="utf-8") as f:
    code = f.read()

payload = json.dumps({
    "code": code,
    "symbol": "BTC/USDT",
    "timeframe": "4h",
    "parameters": {"start_date": "2019-12-16 13:00:00"},
}).encode()

req = urllib.request.Request(
    "https://btc-station-backend-production.up.railway.app/api/backtest/dynamic",
    data=payload,
    headers={"Content-Type": "application/json"},
)
resp = json.loads(urllib.request.urlopen(req, timeout=180).read().decode())
m = resp["metrics"]

print(f"max_drawdown_pct (浮动):         {m.get('max_drawdown_pct')}")
print(f"closed_max_drawdown_pct (结算):  {m.get('closed_max_drawdown_pct')}")
print(f"ftmo_drawdown_pct (绝对):        {m.get('ftmo_drawdown_pct')}")
print(f"max_drawdown_duration_days:      {m.get('max_drawdown_duration_days')}")
print(f"avg_drawdown_duration_days:      {m.get('avg_drawdown_duration_days')}")
print(f"avg_drawdown_pct:                {m.get('avg_drawdown_pct')}")
print(f"max_dd_profit_at_trough:         {m.get('max_dd_profit_at_trough')}")
