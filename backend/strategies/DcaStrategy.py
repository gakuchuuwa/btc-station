"""
DCA 定期定投策略 — VectorBT 格式

逻辑：每隔固定根K线买入一次，不主动卖出（适合验证长期持有效果）
调参建议：buy_every_n_bars 1~30（按K线根数，4h图则7=1周，30=1月）

资金/仓位约定（与所有内置策略统一）：
- init_cash         : 初始资金（USDT），默认 10000
- position_size_pct : 每次定投使用当前权益的百分比（0-100），默认 10 = 每次买入 10% 权益
                      ⚠ 与其他策略不同：DCA 是累积买入，100% 会一根 K 线把资金花光
- fees              : 单边手续费率，默认 0.0005 = 0.05%
"""
import vectorbt as vbt
import numpy as np


def execute(df, parameters):
    # ── 资金/仓位（统一参数，但 DCA 默认仓位低）──
    init_cash         = float(parameters.get("init_cash", 10000))
    position_size_pct = float(parameters.get("position_size_pct", 10))  # DCA 例外:每次只用 10%
    fees              = float(parameters.get("fees", 0.0005))

    # ── 策略参数 ──
    n = int(parameters.get("buy_every_n_bars", 7))

    entries = np.zeros(len(df), dtype=bool)
    entries[::n] = True
    exits = np.zeros(len(df), dtype=bool)

    pf = vbt.Portfolio.from_signals(
        df["close"], entries, exits,
        init_cash=init_cash,
        fees=fees,
        size=position_size_pct / 100.0,
        size_type='percent',
        accumulate=True,
    )

    return pf, {}
