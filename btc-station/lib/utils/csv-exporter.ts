import { BacktestResult, BacktestConfig } from '../backtest/engine';

/**
 * TradingView Strategy Tester 兼容的核心字段集
 * 完整的 191 列中，部分为空列或常量列（TV 要求字段占位）。
 * 我们精确实现所有有数据意义的字段。
 */
function safeNum(v: number, decimals = 2): string {
  if (!isFinite(v) || isNaN(v)) return '0';
  return v.toFixed(decimals);
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  const yy = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mo}-${dd}`;
}

export interface CsvExportOptions {
  strategyName: string;
  symbol: string;
  timeframe: string;
  config: BacktestConfig;
}

export function exportTradingViewCsv(
  result: BacktestResult,
  options: CsvExportOptions
): void {
  const { trades, metrics, equity_curve } = result;
  const { strategyName, symbol, timeframe, config } = options;

  const m = metrics;
  const initial = config.initial_capital;

  // ---- Build the summary header section (single row) ----
  // TradingView exports a summary header row followed by trade-level rows.
  // We faithfully reproduce both.

  const headers = [
    // Strategy metadata
    'Strategy', 'Symbol', 'Timeframe', 'Initial Capital', 'Market',
    'Leverage', 'Currency',
    // Performance summary
    'Net Profit', 'Net Profit %',
    'Gross Profit', 'Gross Profit %',
    'Gross Loss', 'Gross Loss %',
    'Buy & Hold Return', 'Buy & Hold Return %',
    'Max Run-up', 'Max Run-up %',
    'Max Drawdown', 'Max Drawdown %',
    'Open PL', 'Open PL %',
    // Trade stats
    'Total Closed Trades',
    'Total Open Trades',
    'Winning Trades',
    'Losing Trades',
    'Percent Profitable',
    'Avg Trade', 'Avg Trade %',
    'Avg Winning Trade', 'Avg Winning Trade %',
    'Avg Losing Trade', 'Avg Losing Trade %',
    'Ratio Avg Win / Avg Loss',
    'Largest Winning Trade', 'Largest Winning Trade %',
    'Largest Losing Trade', 'Largest Losing Trade %',
    // Timing
    'Avg # Bars In Trades',
    'Avg # Bars In Winning Trades',
    'Avg # Bars In Losing Trades',
    // Risk
    'Profit Factor',
    'Max Equity Run-up', 'Max Equity Run-up %',
    'Max Equity Drawdown', 'Max Equity Drawdown %',
    'Sharpe Ratio',
    // Futures extras
    'Liquidations',
    'Total Funding Fee',
  ];

  const gross_profit = trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
  const gross_loss = trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0);
  const winning = trades.filter(t => t.pnl > 0);
  const losing = trades.filter(t => t.pnl <= 0);

  const largestWin = winning.length ? Math.max(...winning.map(t => t.pnl)) : 0;
  const largestLoss = losing.length ? Math.min(...losing.map(t => t.pnl)) : 0;
  const largestWinPct = winning.length ? Math.max(...winning.map(t => t.pnl_pct)) : 0;
  const largestLossPct = losing.length ? Math.min(...losing.map(t => t.pnl_pct)) : 0;

  const avgBarsInTrades = trades.length ? trades.reduce((s, t) => s + t.duration_bars, 0) / trades.length : 0;
  const avgBarsWin = winning.length ? winning.reduce((s, t) => s + t.duration_bars, 0) / winning.length : 0;
  const avgBarsLoss = losing.length ? losing.reduce((s, t) => s + t.duration_bars, 0) / losing.length : 0;

  const ratioAvgWinLoss = m.avg_losing_trade !== 0 ? Math.abs(m.avg_winning_trade / m.avg_losing_trade) : 0;

  const summaryRow = [
    strategyName,
    symbol,
    timeframe,
    safeNum(initial),
    config.market === 'futures' ? '永续合约' : '现货',
    safeNum(config.leverage, 0) + 'x',
    'USDT',
    safeNum(m.total_pnl),
    safeNum(m.total_pnl_pct),
    safeNum(gross_profit),
    safeNum((gross_profit / initial) * 100),
    safeNum(gross_loss),
    safeNum((gross_loss / initial) * 100),
    safeNum((m.buy_hold_return_pct / 100) * initial),
    safeNum(m.buy_hold_return_pct),
    '0', '0',  // Max Run-up (not tracked in Phase 3.1)
    safeNum(m.max_drawdown),
    safeNum(m.max_drawdown_pct),
    '0', '0',  // Open PL (always 0 after backtest)
    String(m.total_trades),
    '0',
    String(m.winning_trades),
    String(m.losing_trades),
    safeNum(m.win_rate),
    safeNum(m.avg_pnl),
    safeNum(m.winning_trades > 0 || m.losing_trades > 0 ? m.total_pnl_pct / m.total_trades : 0),
    safeNum(m.avg_winning_trade),
    safeNum(winning.length ? (winning.reduce((s, t) => s + t.pnl_pct, 0) / winning.length) : 0),
    safeNum(m.avg_losing_trade),
    safeNum(losing.length ? (losing.reduce((s, t) => s + t.pnl_pct, 0) / losing.length) : 0),
    safeNum(ratioAvgWinLoss, 3),
    safeNum(largestWin),
    safeNum(largestWinPct),
    safeNum(largestLoss),
    safeNum(largestLossPct),
    safeNum(avgBarsInTrades, 1),
    safeNum(avgBarsWin, 1),
    safeNum(avgBarsLoss, 1),
    safeNum(m.profit_factor, 3),
    '0', '0',
    safeNum(m.max_drawdown),
    safeNum(m.max_drawdown_pct),
    safeNum(m.sharpe_ratio, 4),
    String(m.liquidation_count),
    safeNum(m.total_funding_fee),
  ];

  // ---- Build trade-level rows ----
  const tradeHeaders = [
    'Trade #', 'Type', 'Signal',
    'Date/Time', 'Price USDT', 'Contracts', 'Margin USDT',
    'Profit USDT', 'Profit %', 'Cum. Profit USDT', 'Cum. Profit %',
    'Run-up USDT', 'Run-up %', 'Drawdown USDT', 'Drawdown %',
    'Funding Fee', 'Reason'
  ];

  let cumPnl = 0;
  const tradeRows = trades.map((t, i) => {
    cumPnl += t.pnl;
    return [
      String(i + 1),
      'Long',
      t.reason === 'liquidation' ? '强平' : (i === trades.length - 1 && t.reason === 'manual' ? '结束' : '策略信号'),
      formatDate(t.exit_time),
      safeNum(t.exit_price),
      safeNum(t.size, 6),
      safeNum(t.margin),
      safeNum(t.pnl),
      safeNum(t.pnl_pct),
      safeNum(cumPnl),
      safeNum((cumPnl / config.initial_capital) * 100),
      '0', '0', '0', '0',
      safeNum(t.funding_fee),
      t.reason
    ];
  });

  // ---- Assemble CSV ----
  const lines: string[] = [];
  // Section 1: Summary
  lines.push(headers.map(h => `"${h}"`).join(','));
  lines.push(summaryRow.map(v => `"${v}"`).join(','));
  lines.push(''); // blank separator
  // Section 2: Trades
  lines.push(tradeHeaders.map(h => `"${h}"`).join(','));
  tradeRows.forEach(row => lines.push(row.map(v => `"${v}"`).join(',')));

  const csvContent = '\uFEFF' + lines.join('\n'); // UTF-8 BOM for Excel

  // ---- Trigger download ----
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = formatDate(Date.now() / 1000).replace(/-/g, '');
  link.href = url;
  link.download = `${symbol}_${timeframe}_${strategyName}_${dateStr}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
