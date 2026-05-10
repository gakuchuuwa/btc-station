"""
DCA 定期定投策略 — VectorBT 格式

逻辑：每隔固定根K线买入一次，不主动卖出（适合验证长期持有效果）
调参建议：buy_every_n_bars 1~30（按K线根数，4h图则7=1周，30=1月）
"""
import vectorbt as vbt
import numpy as np


def execute(df, parameters):
    n = int(parameters.get("buy_every_n_bars", 7))

    entries = np.zeros(len(df), dtype=bool)
    entries[::n] = True
    exits = np.zeros(len(df), dtype=bool)

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=10000, fees=0.0005, accumulate=True,
    )

    return pf, {}
