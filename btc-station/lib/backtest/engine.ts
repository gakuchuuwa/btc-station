import type { KlineBar } from '../okx'
import type { Signal } from '../strategies/types'

export interface BacktestConfig {
  market: 'spot' | 'futures';
  leverage: number;
  initial_capital: number;
  position_sizing: 'all_in' | 'fixed_pct' | 'fixed_amount';
  position_value: number; // For all_in=100, fixed_pct=10-100, fixed_amount=USDT amount
  fee_pct: number;
  slippage_pct: number;
  funding_rate_pct?: number; // per 8 hours, e.g. 0.01
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface Trade {
  entry_time: number;
  exit_time: number;
  entry_price: number;
  exit_price: number;
  size: number; // quantity of asset
  leverage: number;
  margin: number; // USDT allocated
  pnl: number;
  pnl_pct: number;
  fee: number;
  funding_fee: number;
  duration_bars: number;
  reason: 'signal' | 'stop_loss' | 'take_profit' | 'liquidation' | 'manual';
}

export interface Metrics {
  total_pnl: number;
  total_pnl_pct: number;
  win_rate: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  max_drawdown: number;
  max_drawdown_pct: number;
  avg_pnl: number;
  avg_winning_trade: number;
  avg_losing_trade: number;
  profit_factor: number;
  sharpe_ratio: number;
  buy_hold_return_pct: number;
  outperformance: number;
  liquidation_count: number;
  total_funding_fee: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity_curve: EquityPoint[];
  metrics: Metrics;
}

function calculatePositionMargin(cash: number, config: BacktestConfig): number {
  switch (config.position_sizing) {
    case 'all_in':
      return cash;
    case 'fixed_pct':
      return cash * (config.position_value / 100);
    case 'fixed_amount':
      return Math.min(cash, config.position_value);
    default:
      return cash;
  }
}

export async function runBacktest(
  candles: KlineBar[],
  signals: Signal[],
  config: BacktestConfig
): Promise<BacktestResult> {
  if (!Array.isArray(candles) || candles.length === 0) throw new Error('没有可用于回测的 K 线数据')
  if (!Array.isArray(signals) || signals.length !== candles.length) throw new Error('策略信号数量与 K 线数量不匹配')
  if (signals.some(signal => signal !== -1 && signal !== 0 && signal !== 1)) throw new Error('策略信号只能是 -1、0 或 1')
  if (!config || (config.market !== 'spot' && config.market !== 'futures')) throw new Error('市场类型无效')
  if (!['all_in', 'fixed_pct', 'fixed_amount'].includes(config.position_sizing)) throw new Error('仓位计算方式无效')
  if (!Number.isFinite(config.initial_capital) || config.initial_capital <= 0) throw new Error('初始资金必须大于 0')
  if (config.market === 'futures' && (!Number.isFinite(config.leverage) || config.leverage <= 0)) throw new Error('杠杆必须大于 0')
  if (config.position_sizing !== 'all_in' && (!Number.isFinite(config.position_value) || config.position_value <= 0)) {
    throw new Error('仓位金额必须大于 0')
  }
  if (config.position_sizing === 'fixed_pct' && config.position_value > 100) throw new Error('固定仓位比例不能超过 100%')
  if (!Number.isFinite(config.fee_pct) || config.fee_pct < 0 || config.fee_pct >= 100 ||
      !Number.isFinite(config.slippage_pct) || config.slippage_pct < 0 || config.slippage_pct >= 100) {
    throw new Error('手续费和滑点必须是 0% 至 100% 之间的有效数值')
  }
  if (config.funding_rate_pct != null && !Number.isFinite(config.funding_rate_pct)) throw new Error('资金费率必须是有效数值')
  if (candles.some((candle, i) =>
    ![candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) ||
    candle.close <= 0 || candle.open <= 0 || candle.high <= 0 || candle.low <= 0 ||
    candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) ||
    candle.high < candle.low ||
    (i > 0 && candle.time <= candles[i - 1].time)
  )) {
    throw new Error('K 线数据无效或未按时间升序排列')
  }

  let cash = config.initial_capital
  let position = 0
  let entryPrice = 0
  let entryTime = 0
  let entryIndex = 0
  let marginAllocated = 0
  let entryFee = 0

