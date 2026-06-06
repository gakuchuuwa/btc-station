"""
MACD 金叉死叉策略 — BTC Station 内置模板

逻辑：
  MACD 线上穿信号线（金叉）→ 买入
  MACD 线下穿信号线（死叉）→ 卖出
  趋势跟踪策略，适合大行情，横盘磨损大

提示：
  fast/slow/signal 三参数组合影响灵敏度
  经典默认值 12/26/9
"""
from freqtrade.strategy import IStrategy, IntParameter
from pandas import DataFrame
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib


class MacdStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "4h"
    stake_currency = "USDT"
    minimal_roi = {"0": 100}
    stoploss = -0.15
    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    can_short = False

    macd_fast   = IntParameter(6,  20, default=12, space="buy", optimize=True)
    macd_slow   = IntParameter(18, 50, default=26, space="buy", optimize=True)
    macd_signal = IntParameter(5,  15, default=9,  space="buy", optimize=True)

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        macd = ta.MACD(
            dataframe,
            fastperiod=self.macd_fast.value,
            slowperiod=self.macd_slow.value,
            signalperiod=self.macd_signal.value,
        )
        dataframe["macd"]   = macd["macd"]
        dataframe["macds"]  = macd["macdsignal"]
        dataframe["macdh"]  = macd["macdhist"]
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            qtpylib.crossed_above(dataframe["macd"], dataframe["macds"]),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            qtpylib.crossed_below(dataframe["macd"], dataframe["macds"]),
            "exit_long",
        ] = 1
        return dataframe
