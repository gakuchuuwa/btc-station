"""
RSI 超买超卖策略 — VectorBT 格式

逻辑：RSI 低于 rsi_buy 超卖买入，高于 rsi_sell 超买卖出
调参建议：rsi_period 7~28，rsi_buy 20~40，rsi_sell 60~80
"""
import vectorbt as vbt


def execute(df, parameters):
    period = int(parameters.get("rsi_period", 14))
    buy    = float(parameters.get("rsi_buy", 30))
    sell   = float(parameters.get("rsi_sell", 70))

    rsi = vbt.RSI.run(df["close"], window=period)

    entries = rsi.rsi_below(buy)
    exits   = rsi.rsi_above(sell)

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=10000, fees=0.0005,
    )

    return pf, {"RSI": rsi.rsi}
