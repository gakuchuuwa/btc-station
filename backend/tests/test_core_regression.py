"""核心回归测试：数据完整性、沙箱、鉴权、内置策略回测、K 线与调参 CSV。

运行（在仓库根目录）：
    ./backend/venv/Scripts/python.exe -m unittest backend/tests/test_core_regression.py -v
"""
import os
import sys
import unittest

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND_DIR)
os.chdir(BACKEND_DIR)

from fastapi.testclient import TestClient  # noqa: E402

import api_v31  # noqa: E402
import dynamic_runner  # noqa: E402
import main  # noqa: E402
from data_feeder import DataFeeder  # noqa: E402

# 不进入 with 块，不触发 lifespan，避免启动后台联网同步线程
client = TestClient(main.app)

TEMPLATE_DIR = os.path.join(BACKEND_DIR, "strategies")


def _template(name: str) -> str:
    with open(os.path.join(TEMPLATE_DIR, f"{name}.py"), encoding="utf-8") as f:
        return f.read()


SIMPLE_MA = '''
import vectorbt as vbt

def execute(df, parameters):
    fast = int(parameters.get("fast", 10))
    slow = int(parameters.get("slow", 30))
    f = vbt.MA.run(df["close"], fast)
    s = vbt.MA.run(df["close"], slow)
    pf = vbt.Portfolio.from_signals(
        df["close"], f.ma_crossed_above(s), f.ma_crossed_below(s),
        init_cash=27000, fees=0.0005,
    )
    return pf, {}
'''


class TestCoreRegression(unittest.TestCase):

    def test_1_data_integrity(self):
        fd = DataFeeder("okx")
        df = fd.get_local_data("BTC/USDT:USDT", "4h")
        self.assertGreater(len(df), 10000, "永续 4h K 线行数异常少（检查 NTFS ADS 问题）")
        fh = dynamic_runner._load_funding_history()
        self.assertIsNotNone(fh, "资金费率历史文件缺失")
        self.assertFalse(fh.empty)
        self.assertIn("timestamp", fh.columns)
        self.assertIn("funding_rate", fh.columns)

    def test_2_sandbox_blocks_dangerous_code(self):
        bad_snippets = [
            "import os",
            "x = ().__class__",
            "f = open('a')",
            "def execute(df, p):\n    df.to_csv('a')",
            "import pandas as pd\npd.read_csv('a')",
        ]
        for code in bad_snippets:
            with self.assertRaises(ValueError, msg=f"沙箱未拦截：{code!r}"):
                dynamic_runner._validate_safe_ast(code)

    def test_3_forged_jwt_rejected(self):
        fake = ("eyJhbGciOiJIUzI1NiJ9."
                "eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAifQ.fake")
        old = api_v31.DEV_MODE
        api_v31.DEV_MODE = False
        try:
            r = client.get("/api/strategies", headers={"Authorization": f"Bearer {fake}"})
            self.assertEqual(r.status_code, 401, "伪造 Token 必须返回 401")
            r = client.get("/api/strategies")
            self.assertEqual(r.status_code, 401, "未带 Token 必须返回 401")
        finally:
            api_v31.DEV_MODE = old

    def _run_template(self, name):
        r = client.post("/api/backtest/dynamic", json={
            "code": _template(name), "symbol": "BTC/USDT", "timeframe": "4h", "parameters": {},
        })
        self.assertEqual(r.status_code, 200, r.text[:300])
        return r.json()

    def test_4_builtin_strategies_backtest(self):
        for name in ("TurtleSslDualStrategy", "FixedQtyStrategy"):
            data = self._run_template(name)
            m = data["metrics"]
            self.assertGreater(m["total_trades"], 30, f"{name} 交易笔数异常少")
            self.assertGreater(m.get("closed_max_drawdown_pct") or 0, 0, f"{name} 缺少已平仓回撤")
            if name == "TurtleSslDualStrategy":
                raw = m.get("raw_parameters", {})
                self.assertEqual(float(raw.get("base_risk_percent")), 5.0)

    def test_5_templates_candles_and_optimize_csv(self):
        r = client.get("/api/templates")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()), 2)

        r = client.get("/api/candles/4h")
        self.assertEqual(r.status_code, 200)
        self.assertGreater(len(r.json()["candles"]), 10000)

        r = client.post("/api/optimize", json={
            "code": SIMPLE_MA, "symbol": "BTC/USDT", "timeframe": "4h",
            "grid": {"fast": {"start": 10, "stop": 20, "step": 10},
                     "slow": {"start": 30, "stop": 30, "step": 1}},
            "method": "grid", "target": "net_profit_pct",
        })
        self.assertEqual(r.status_code, 200, r.text[:300])
        token = r.json().get("csv_token")
        self.assertTrue(token, "调参结果缺少 csv_token")

        r = client.get(f"/api/optimize/export-csv?token={token}")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Total P&L", r.text.splitlines()[0])


if __name__ == "__main__":
    unittest.main()