  const trades: Trade[] = []
  const equity_curve: EquityPoint[] = []
  const isFutures = config.market === 'futures'
  const leverage = isFutures ? config.leverage : 1
  const feeRate = config.fee_pct / 100
  const slippageRate = config.slippage_pct / 100
  const maintenanceMarginRate = 0.005
  const fundingRate8h = (config.funding_rate_pct ?? 0.01) / 100

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i]
    const signal = signals[i]
    let wasLiquidated = false

    // Long futures only: estimate liquidation using candle low and the configured leverage.
    if (position > 0 && isFutures) {
      const liquidationPrice = entryPrice * (1 - 1 / leverage + maintenanceMarginRate)
      if (candle.low <= liquidationPrice) {
        wasLiquidated = true
        const exitPrice = Math.min(candle.open, liquidationPrice)
        const exitFee = position * exitPrice * feeRate
        const durationHours = Math.max(0, (candle.time - entryTime) / 3600)
        const fundingFee = (durationHours / 8) * fundingRate8h * (position * entryPrice)
        const grossPnl = position * (exitPrice - entryPrice)
        const pnl = grossPnl - entryFee - exitFee - fundingFee

        trades.push({
          entry_time: entryTime,
          exit_time: candle.time,
          entry_price: entryPrice,
          exit_price: exitPrice,
          size: position,
          leverage,
          margin: marginAllocated,
          pnl,
          pnl_pct: marginAllocated > 0 ? pnl / marginAllocated * 100 : 0,
          fee: entryFee + exitFee,
          funding_fee: fundingFee,
          duration_bars: i - entryIndex,
          reason: 'liquidation',
        })

        // Realize the position's loss at the estimated liquidation fill; the entry fee was paid on entry.
        cash += marginAllocated + grossPnl - exitFee - fundingFee
        position = 0
        marginAllocated = 0
        entryFee = 0
        entryPrice = 0
        entryTime = 0
      }
    }

    // Entry signals are evaluated at the bar close. A liquidated position cannot re-enter
    // on the same candle, which would otherwise use information from the candle low.
    if (!wasLiquidated && signal === 1 && position === 0) {
      const requestedMargin = calculatePositionMargin(cash, config)
      const maxAffordableMargin = cash / (1 + leverage * feeRate)
      const marginToUse = Math.min(requestedMargin, maxAffordableMargin)
      if (marginToUse > 0) {
        const notionalValue = marginToUse * leverage
        const fillPrice = candle.close * (1 + slippageRate)
        entryFee = notionalValue * feeRate
        cash -= entryFee
        position = notionalValue / fillPrice
        entryPrice = fillPrice
        entryTime = candle.time
        entryIndex = i
        marginAllocated = marginToUse
        cash -= marginAllocated
      }
    }

    if (!wasLiquidated && signal === -1 && position > 0) {
      const fillPrice = candle.close * (1 - slippageRate)
      const exitNotional = position * fillPrice
      const exitFee = exitNotional * feeRate
      const durationHours = Math.max(0, (candle.time - entryTime) / 3600)
      const fundingFee = isFutures
        ? (durationHours / 8) * fundingRate8h * (position * entryPrice)
        : 0
      const grossPnl = exitNotional - position * entryPrice
      const pnl = grossPnl - fundingFee - entryFee - exitFee

      trades.push({
        entry_time: entryTime,
        exit_time: candle.time,
        entry_price: entryPrice,
        exit_price: fillPrice,
        size: position,
        leverage,
        margin: marginAllocated,
        pnl,
        pnl_pct: marginAllocated > 0 ? pnl / marginAllocated * 100 : 0,
        fee: entryFee + exitFee,
        funding_fee: fundingFee,
        duration_bars: i - entryIndex,
        reason: 'signal',
      })

      // Entry fee is already reflected in cash; realize gross PnL and remaining costs.
      cash += marginAllocated + grossPnl - fundingFee - exitFee
      position = 0
      marginAllocated = 0
      entryFee = 0
      entryPrice = 0
      entryTime = 0
    }

    let currentEquity = cash
    if (position > 0) {
      currentEquity += marginAllocated + position * (candle.close - entryPrice)
    }
    equity_curve.push({ time: candle.time, equity: currentEquity })
  }

  // Close any remaining position at the final bar so the result is fully realized.
  if (position > 0) {
    const candle = candles[candles.length - 1]
    const fillPrice = candle.close * (1 - slippageRate)
    const exitNotional = position * fillPrice
    const exitFee = exitNotional * feeRate
    const durationHours = Math.max(0, (candle.time - entryTime) / 3600)
    const fundingFee = isFutures
      ? (durationHours / 8) * fundingRate8h * (position * entryPrice)
      : 0
    const grossPnl = exitNotional - position * entryPrice
    const pnl = grossPnl - fundingFee - entryFee - exitFee

    trades.push({
      entry_time: entryTime,
      exit_time: candle.time,
      entry_price: entryPrice,
      exit_price: fillPrice,
      size: position,
      leverage,
      margin: marginAllocated,
      pnl,
      pnl_pct: marginAllocated > 0 ? pnl / marginAllocated * 100 : 0,
      fee: entryFee + exitFee,
      funding_fee: fundingFee,
      duration_bars: candles.length - 1 - entryIndex,
      reason: 'manual',
    })

    cash += marginAllocated + grossPnl - fundingFee - exitFee
    position = 0
    equity_curve[equity_curve.length - 1].equity = cash
  }

  return {
    trades,
    equity_curve,
    metrics: calculateMetrics(trades, equity_curve, candles, config),
  }
}

