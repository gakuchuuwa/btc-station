"""
DCA 定投补仓策略 — BTC Station 内置模板

逻辑：
  初始买入后，每次价格回调 dca_drop% 补仓一次
  最多补仓 max_dca_orders 次
  RSI 超卖作为首次入场过滤
  价格反弹到成本价 + profit_target% 时全部出场

提示：
  dca_drop 越小补仓越频繁，资金消耗越快
  max_dca_orders 决定最大持仓层数
"""
from freqtrade.strategy import IStrategy, IntParameter, DecimalParameter
from pandas import DataFrame
from freqtrade.persistence import Trade
import talib.abstract as ta
from datetime import datetime


class DcaStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "4h"
    stake_currency = "USDT"
    minimal_roi = {"0": 100}
    stoploss = -0.30
    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    can_short = False
    position_adjustment_enable = True

    max_dca_orders  = IntParameter(1, 5, default=3,   space="buy", optimize=True)
    dca_drop        = DecimalParameter(3, 15, default=5.0, decimals=1, space="buy", optimize=True)
    profit_target   = DecimalParameter(3, 20, default=8.0, decimals=1, space="sell", optimize=True)
    rsi_entry       = IntParameter(20, 45, default=35,  space="buy", optimize=True)

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["rsi"] = ta.RSI(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (dataframe["rsi"] < self.rsi_entry.value) & (dataframe["volume"] > 0),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        return dataframe

    def adjust_trade_position(
        self,
        trade: Trade,
        current_time: datetime,
        current_rate: float,
        current_profit: float,
        min_stake: float | None,
        max_stake: float,
        current_entry_rate: float,
        current_exit_rate: float,
        current_entry_profit: float,
        current_exit_profit: float,
        **kwargs,
    ) -> float | None:
        dca_orders = trade.nr_of_successful_buys - 1
        if dca_orders >= self.max_dca_orders.value:
            return None
        drop_needed = -(self.dca_drop.value / 100) * (dca_orders + 1)
        if current_profit < drop_needed:
            return trade.stake_amount
        return None

    def custom_exit(
        self,
        pair: str,
        trade: Trade,
        current_time: datetime,
        current_rate: float,
        current_profit: float,
        **kwargs,
    ):
        if current_profit > self.profit_target.value / 100:
            return "dca_profit_target"
        return None
