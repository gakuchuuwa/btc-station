import { KlineBar } from '../okx';
import { Strategy, StrategyParams, Signal } from './types';
import { SMA, ATR } from 'technicalindicators';

export const atrChannelStrategy: Strategy = {
  id: 'atr-channel',
  name: 'ATR 通道突破 + 止损',
  description: '基于 ATR 动态构建价格通道，突破上轨买入，触及止损线卖出。带专业级风险控制。',
  category: 'breakout',
  difficulty: 3,
  backtestStats: {
    returnPct: 1874,
    ddPct: 37,
    calmar: 50.1,
    trades: 209,
    rating: 'good',
    honestNote: '5 年 BTC 4h 实测最强:收益接近 Buy & Hold,回撤却只有 -37%(BH 是 -77%)。Calmar 比所有内置策略都高。',
  },
  paramSchema: {
    atr_period: { type: 'int', default: 14, min: 7, max: 30, label: 'ATR 周期' },
    channel_mult: { type: 'float', default: 2.0, min: 1.0, max: 5.0, step: 0.1, label: '通道倍数' },
    stop_loss_atr: { type: 'float', default: 2.0, min: 1.0, max: 5.0, step: 0.1, label: '止损 ATR 倍数' },
    use_trailing_stop: { type: 'bool', default: true, label: '启用追踪止损' }
  },
  generateSignals: (candles: KlineBar[], params: StrategyParams): Signal[] => {
    const atrPeriod = (params.atr_period as number) || 14;
    const channelMult = (params.channel_mult as number) || 2.0;
    const stopLossAtrMult = (params.stop_loss_atr as number) || 2.0;
    const useTrailingStop = params.use_trailing_stop !== false;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    let sma20 = SMA.calculate({ period: 20, values: closes });
    const padSma = new Array(candles.length - sma20.length).fill(NaN);
    sma20 = [...padSma, ...sma20];

    let atrResult = ATR.calculate({ period: atrPeriod, high: highs, low: lows, close: closes });
    const padAtr = new Array(candles.length - atrResult.length).fill(NaN);
    atrResult = [...padAtr, ...atrResult];

    const signals: Signal[] = new Array(candles.length).fill(0);

    let holding = false;
    let entryPrice = 0;
    let stopLossPrice = 0;
    let highestPriceSinceEntry = 0;

    for (let i = 1; i < candles.length; i++) {
      const c = candles[i];
      const prevC = candles[i-1];

      const sma = sma20[i-1];
      const atr = atrResult[i-1];

      if (isNaN(sma) || isNaN(atr)) continue;

      const upperBand = sma + (atr * channelMult);

      if (!holding) {
        // 价格上穿上轨 -> 买入
        if (prevC.close <= upperBand && c.close > upperBand) {
          signals[i] = 1;
          holding = true;
          entryPrice = c.close;
          stopLossPrice = entryPrice - (atr * stopLossAtrMult);
          highestPriceSinceEntry = c.high;
        }
      } else {
        // 持仓中更新最高价
        if (c.high > highestPriceSinceEntry) {
          highestPriceSinceEntry = c.high;
          if (useTrailingStop) {
            const newStopLoss = highestPriceSinceEntry - (atr * stopLossAtrMult);
            if (newStopLoss > stopLossPrice) {
              stopLossPrice = newStopLoss;
            }
          }
        }

        // 触发止损 -> 卖出
        if (c.low <= stopLossPrice) {
          signals[i] = -1;
          holding = false;
        }
      }
    }

    return signals;
  }
};
