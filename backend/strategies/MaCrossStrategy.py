"""
MA 双均线交叉策略 — BTC Station 内置模板

逻辑：
  快线上穿慢线 → 买入做多
  快线下穿慢线 → 平多出场
  适合中长期趋势行情，横盘时频繁假信号

提示：
  修改 fast_period / slow_period 找最优周期组合
  ma_type 可切换 SMA（简单）或 EMA（更敏感）
"""
from freqtrade.strategy import IStrategy, IntParameter, CategoricalParameter
from pandas import DataFrame
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib


class MaCrossStrategy(IStrategy):
    INTERFACE_VERSION = 3
    # timeframe is injected by the backtest config; do not hardcode here
    stake_currency = "USDT"
    minimal_roi = {"0": 100}
    stoploss = -0.15
    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False
    can_short = False

    fast_period = IntParameter(5, 60, default=20, space="buy", optimize=True)
    slow_period = IntParameter(20, 200, default=50, space="buy", optimize=True)
    ma_type = CategoricalParameter(["SMA", "EMA"], default="EMA", space="buy", optimize=True)

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        ma_func = ta.SMA if self.ma_type.value == "SMA" else ta.EMA
        dataframe["fast_ma"] = ma_func(dataframe, timeperiod=self.fast_period.value)
        dataframe["slow_ma"] = ma_func(dataframe, timeperiod=self.slow_period.value)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            qtpylib.crossed_above(dataframe["fast_ma"], dataframe["slow_ma"]),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            qtpylib.crossed_below(dataframe["fast_ma"], dataframe["slow_ma"]),
            "exit_long",
        ] = 1
        return dataframe
