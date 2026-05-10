"""
MACD 金叉死叉策略 — VectorBT 格式

逻辑：MACD 线上穿信号线（金叉）买入，下穿（死叉）卖出
调参建议：fast 8~16，slow 20~34，signal 7~12
"""
import vectorbt as vbt


def execute(df, parameters):
    fast   = int(parameters.get("fast", 12))
    slow   = int(parameters.get("slow", 26))
    signal = int(parameters.get("signal", 9))

    macd = vbt.MACD.run(
        df["close"],
        fast_window=fast,
        slow_window=slow,
        signal_window=signal,
    )

    entries = macd.macd_above(macd.signal)
    exits   = macd.macd_below(macd.signal)

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=10000, fees=0.0005,
    )

    return pf, {"MACD": macd.macd, "Signal": macd.signal}
