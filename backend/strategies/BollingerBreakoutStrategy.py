"""
布林带突破策略 — VectorBT 格式

逻辑：收盘价跌破下轨买入（超卖），突破上轨卖出（超买）
调参建议：bb_period 10~40，bb_std 1.5~3.0
"""
import vectorbt as vbt


def execute(df, parameters):
    period = int(parameters.get("bb_period", 20))
    std    = float(parameters.get("bb_std", 2.0))

    bb = vbt.BBANDS.run(df["close"], window=period, alpha=std)

    entries = df["close"] < bb.lower
    exits   = df["close"] > bb.upper

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=10000, fees=0.0005,
    )

    return pf, {"上轨": bb.upper, "中轨": bb.middle, "下轨": bb.lower}
