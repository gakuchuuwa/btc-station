"""
RSI 超买超卖策略 — BTC Station 内置模板

逻辑：
  RSI 跌破下限 → 超卖买入
  RSI 涨破上限 → 超买卖出
  经典均值回归策略，在震荡行情表现较好

提示：
  rsi_period 越小越灵敏，越大越滞后
  buy_rsi / sell_rsi 控制入出场灵敏度
"""
from freqtrade.strategy import IStrategy, IntParameter, DecimalParameter
from pandas import DataFrame
import talib.abstract as ta


class RsiStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "4h"
    stake_currency = "USDT"
    minimal_roi = {"0": 100}
    stoploss = -0.15
    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    can_short = False

    rsi_period = IntParameter(7, 30, default=14, space="buy", optimize=True)
    buy_rsi    = DecimalParameter(20, 45, default=30, decimals=0, space="buy", optimize=True)
    sell_rsi   = DecimalParameter(55, 85, default=70, decimals=0, space="sell", optimize=True)

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=self.rsi_period.value)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["rsi"] < self.buy_rsi.value) & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["rsi"] > self.sell_rsi.value),
            "exit_long",
        ] = 1
        return dataframe
