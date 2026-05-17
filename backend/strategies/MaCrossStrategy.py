"""
MA 双均线交叉策略 — VectorBT 格式

逻辑：快线上穿慢线买入，快线下穿慢线卖出
调参建议：fast_period 5~60，slow_period 20~200
"""
import vectorbt as vbt


def execute(df, parameters):
    fast = int(parameters.get("fast_period", 20))
    slow = int(parameters.get("slow_period", 50))
    init_cash = float(parameters.get("initial_capital", 10000))

    close = df["close"]

    fast_ma = close.rolling(fast).mean()
    slow_ma = close.rolling(slow).mean()

    entries = (fast_ma > slow_ma) & (fast_ma.shift(1) <= slow_ma.shift(1))
    exits   = (fast_ma < slow_ma) & (fast_ma.shift(1) >= slow_ma.shift(1))

    pf = vbt.Portfolio.from_signals(
        close, entries, exits,
        init_cash=init_cash, fees=0.0005,
    )

    return pf, {"快线 MA": fast_ma, "慢线 MA": slow_ma}
