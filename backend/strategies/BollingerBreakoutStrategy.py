"""
布林带突破策略 — BTC Station 内置模板

逻辑：
  收盘价突破上轨 → 顺势买入
  收盘价跌破中轨（MA）→ 止盈出场
  捕捉强势突破行情，假突破时损失小

提示：
  bb_period 控制带宽计算周期
  bb_std 越大带越宽，信号越少但越可靠
"""
from freqtrade.strategy import IStrategy, IntParameter, DecimalParameter
from pandas import DataFrame
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib


class BollingerBreakoutStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "4h"
    stake_currency = "USDT"
    minimal_roi = {"0": 100}
    stoploss = -0.12
    trailing_stop = True
    trailing_stop_positive = 0.03
    process_only_new_candles = True
    use_exit_signal = True
    can_short = False

    bb_period = IntParameter(10, 50, default=20, space="buy", optimize=True)
    bb_std     = DecimalParameter(1.5, 3.0, default=2.0, decimals=1, space="buy", optimize=True)

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        bb = qtpylib.bollinger_bands(
            qtpylib.typical_price(dataframe),
            window=self.bb_period.value,
            stds=self.bb_std.value,
        )
        dataframe["bb_upper"]  = bb["upper"]
        dataframe["bb_mid"]    = bb["mid"]
        dataframe["bb_lower"]  = bb["lower"]
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["close"] > dataframe["bb_upper"])
            & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["close"] < dataframe["bb_mid"]),
            "exit_long",
        ] = 1
        return dataframe
