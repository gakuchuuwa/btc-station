"""
ATR 通道 + 动态止损策略 — BTC Station 内置模板

逻辑：
  价格突破 EMA + ATR 倍数上方 → 买入
  价格跌破 EMA 中线 → 出场
  止损 = 入场价 - atr_stop_mult × ATR（动态止损）

提示：
  atr_period 控制波动率计算窗口
  channel_mult 越大要求突破越强，信号越少
  atr_stop_mult 控制止损宽度
"""
from freqtrade.strategy import IStrategy, IntParameter, DecimalParameter
from pandas import DataFrame
import talib.abstract as ta
import numpy as np


class AtrChannelStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "4h"
    stake_currency = "USDT"
    minimal_roi = {"0": 100}
    stoploss = -0.20
    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    use_custom_stoploss = True
    can_short = False

    atr_period    = IntParameter(7,  28, default=14,  space="buy", optimize=True)
    ema_period    = IntParameter(10, 100, default=50, space="buy", optimize=True)
    channel_mult  = DecimalParameter(0.5, 3.0, default=1.5, decimals=1, space="buy", optimize=True)
    atr_stop_mult = DecimalParameter(1.0, 4.0, default=2.0, decimals=1, space="sell", optimize=True)

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["atr"]       = ta.ATR(dataframe, timeperiod=self.atr_period.value)
        dataframe["ema"]       = ta.EMA(dataframe, timeperiod=self.ema_period.value)
        dataframe["upper_ch"]  = dataframe["ema"] + self.channel_mult.value * dataframe["atr"]
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["close"] > dataframe["upper_ch"])
            & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["close"] < dataframe["ema"]),
            "exit_long",
        ] = 1
        return dataframe

    def custom_stoploss(
        self,
        pair: str,
        trade,
        current_time,
        current_rate: float,
        current_profit: float,
        after_fill: bool,
        **kwargs,
    ) -> float:
        dataframe, _ = self.dp.get_analyzed_dataframe(pair, self.timeframe)
        if dataframe.empty:
            return self.stoploss
        last_atr = dataframe["atr"].iloc[-1]
        stop_price = trade.open_rate - self.atr_stop_mult.value * last_atr
        stoploss_pct = (stop_price / current_rate) - 1
        return max(stoploss_pct, -0.35)
