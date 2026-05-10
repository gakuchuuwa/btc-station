"""
MA 双均线交叉策略 — VectorBT 格式

逻辑：快线上穿慢线买入，快线下穿慢线卖出
调参建议：fast_period 5~60，slow_period 20~200
"""
import vectorbt as vbt


def execute(df, parameters):
    fast = int(parameters.get("fast_period", 20))
    slow = int(parameters.get("slow_period", 50))

    fast_ma = vbt.MA.run(df["close"], fast)
    slow_ma = vbt.MA.run(df["close"], slow)

    entries = fast_ma.ma_crossed_above(slow_ma)
    exits   = fast_ma.ma_crossed_below(slow_ma)

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=10000, fees=0.0005,
    )

    return pf, {"快线 MA": fast_ma.ma, "慢线 MA": slow_ma.ma}