function calculateMetrics(
  trades: Trade[],
  equity_curve: EquityPoint[],
  candles: KlineBar[],
  config: BacktestConfig
): Metrics {
  const total_pnl = equity_curve[equity_curve.length - 1].equity - config.initial_capital;
  const total_pnl_pct = (total_pnl / config.initial_capital) * 100;
  
  const winning_trades = trades.filter(t => t.pnl > 0).length;
  const losing_trades = trades.filter(t => t.pnl <= 0).length;
  const liquidation_count = trades.filter(t => t.reason === 'liquidation').length;
  const total_funding_fee = trades.reduce((sum, t) => sum + (t.funding_fee || 0), 0);

  const total_trades = trades.length;
  const win_rate = total_trades > 0 ? (winning_trades / total_trades) * 100 : 0;

  // Max Drawdown
  let max_drawdown = 0;
  let max_drawdown_pct = 0;
  let peak = config.initial_capital;
  for (const point of equity_curve) {
    if (point.equity > peak) {
      peak = point.equity;
    }
    const drawdown = peak - point.equity;
    const drawdown_pct = (drawdown / peak) * 100;
    if (drawdown > max_drawdown) max_drawdown = drawdown;
    if (drawdown_pct > max_drawdown_pct) max_drawdown_pct = drawdown_pct;
  }

  const avg_pnl = total_trades > 0 ? total_pnl / total_trades : 0;
  const gross_profit = trades.filter(t => t.pnl > 0).reduce((sum, t) => sum + t.pnl, 0);
  const gross_loss = trades.filter(t => t.pnl < 0).reduce((sum, t) => sum + Math.abs(t.pnl), 0);
  
  const avg_winning_trade = winning_trades > 0 ? gross_profit / winning_trades : 0;
  const avg_losing_trade = losing_trades > 0 ? -gross_loss / losing_trades : 0;
  const profit_factor = gross_loss > 0 ? gross_profit / gross_loss : (gross_profit > 0 ? 99 : 0);

  // Buy & Hold (spot equivalent)
  const first_close = candles[0]?.close || 1;
  const last_close = candles[candles.length - 1]?.close || 1;
  const buy_hold_return_pct = ((last_close - first_close) / first_close) * 100;
  const outperformance = total_pnl_pct - buy_hold_return_pct;

  let sharpe_ratio = 0;
  if (equity_curve.length > 1) {
    const returns: number[] = [];
    for (let i = 1; i < equity_curve.length; i++) {
      const prev = equity_curve[i-1].equity;
      const r = prev > 0 ? (equity_curve[i].equity - prev) / prev : 0;
      returns.push(r);
    }
    const mean_return = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean_return, 2), 0) / returns.length;
    const std_dev = Math.sqrt(variance);
    if (std_dev > 0) {
      const intervals = candles.slice(1).map((candle, i) => candle.time - candles[i].time).filter(seconds => seconds > 0)
      const averageIntervalSeconds = intervals.length
        ? intervals.reduce((sum, seconds) => sum + seconds, 0) / intervals.length
        : 86_400
      const periodsPerYear = (365.25 * 86_400) / averageIntervalSeconds
      sharpe_ratio = (mean_return / std_dev) * Math.sqrt(periodsPerYear);
    }
  }

  return {
    total_pnl,
    total_pnl_pct,
    win_rate,
    total_trades,
    winning_trades,
    losing_trades,
    max_drawdown,
    max_drawdown_pct,
    avg_pnl,
    avg_winning_trade,
    avg_losing_trade,
    profit_factor,
    sharpe_ratio,
    buy_hold_return_pct,
    outperformance,
    liquidation_count,
    total_funding_fee
  };
}
