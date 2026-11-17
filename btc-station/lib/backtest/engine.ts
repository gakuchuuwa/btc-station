import { KlineBar } from '../okx';
import { Signal, StrategyParams } from '../strategies/types';

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
  let cash = config.initial_capital;
  let position = 0; // Asset amount
  let entry_price = 0;
  let entry_time = 0;
  let entry_index = 0;
  let margin_allocated = 0;
  
  const trades: Trade[] = [];
  const equity_curve: EquityPoint[] = [];

  const isFutures = config.market === 'futures';
  const leverage = isFutures ? config.leverage : 1;
  const maintenanceMarginRate = 0.005; // 0.5% MMR for BTC
  const fundingRate8h = (config.funding_rate_pct || 0.01) / 100;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const signal = signals[i];

    // --- CHECK LIQUIDATION BEFORE PROCESSING NEW SIGNALS ---
    if (position > 0 && isFutures) {
      // Liquidation Price calculation for Long
      const liqPrice = entry_price * (1 - 1 / leverage + maintenanceMarginRate);
      
      if (candle.low <= liqPrice) {
        // Liquidated!
        const exit_price = Math.min(candle.open, liqPrice); // Fill at worst case liq price
        
        // When liquidated, you lose all allocated margin
        const pnl = -margin_allocated; 
        const fee = (position * exit_price) * (config.fee_pct / 100);
        
        // Approximate funding fee (deducted continuously)
        const durationHours = (candle.time - entry_time) / 3600;
        const funding_fee = (durationHours / 8) * fundingRate8h * (position * entry_price);

        trades.push({
          entry_time,
          exit_time: candle.time,
          entry_price,
          exit_price,
          size: position,
          leverage,
          margin: margin_allocated,
          pnl,
          pnl_pct: -100, // Lost 100% of margin
          fee,
          funding_fee,
          duration_bars: i - entry_index,
          reason: 'liquidation'
        });

        position = 0;
        margin_allocated = 0;
        entry_price = 0;
        entry_time = 0;
      }
    }

    // --- PROCESS SIGNALS ---
    // Buy (Long)
    if (signal === 1 && position === 0) {
      const marginToUse = calculatePositionMargin(cash, config);
      if (marginToUse > 0) {
        const notionalValue = marginToUse * leverage;
        const fillPrice = candle.close * (1 + config.slippage_pct / 100);
        const fee = notionalValue * (config.fee_pct / 100);
        
        // We deduct the entry fee from cash immediately
        cash -= fee;
        
        const size = notionalValue / fillPrice;

        position = size;
        entry_price = fillPrice;
        entry_time = candle.time;
        entry_index = i;
        margin_allocated = marginToUse;
        cash -= margin_allocated;
      }
    }

    // Sell (Close Long)
    if (signal === -1 && position > 0) {
      const fillPrice = candle.close * (1 - config.slippage_pct / 100);
      const notionalExitValue = position * fillPrice;
      const fee = notionalExitValue * (config.fee_pct / 100);
      
      const durationHours = (candle.time - entry_time) / 3600;
      const funding_fee = isFutures ? ((durationHours / 8) * fundingRate8h * (position * entry_price)) : 0;

      const pnl = notionalExitValue - (position * entry_price) - funding_fee;
      
      trades.push({
        entry_time,
        exit_time: candle.time,
        entry_price,
        exit_price: fillPrice,
        size: position,
        leverage,
        margin: margin_allocated,
        pnl,
        pnl_pct: (pnl / margin_allocated) * 100,
        fee,
        funding_fee,
        duration_bars: i - entry_index,
        reason: 'signal'
      });

      // Return margin + pnl - exit_fee to cash
      cash += (margin_allocated + pnl - fee);
      position = 0;
      margin_allocated = 0;
    }

    // --- UPDATE EQUITY CURVE ---
    let current_equity = cash;
    if (position > 0) {
      const notionalNow = position * candle.close;
      const unrealizedPnl = notionalNow - (position * entry_price);
      current_equity += (margin_allocated + unrealizedPnl);
    }
    equity_curve.push({ time: candle.time, equity: current_equity });
  }

  // Force close at the end if holding
  if (position > 0) {
    const candle = candles[candles.length - 1];
    const fillPrice = candle.close * (1 - config.slippage_pct / 100);
    const notionalExitValue = position * fillPrice;
    const fee = notionalExitValue * (config.fee_pct / 100);
    
    const durationHours = (candle.time - entry_time) / 3600;
    const funding_fee = isFutures ? ((durationHours / 8) * fundingRate8h * (position * entry_price)) : 0;

    const pnl = notionalExitValue - (position * entry_price) - funding_fee;

    trades.push({
      entry_time,
      exit_time: candle.time,
      entry_price,
      exit_price: fillPrice,
      size: position,
      leverage,
      margin: margin_allocated,
      pnl,
      pnl_pct: (pnl / margin_allocated) * 100,
      fee,
      funding_fee,
      duration_bars: candles.length - 1 - entry_index,
      reason: 'manual'
    });

    cash += (margin_allocated + pnl - fee);
    position = 0;
    equity_curve[equity_curve.length - 1].equity = cash;
  }

  return {
    trades,
    equity_curve,
    metrics: calculateMetrics(trades, equity_curve, candles, config)
  };
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
      sharpe_ratio = (mean_return / std_dev) * Math.sqrt(365);
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
