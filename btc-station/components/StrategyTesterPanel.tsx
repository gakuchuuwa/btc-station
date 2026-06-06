"use client";

/**
 * StrategyTesterPanel — TradingView-style bottom panel for the chart page.
 * Draggable height, 4 tabs: 回测控制台 / 资金曲线 / 交易明细 / 量化导出
 *
 * Props are intentionally generic so the component works standalone on the
 * chart page even before backtest data is wired up from the editor.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-mute)", fontSize: 12 }}>
      图表加载中…
    </div>
  ),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TradeRecord {
  entry_time: number;   // unix seconds
  exit_time?: number;
  pair: string;
  direction: "long" | "short";
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  pnl_abs: number;
  size?: number;        // 这一笔 trade 的数量（首入或单次加仓）
  signal?: string;      // 入场信号："S2 Long-P1" / "Scale-in Long 1" 等
  exit_signal?: string; // 出场信号："Trailing SL" / "Price SL" 等
}

export interface FtmoScanResult {
  rules: { daily_loss_pct: number; total_loss_pct: number; profit_target_pct: number; rule_set: string }
  summary: { daily_loss_status: 'pass' | 'fail'; total_loss_status: 'pass' | 'fail'; target_status: 'reached' | 'not_reached'; overall_verdict: 'pass' | 'fail' | 'borderline' }
  final_return_pct: number
  trading_days: number
  daily_loss: { max_observed_pct: number; limit_pct: number; worst_day: string | null; violation_count: number; violations: Array<{ date: string; daily_loss_pct: number; day_open: number; day_low: number }> }
  total_loss: { max_observed_pct: number; limit_pct: number; violated: boolean; worst_time: number | null }
  rolling_entry: { total_entries: number; fail_count: number; fail_rate_pct: number; worst_drawdown_pct: number }
  consecutive_loss: { max_consec_loss_count: number; max_consec_loss_amount: number }
  monte_carlo: { n_simulations: number; pass_rate_pct: number; fail_daily_loss: number; fail_total_loss: number; fail_target_not_reached: number } | null
}

export interface BacktestSummary {
  // === 表现 ===
  initial_capital: number;
  end_value?: number | null;
  net_profit_abs?: number | null;
  net_profit_pct?: number | null;   // 兼容旧字段
  total_return_pct?: number | null;
  gross_profit_abs?: number | null;
  gross_loss_abs?: number | null;
  gross_profit_long?: number | null;
  gross_loss_long?: number | null;
  gross_profit_short?: number | null;
  gross_loss_short?: number | null;
  expectancy_abs?: number | null;
  commission_paid?: number | null;
  benchmark_return_pct?: number | null;
  benchmark_return_abs?: number | null;
  cagr_pct?: number | null;
  max_drawdown_pct: number;
  closed_max_drawdown_pct?: number;
  max_dd_peak_ts?: number | null;
  max_dd_trough_ts?: number | null;
  closed_max_dd_peak_ts?: number | null;
  closed_max_dd_trough_ts?: number | null;
  ftmo_drawdown_pct?: number | null;
  max_drawdown_duration_days?: number | null;
  avg_drawdown_duration_days?: number | null;
  avg_drawdown_pct?: number | null;
  max_dd_profit_at_trough?: number | null;
  max_consec_win?: number | null;
  max_consec_loss?: number | null;
  open_trade_pnl?: number | null;

  // === 交易分析 ===
  total_trades: number;
  win_trades?: number | null;
  loss_trades?: number | null;
  total_trades_long?: number | null;
  total_trades_short?: number | null;
  win_trades_long?: number | null;
  loss_trades_long?: number | null;
  win_trades_short?: number | null;
  loss_trades_short?: number | null;
  win_rate_pct: number;
  avg_win_abs?: number | null;
  avg_loss_abs?: number | null;
  avg_win_pct?: number | null;
  avg_loss_pct?: number | null;
  max_win_abs?: number | null;
  max_loss_abs?: number | null;
  max_win_pct?: number | null;
  max_loss_pct?: number | null;
  payoff_ratio?: number | null;
  avg_bars_all?: number | null;
  avg_bars_win?: number | null;
  avg_bars_loss?: number | null;

  // === 风险调整 ===
  sharpe?: number | null;
  sortino?: number | null;
  calmar?: number | null;
  omega?: number | null;
  profit_factor?: number | null;
  backtest_start?: string | null;
  backtest_end?: string | null;
  timeframe?: string | null;
}

export interface EpochRecord {
  epoch: number;
  total_epochs: number;
  profit_pct: number;
  drawdown_pct: number;
  trades: number;
  win_rate_pct: number;
  params: Record<string, string>;
}

export interface ParamRow {
  name: string;
  start: number;
  stop: number;
  step: number;
  enabled?: boolean;
  defaultValue?: number;
  priority?: number;
}

interface EquityPoint {
  time: number;   // unix seconds
  equity: number;
}

interface Props {
  /** Set to false to hide the panel */
  visible?: boolean;
  onClose?: () => void;
  /** Backtest summary metrics */
  summary?: BacktestSummary | null;
  /** Individual trade records */
  trades?: TradeRecord[];
  /** Equity curve data points */
  equity?: EquityPoint[];
  /** Closed-trade balance curve */
  balance?: EquityPoint[];
  /** Download URL for the TV-compatible XLSX (S3) */
  xlsxDownloadUrl?: string | null;
  /** Strategy name shown in export filename */
  strategyName?: string;
  /** Log lines from the backtest run */
  logs?: string[];
  /** Whether backtest is currently running */
  running?: boolean;
  /** Used for Optimization (S4) */
  strategyCode?: string;
  onOptimizeStart?: (paramRows: ParamRow[], startDate: string, method: 'grid' | 'annealing', target: string) => void;
  optimizeStatus?: 'idle' | 'running' | 'completed' | 'failed';
  optimizeEpochs?: EpochRecord[];
  optimizeError?: string;
  optimizeProgress?: { iter: number; total: number };
  onOptimizeCsvDownload?: () => void;
  onApplyBestParams?: (params: Record<string, string>) => void;
  /** FTMO 合规扫描结果 */
  ftmoScan?: FtmoScanResult | null;
  /** UI Mode */
  defaultTab?: Tab;
  fixedPanel?: boolean;
  allowedTabs?: Tab[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = ["回测控制台", "资金曲线", "交易明细", "参数优化", "FTMO 风控", "下载报告"] as const;
type Tab = (typeof TABS)[number];


const MIN_HEIGHT = 48;
const DEFAULT_HEIGHT = 280;
const MAX_HEIGHT = 600;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, d = 2, suffix = "") {
  if (n == null || isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)}${suffix}`;
}

function ts(unix: number) {
  return new Date(unix * 1000).toLocaleString("zh-CN", { hour12: false });
}

const EXECUTION_PARAM_NAMES = new Set([
  "init_cash",
  "initial_capital",
  "fees",
  "use_real_capital",
  "real_capital",
  "enable_max_qty",
  "max_qty",
  "qty_step",
  "min_qty",
  "slippage_ticks",
  "tick_size",
]);

const PRIORITY_PARAM_NAMES = [
  "system1_period",
  "system2_period",
  "atr_mult_init",
  "atr_mult_long_trail",
  "atr_mult_short_trail",
  "profit_atr_mult_long",
  "profit_atr_mult_short",
  "base_risk_percent",
  "ma1_length",
  "ma3_length",
  "macd_fast",
  "macd_slow",
  "macd_signal",
  "obv_length",
  "fast_period",
  "slow_period",
];

function inferParamStep(value: number) {
  const abs = Math.abs(value);
  if (Number.isInteger(value)) {
    if (abs >= 100) return 6;
    if (abs >= 20) return 2;
    return 1;
  }
  if (abs <= 1) return 0.1;
  return 0.5;
}

function makeParamRange(name: string, value: number, enabled = false, priority = 1): ParamRow {
  const step = inferParamStep(value);
  const isInt = Number.isInteger(value);
  let start = value / 2;
  let stop = value * 2;

  if (value === 0) {
    start = 0;
    stop = isInt ? 10 : 1;
  }

  if (isInt) {
    start = Math.max(1, Math.floor(start));
    stop = Math.max(start, Math.ceil(stop));
  } else {
    start = Math.max(0, Number(start.toFixed(4)));
    stop = Math.max(start + step, Number(stop.toFixed(4)));
  }

  return { name, start, stop, step, enabled, defaultValue: value, priority };
}

function extractOptimizableParams(strategyCode?: string): ParamRow[] {
  if (!strategyCode) return [];

  const found = new Map<string, number>();
  const patterns = [
    /(?:int|float)\(\s*(?:p|parameters)\.get\(\s*["']([^"']+)["']\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)\s*\)/g,
    /(?:p|parameters)\.get\(\s*["']([^"']+)["']\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(strategyCode)) !== null) {
      const name = match[1];
      const value = Number(match[2]);
      if (!name || EXECUTION_PARAM_NAMES.has(name) || !Number.isFinite(value)) continue;
      if (/enable_|use_|_enable|_enabled/.test(name)) continue;
      if (!found.has(name)) found.set(name, value);
    }
  }

  return Array.from(found.entries())
    .sort(([a], [b]) => {
      const ai = PRIORITY_PARAM_NAMES.indexOf(a);
      const bi = PRIORITY_PARAM_NAMES.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    })
    .map(([name, value], index) => makeParamRange(name, value, index < 3, index + 1));
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryGrid({ summary }: { summary: BacktestSummary }) {
  const s = summary;
  const pct = s.net_profit_pct ?? s.total_return_pct ?? 0;
  const upColor = "var(--up)";
  const downColor = "var(--down)";
  const textColor = "var(--text)";
  const muteColor = "var(--text-mute)";

  function fmtAbs(n: number | null | undefined, d = 2) {
    if (n == null || isNaN(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(d)} USDT`;
  }
  function fmtPct(n: number | null | undefined, d = 2) {
    if (n == null || isNaN(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(d)}%`;
  }
  function fmtNum(n: number | null | undefined, d = 3) {
    if (n == null || isNaN(n)) return "—";
    return n.toFixed(d);
  }
  function fmtInt(n: number | null | undefined) {
    if (n == null) return "—";
    return String(Math.round(n));
  }

  const groups: { title: string; rows: { label: string; value: string; color?: string }[] }[] = [
    {
      title: "表现",
      rows: [
        { label: "净收益率",   value: fmtPct(pct),                       color: pct >= 0 ? upColor : downColor },
        { label: "净收益额",   value: fmtAbs(s.net_profit_abs),           color: (s.net_profit_abs ?? 0) >= 0 ? upColor : downColor },
        { label: "总盈利",     value: fmtAbs(s.gross_profit_abs),         color: upColor },
        { label: "总亏损",     value: s.gross_loss_abs != null ? `-${s.gross_loss_abs.toFixed(2)} USDT` : "—", color: downColor },
        { label: "期望收益",   value: fmtAbs(s.expectancy_abs) },
        { label: "年化收益率", value: fmtPct(s.cagr_pct),                 color: (s.cagr_pct ?? 0) >= 0 ? upColor : downColor },
        { label: "手续费",     value: s.commission_paid != null ? `-${s.commission_paid.toFixed(2)} USDT` : "—", color: downColor },
        { label: "最大浮亏",      value: fmtPct(-Math.abs(s.max_drawdown_pct ?? 0)), color: downColor },
        { label: "最大回撤",      value: s.closed_max_drawdown_pct != null ? fmtPct(-Math.abs(s.closed_max_drawdown_pct)) : "—", color: downColor },
        { label: "绝对回撤",      value: s.ftmo_drawdown_pct != null ? fmtPct(-Math.abs(s.ftmo_drawdown_pct)) : "—", color: downColor },
        { label: "最大回撤时长",  value: s.max_drawdown_duration_days != null ? `${s.max_drawdown_duration_days} 天` : "—" },
        { label: "平均回撤时长",  value: s.avg_drawdown_duration_days != null ? `${s.avg_drawdown_duration_days} 天` : "—" },
        { label: "平均回撤幅度",  value: s.avg_drawdown_pct != null ? fmtPct(-Math.abs(s.avg_drawdown_pct)) : "—", color: downColor },
        { label: "最大回撤时收益", value: s.max_dd_profit_at_trough != null ? fmtAbs(s.max_dd_profit_at_trough) : "—", color: (s.max_dd_profit_at_trough ?? 0) >= 0 ? upColor : downColor },
      ],
    },
    {
      title: "交易分析",
      rows: [
        { label: "总交易数",   value: fmtInt(s.total_trades) },
        { label: "盈利笔数",   value: fmtInt(s.win_trades),   color: upColor },
        { label: "亏损笔数",   value: fmtInt(s.loss_trades),  color: downColor },
        { label: "胜率",       value: fmtPct(s.win_rate_pct, 1) },
        { label: "最大连赢",   value: s.max_consec_win != null ? `${s.max_consec_win} 笔` : "—", color: upColor },
        { label: "最大连亏",   value: s.max_consec_loss != null ? `${s.max_consec_loss} 笔` : "—", color: downColor },
        { label: "平均盈利",   value: fmtAbs(s.avg_win_abs),  color: upColor },
        { label: "平均亏损",   value: s.avg_loss_abs != null ? `-${s.avg_loss_abs.toFixed(2)} USDT` : "—", color: downColor },
        { label: "盈亏比",     value: fmtNum(s.payoff_ratio, 2) },
        { label: "平均持仓K线", value: fmtInt(s.avg_bars_all) },
      ],
    },
    {
      title: "风险调整",
      rows: [
        { label: "Sharpe",      value: fmtNum(s.sharpe) },
        { label: "Sortino",     value: fmtNum(s.sortino) },
        { label: "Calmar",      value: fmtNum(s.calmar) },
        { label: "盈利因子",    value: fmtNum(s.profit_factor) },
      ],
    },
  ];

  const cellStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8,
    padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
  };

  return (
    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
      {groups.map((g, gi) => (
        <div key={gi} style={{ flex: 1, borderRight: gi < groups.length - 1 ? "1px solid var(--border)" : "none", padding: "8px 12px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: muteColor, textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 6 }}>{g.title}</div>
          {g.rows.map(r => (
            <div key={r.label} style={cellStyle}>
              <span style={{ fontSize: 12, color: muteColor, whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.15)" }}>|</span>
              <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "monospace", color: r.color ?? textColor, whiteSpace: "nowrap" }}>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ConsoleTab({ logs, running, summary }: { logs: string[]; running: boolean; summary?: BacktestSummary | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {summary && <SummaryGrid summary={summary} />}
      <div
        ref={ref}
        style={{
          flex: 1, overflowY: "auto", padding: "8px 14px",
          fontFamily: "'Fira Code', 'Consolas', monospace", fontSize: 11,
          color: "#a8ff78", background: "#050505", lineHeight: 1.7,
        }}
      >
        {logs.length === 0 ? (
          <span style={{ color: "#444" }}>
            {running ? "▶ 回测运行中…" : "[ 运行回测后日志将显示在此处 ]"}
          </span>
        ) : (
          logs.map((l, i) => {
            const color = l.includes("ERROR") || l.includes("error") ? "#ff6b6b"
              : l.includes("WARNING") || l.includes("warn") ? "#ffd93d"
              : "#a8ff78";
            return <div key={i} style={{ color }}>{l}</div>;
          })
        )}
        {running && <div style={{ color: "#00c864" }}>▌</div>}
      </div>
    </div>
  );
}

function EquityTab({ equity, balance, trades = [], summary }: { equity: EquityPoint[]; balance?: EquityPoint[]; trades?: TradeRecord[]; summary?: BacktestSummary | null }) {
  if (equity.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-mute)", fontSize: 12 }}>
        暂无资金曲线数据
      </div>
    );
  }

  const initialCapital = summary?.initial_capital ?? 10000;
  const xs = equity.map(p => new Date(p.time * 1000).toISOString().slice(0, 10));
  const ys = equity.map(p => p.equity);

  const trace: Plotly.Data = {
    type: "scatter",
    mode: "lines",
    x: xs,
    y: ys,
    line: { color: "rgba(38,166,154,0.35)", width: 1.5 }, // Make real-time equity semi-transparent
    fill: "tozeroy",
    fillcolor: "rgba(38,166,154,0.08)",
    name: "浮动资金",
    hovertemplate: "%{x}<br>浮动: $%{y:,.2f}<extra></extra>",
  };

  // Build balance curve directly from trades to include entry/exit details
  let cumBal = initialCapital;
  const balanceX: string[] = [xs[0] || new Date().toISOString().slice(0, 10)];
  const balanceY: number[] = [cumBal];
  const balanceHover: string[] = ["初始本金"];

  const sortedTrades = [...trades].sort((a, b) => (a.exit_time || 0) - (b.exit_time || 0));
  for (const t of sortedTrades) {
    if (t.exit_time) {
      cumBal += t.pnl_abs || 0;
      balanceX.push(new Date(t.exit_time * 1000).toISOString().slice(0, 10));
      balanceY.push(cumBal);
      balanceHover.push(
        `进场价: $${t.entry_price?.toFixed(2) || 0}<br>` +
        `出场价: $${t.exit_price?.toFixed(2) || 0}<br>` +
        `数量: ${t.size?.toFixed(4) || 0}<br>` +
        `盈亏: ${t.pnl_abs >= 0 ? "+" : ""}$${t.pnl_abs?.toFixed(2) || 0}`
      );
    }
  }

  const balanceTrace: Plotly.Data | null = balanceY.length > 1 ? {
    type: "scatter",
    mode: "lines",
    line: { shape: "vh", color: "#26a69a", width: 2 }, // Step-line for closed trades
    x: balanceX,
    y: balanceY,
    text: balanceHover,
    name: "结算资金",
    hovertemplate: "%{x}<br>结算: $%{y:,.2f}<br><br>%{text}<extra></extra>",
  } : null;


  const baseline: Plotly.Data = {
    type: "scatter",
    mode: "lines",
    x: [xs[0], xs[xs.length - 1]],
    y: [initialCapital, initialCapital],
    line: { color: "rgba(255,255,255,0.15)", width: 1, dash: "dot" },
    hoverinfo: "none",
    showlegend: false,
  };

  const data = balanceTrace ? [baseline, trace, balanceTrace] : [baseline, trace];

  let maxDd = summary?.max_drawdown_pct ? Math.abs(summary.max_drawdown_pct) / 100 : 0;
  
  // Use precise timestamps from backend if available
  let f_x0: string | undefined;
  let f_x1: string | undefined;
  let f_annotationY: number | undefined;

  if (summary?.max_dd_peak_ts && summary?.max_dd_trough_ts) {
    f_x0 = new Date(summary.max_dd_peak_ts * 1000).toISOString().slice(0, 10);
    f_x1 = new Date(summary.max_dd_trough_ts * 1000).toISOString().slice(0, 10);
    let minDiff = Infinity;
    for (let i = 0; i < equity.length; i++) {
      const diff = Math.abs(equity[i].time - summary.max_dd_trough_ts);
      if (diff < minDiff) {
        minDiff = diff;
        f_annotationY = equity[i].equity;
      }
    }
  } else {
    // Fallback logic for floating
    let localMaxDd = 0;
    let maxDdPeakIdx = 0;
    let maxDdTroughIdx = 0;
    let currentPeakVal = -Infinity;
    let currentPeakIdx = 0;

    for (let i = 0; i < ys.length; i++) {
      const y = ys[i];
      if (y > currentPeakVal) {
        currentPeakVal = y;
        currentPeakIdx = i;
      }
      const dd = currentPeakVal > 0 ? (currentPeakVal - y) / currentPeakVal : 0;
      if (dd > localMaxDd) {
        localMaxDd = dd;
        maxDdPeakIdx = currentPeakIdx;
        maxDdTroughIdx = i;
      }
    }
    
    if (!summary?.max_drawdown_pct) maxDd = localMaxDd;
    if (localMaxDd > 0) {
      f_x0 = xs[maxDdPeakIdx];
      f_x1 = xs[maxDdTroughIdx];
      f_annotationY = ys[maxDdTroughIdx];
    }
  }

  // Closed drawdown annotation
  let c_x0: string | undefined;
  let c_x1: string | undefined;
  let c_annotationY: number | undefined;
  let closedMaxDd = summary?.closed_max_drawdown_pct ? Math.abs(summary.closed_max_drawdown_pct) / 100 : 0;

  if (summary?.closed_max_dd_peak_ts && summary?.closed_max_dd_trough_ts) {
    c_x0 = new Date(summary.closed_max_dd_peak_ts * 1000).toISOString().slice(0, 10);
    c_x1 = new Date(summary.closed_max_dd_trough_ts * 1000).toISOString().slice(0, 10);
    let minDiff = Infinity;
    for (let i = 0; i < balanceY.length; i++) {
      const bTs = new Date(balanceX[i]).getTime() / 1000;
      const diff = Math.abs(bTs - summary.closed_max_dd_trough_ts);
      if (diff < minDiff) {
        minDiff = diff;
        c_annotationY = balanceY[i];
      }
    }
  }

  const shapes: Partial<Plotly.Shape>[] = [];
  if (maxDd > 0 && f_x0 && f_x1) {
    shapes.push({
      type: "rect",
      xref: "x", yref: "paper",
      x0: f_x0, x1: f_x1,
      y0: 0, y1: 1,
      fillcolor: "rgba(239, 83, 80, 0.1)", // slightly lighter red
      line: { width: 0 }
    });
  }
  if (closedMaxDd > 0 && c_x0 && c_x1) {
    shapes.push({
      type: "rect",
      xref: "x", yref: "paper",
      x0: c_x0, x1: c_x1,
      y0: 0, y1: 1,
      fillcolor: "rgba(239, 83, 80, 0.15)", // red tint for closed dd
      line: { width: 0 }
    });
  }

  const annotations: Partial<Plotly.Annotations>[] = [];
  const durText = summary?.max_drawdown_duration_days ? `<br>时长: ${summary.max_drawdown_duration_days}天` : "";

  if (maxDd > 0 && f_x1 && f_annotationY !== undefined) {
    annotations.push({
      x: f_x1,
      y: f_annotationY,
      xref: "x", yref: "y",
      text: `最大浮亏 -${(maxDd * 100).toFixed(2)}%`,
      showarrow: true,
      arrowcolor: "#ef5350",
      font: { color: "#ef5350", size: 10 },
      ax: 0, ay: 40
    });
  }
  if (closedMaxDd > 0 && c_x1 && c_annotationY !== undefined) {
    annotations.push({
      x: c_x1,
      y: c_annotationY,
      xref: "x", yref: "y",
      text: `最大回撤 -${(closedMaxDd * 100).toFixed(2)}%${durText}`,
      showarrow: true,
      arrowcolor: "#ef5350",
      font: { color: "#ef5350", size: 10, weight: "bold" } as any,
      ax: 0, ay: -40
    });
  }

  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { color: "#888", size: 10 },
    margin: { t: 10, r: 20, b: 36, l: 60 },
    xaxis: {
      gridcolor: "#1a1a1a",
      tickfont: { size: 10 },
      showgrid: true,
      type: "date",
      tickformat: "%Y-%m",
      hoverformat: "%Y-%m-%d",
      dtick: "M3",
    },
    yaxis: { gridcolor: "#1a1a1a", tickfont: { size: 10 }, tickprefix: "$", showgrid: true },
    hovermode: "x unified",
    showlegend: false,
    shapes,
    annotations,
  };

  return (
    <Plot
      data={data}
      layout={layout}
      config={{ responsive: true, displayModeBar: false }}
      style={{ width: "100%", height: "100%" }}
      useResizeHandler
    />
  );
}

function TradesTab({ trades }: { trades: TradeRecord[] }) {
  const [sort, setSort] = useState<{ key: keyof TradeRecord; asc: boolean }>({ key: "entry_time", asc: false });

  const sorted = [...trades].sort((a, b) => {
    const va = a[sort.key] ?? 0;
    const vb = b[sort.key] ?? 0;
    return sort.asc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  function toggleSort(key: keyof TradeRecord) {
    setSort(s => ({ key, asc: s.key === key ? !s.asc : false }));
  }

  const thStyle: React.CSSProperties = {
    padding: "6px 10px", textAlign: "left", fontSize: 10, fontWeight: 600,
    color: "var(--text-mute)", borderBottom: "1px solid var(--border)",
    cursor: "pointer", userSelect: "none", whiteSpace: "nowrap",
    background: "var(--bg)",
    position: "sticky", top: 0,
  };

  if (trades.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-mute)", fontSize: 12 }}>
        暂无交易记录
      </div>
    );
  }

  return (
    <div style={{ height: "100%", overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 40, textAlign: "center" }}>#</th>
            {[
              { key: "entry_time", label: "入场时间" },
              { key: "pair",       label: "标的" },
              { key: "direction",  label: "方向" },
              { key: "signal",     label: "信号" },
              { key: "entry_price",label: "入场价" },
              { key: "exit_price", label: "出场价" },
              { key: "size",       label: "数量" },
              { key: "exit_signal",label: "出场原因" },
              { key: "pnl_pct",    label: "盈亏 %" },
              { key: "pnl_abs",    label: "盈亏 USDT" },
            ].map(col => (
              <th key={col.key} style={thStyle} onClick={() => toggleSort(col.key as keyof TradeRecord)}>
                {col.label} {sort.key === col.key ? (sort.asc ? "↑" : "↓") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => (
            <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <td style={{ padding: "5px 10px", textAlign: "center", color: "var(--text-mute)", fontFamily: "monospace", fontSize: 10 }}>{trades.length - i}</td>
              <td style={{ padding: "5px 10px", color: "var(--text-mute)", whiteSpace: "nowrap" }}>{ts(t.entry_time)}</td>
              <td style={{ padding: "5px 10px", color: "var(--text)", fontWeight: 600 }}>{t.pair}</td>
              <td style={{ padding: "5px 10px", color: t.direction === "long" ? "var(--up)" : "var(--down)", fontWeight: 600 }}>
                {t.direction === "long" ? "做多" : "做空"}
              </td>
              <td style={{ padding: "5px 10px", color: "var(--text-mute)", fontSize: 10, whiteSpace: "nowrap" }}>{t.signal ?? "-"}</td>
              <td style={{ padding: "5px 10px", fontFamily: "monospace", color: "var(--text)" }}>{t.entry_price.toFixed(2)}</td>
              <td style={{ padding: "5px 10px", fontFamily: "monospace", color: "var(--text)" }}>{t.exit_price.toFixed(2)}</td>
              <td style={{ padding: "5px 10px", fontFamily: "monospace", color: "var(--text)" }}>{t.size != null ? t.size.toFixed(4) : "-"}</td>
              <td style={{ padding: "5px 10px", color: "var(--text-mute)", fontSize: 10, whiteSpace: "nowrap" }}>{t.exit_signal ?? "-"}</td>
              <td style={{ padding: "5px 10px", fontFamily: "monospace", fontWeight: 600, color: t.pnl_pct >= 0 ? "var(--up)" : "var(--down)" }}>
                {fmt(t.pnl_pct, 2, "%")}
              </td>
              <td style={{ padding: "5px 10px", fontFamily: "monospace", color: t.pnl_abs >= 0 ? "var(--up)" : "var(--down)" }}>
                {fmt(t.pnl_abs, 2, " USDT")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressBar({ iter, total, method }: { iter: number; total: number; method: 'grid' | 'annealing' }) {
  const [startTime] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const elapsedSec = (now - startTime) / 1000;
  const pct = total > 0 ? (iter / total) * 100 : 0;
  const etaSec = iter > 0 && total > 0 ? (elapsedSec / iter) * (total - iter) : 0;

  const fmtTime = (s: number) => {
    if (s < 60) return `${s.toFixed(0)}秒`;
    const m = Math.floor(s / 60);
    return `${m}分${(s - m * 60).toFixed(0)}秒`;
  };

  return (
    <div style={{ padding: "12px 16px 16px 16px", borderTop: "1px solid var(--border)", background: "rgba(38,166,154,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--up)" }}>
          ⚡ {method === 'grid' ? '穷举' : '退火'}优化中
          {iter > 0
            ? ` · 已完成 ${iter} / ${total} 组`
            : total > 0 ? ` · 共 ${total} 组,正在跑第 1 组...` : ' · 准备中...'}
        </span>
        <span style={{ fontSize: 14, fontFamily: "monospace", fontWeight: 700, color: "var(--up)" }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div style={{ width: "100%", height: 14, background: "rgba(255,255,255,0.08)", borderRadius: 7, overflow: "hidden", border: "1px solid rgba(38,166,154,0.3)", position: "relative" }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          background: "linear-gradient(90deg, var(--up) 0%, #4dd0c0 100%)",
          transition: "width .25s ease-out",
          boxShadow: "0 0 10px rgba(38,166,154,0.5)",
        }} />
        {/* 滚动条纹动画(总在动,即使进度未变也有视觉反馈) */}
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
          background: "repeating-linear-gradient(45deg, transparent 0, transparent 10px, rgba(255,255,255,0.05) 10px, rgba(255,255,255,0.05) 20px)",
          animation: "progress-stripes 1s linear infinite",
        }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--text-mute)", fontFamily: "monospace" }}>
        <span>已用 {fmtTime(elapsedSec)}</span>
        {iter > 0 && total > iter && <span>预计还需 {fmtTime(etaSec)}</span>}
        {iter > 0 && <span>平均 {(elapsedSec / iter).toFixed(1)} 秒/组</span>}
      </div>
      <style>{`@keyframes progress-stripes { 0% { background-position: 0 0; } 100% { background-position: 40px 0; } }`}</style>
    </div>
  );
}

function OptimizeTab({
  onOptimizeStart,
  optimizeStatus,
  optimizeEpochs = [],
  optimizeError = "",
  optimizeProgress = { iter: 0, total: 0 },
  onOptimizeCsvDownload,
  onApplyBestParams,
  strategyCode,
  strategyName,
}: {
  onOptimizeStart?: (paramRows: ParamRow[], startDate: string, method: 'grid' | 'annealing', target: string) => void;
  optimizeStatus: 'idle' | 'running' | 'completed' | 'failed';
  optimizeEpochs: EpochRecord[];
  optimizeError: string;
  optimizeProgress?: { iter: number; total: number };
  onOptimizeCsvDownload?: () => void;
  onApplyBestParams?: (params: Record<string, string>) => void;
  strategyCode?: string;
  strategyName?: string;
}) {
  const detectedParams = extractOptimizableParams(strategyCode);

  // localStorage key:基于"策略名 + 参数名集合"
  // 不用代码 hash(改一个空格/注释就失效),也不只用策略名(防同名冲突)
  // 参数名集合稳定,只要策略真正变了(参数变化)才换 key
  const strategyHash = (() => {
    const name = (strategyName ?? '_').trim();
    const paramSig = detectedParams.map(p => p.name).sort().join(',');
    let h = 0;
    const s = name + '|' + paramSig;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return `optimize_cfg_${h}`;
  })();

  // 合并:detectedParams 是当前策略真实有的参数,saved 是用户上次的设置
  // 优先用 saved 里的 from/to/step/enabled/priority,但只保留 detectedParams 里仍存在的参数
  const mergeRows = (detected: ParamRow[], saved: ParamRow[]): ParamRow[] => {
    const savedMap = new Map(saved.map(r => [r.name, r]));
    return detected.map(d => {
      const s = savedMap.get(d.name);
      return s ? { ...d, start: s.start, stop: s.stop, step: s.step, enabled: s.enabled, priority: s.priority } : d;
    });
  };

  const [paramRows, setParamRows] = useState<ParamRow[]>(detectedParams);
  // S4 时间范围:固定 7 档(年数),保证形态发育所需的足够预热历史
  const [yearsBack, setYearsBack] = useState<number>(6);
  const [method, setMethod] = useState<'grid' | 'annealing'>('grid');
  const [target, setTarget] = useState<string>('calmar');

  // 策略变化时:先尝试从 localStorage 读取上次配置,合并到 detectedParams
  useEffect(() => {
    if (detectedParams.length === 0) return;
    try {
      const raw = localStorage.getItem(strategyHash);
      if (raw) {
        const saved = JSON.parse(raw) as { paramRows?: ParamRow[]; method?: 'grid'|'annealing'; target?: string };
        setParamRows(saved.paramRows ? mergeRows(detectedParams, saved.paramRows) : detectedParams);
        if (saved.method) setMethod(saved.method);
        if (saved.target) setTarget(saved.target);
        return;
      }
    } catch { /* corrupted storage,fallback to defaults */ }
    setParamRows(detectedParams);
  }, [strategyHash]); // eslint-disable-line react-hooks/exhaustive-deps

  // 任何配置变化都保存到 localStorage(策略 hash 隔离)
  useEffect(() => {
    if (paramRows.length === 0) return;
    try {
      localStorage.setItem(strategyHash, JSON.stringify({ paramRows, method, target }));
    } catch { /* quota exceeded etc. */ }
  }, [paramRows, method, target, strategyHash]);

  const updateRow = (i: number, f: Partial<ParamRow>) => {
    const next = [...paramRows];
    next[i] = { ...next[i], ...f };
    setParamRows(next);
  };

  // 排序状态:key 是字段名,dir 是升降序。默认按收益降序
  type SortKey = 'profit_pct' | 'drawdown_pct' | 'win_rate_pct' | 'trades';
  const [sortKey, setSortKey] = useState<SortKey>('profit_pct');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(k);
      // 回撤越小越好(数值越接近 0),所以切到回撤默认升序;其他默认降序
      setSortDir(k === 'drawdown_pct' ? 'asc' : 'desc');
    }
  };

  const sorted = [...optimizeEpochs].sort((a, b) => {
    // 回撤字段需要按绝对值比较(因为它是负数)
    const av = sortKey === 'drawdown_pct' ? Math.abs(a.drawdown_pct) : a[sortKey];
    const bv = sortKey === 'drawdown_pct' ? Math.abs(b.drawdown_pct) : b[sortKey];
    return sortDir === 'desc' ? bv - av : av - bv;
  });
  const best = sorted[0];
  const enabledRows = paramRows.filter(r => r.enabled);
  const allEnabled = paramRows.length > 0 && enabledRows.length === paramRows.length;
  const comboCount = enabledRows.reduce((acc, row) => {
    if (row.step <= 0 || row.stop < row.start) return acc;
    return acc * (Math.floor((row.stop - row.start) / row.step) + 1);
  }, 1);

  const thStyle: React.CSSProperties = { padding: "4px 8px", fontSize: 10, fontWeight: 600, color: "var(--text-mute)", textAlign: "left", background: "rgba(255,255,255,0.02)" };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Top: Controls (full width) */}
      <div style={{ borderBottom: "1px solid var(--border)", background: "rgba(255,255,255,0.01)", display: "flex", flexDirection: "column", flex: "1 1 60%", minHeight: 0 }}>
        <div style={{ padding: "12px 16px", flex: 1, overflowY: "auto", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>自动识别的优化参数</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 10, color: "var(--text-mute)" }}>
                已选 {enabledRows.length}/{paramRows.length} · 预计组合 {enabledRows.length ? comboCount : 0} 组
              </span>
              <button
                onClick={() => setParamRows(detectedParams)}
                disabled={detectedParams.length === 0}
                style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, border: "1px solid #333", background: "rgba(255,255,255,0.04)", color: detectedParams.length ? "var(--text-mute)" : "#555", cursor: detectedParams.length ? "pointer" : "not-allowed" }}
              >
                重新识别
              </button>
            </div>
          </div>
          {detectedParams.length === 0 && (
            <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.18)", color: "#f59e0b", fontSize: 10, lineHeight: 1.5 }}>
              未识别到数值参数。请在 S3 策略中使用 parameters.get("参数名", 默认值) 或 p.get("参数名", 默认值)。
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "auto", borderCollapse: "collapse", fontSize: 11, tableLayout: "auto" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 70, textAlign: "center" }}>
                    <input
                      type="checkbox"
                      checked={allEnabled}
                      onChange={e => setParamRows(paramRows.map(row => ({ ...row, enabled: e.target.checked })))}
                      title="全选/全不选"
                      style={{ width: 13, height: 13, accentColor: "var(--up)" }}
                    />
                    <span style={{ marginLeft: 4 }}>Active</span>
                  </th>
                  <th style={{ ...thStyle, width: 220 }}>Parameter</th>
                  <th style={{ ...thStyle, width: 100 }}>From</th>
                  <th style={{ ...thStyle, width: 100 }}>To</th>
                  <th style={{ ...thStyle, width: 90 }}>Step</th>
                  <th style={{ ...thStyle, width: 100 }}>Default</th>
                  <th style={{ ...thStyle, width: 80 }}>Priority</th>
                </tr>
              </thead>
              <tbody>
                {paramRows.map((r, i) => (
                  <tr key={r.name} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={!!r.enabled}
                        onChange={e => updateRow(i, { enabled: e.target.checked })}
                        title="参与优化"
                        style={{ width: 13, height: 13, accentColor: "var(--up)" }}
                      />
                    </td>
                    <td style={{ padding: "4px 8px", color: "var(--text)", whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>{r.name}</td>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="number" value={r.start} onChange={e => updateRow(i, { start: Number(e.target.value) })} style={{ width: 80, background: "#1a1a1a", border: "1px solid #333", color: "#eee", fontSize: 11, padding: "3px 6px" }} />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="number" value={r.stop} onChange={e => updateRow(i, { stop: Number(e.target.value) })} style={{ width: 80, background: "#1a1a1a", border: "1px solid #333", color: "#eee", fontSize: 11, padding: "3px 6px" }} />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="number" value={r.step} onChange={e => updateRow(i, { step: Number(e.target.value) })} style={{ width: 70, background: "#1a1a1a", border: "1px solid #333", color: "#eee", fontSize: 11, padding: "3px 6px" }} />
                    </td>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace", color: "var(--text-mute)" }}>{r.defaultValue}</td>
                    <td style={{ padding: "4px 6px" }}>
                      <input type="number" value={r.priority ?? i + 1} onChange={e => updateRow(i, { priority: Number(e.target.value) })} style={{ width: 60, background: "#1a1a1a", border: "1px solid #333", color: "#eee", fontSize: 11, padding: "3px 6px" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Action bar: 时间范围 + 算法 + 开始 横向一行 */}
        <div style={{ padding: 12, borderTop: "1px solid var(--border)", display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ fontSize: 10, color: "var(--text-mute)", marginBottom: 4 }}>回测时间范围</div>
            <select
              value={yearsBack}
              onChange={e => setYearsBack(Number(e.target.value))}
              style={{ width: "100%", background: "#1a1a1a", border: "1px solid #333", color: "#eee", fontSize: 11, padding: "6px 8px" }}
            >
              <option value={6}>近 6 年 (最稳健)</option>
              <option value={5.5}>近 5 年半</option>
              <option value={5}>近 5 年</option>
              <option value={4.5}>近 4 年半</option>
              <option value={4}>近 4 年</option>
              <option value={3.5}>近 3 年半</option>
              <option value={3}>近 3 年 (最短,形态可能不充分)</option>
            </select>
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ fontSize: 10, color: "var(--text-mute)", marginBottom: 4 }}>优化算法</div>
            <select
              value={method}
              onChange={e => setMethod(e.target.value as 'grid' | 'annealing')}
              style={{ width: "100%", background: "#1a1a1a", border: "1px solid #333", color: "#eee", fontSize: 11, padding: "6px 8px" }}
            >
              <option value="grid">穷举 (Grid) — 跑完全部组合,适合参数 ≤ 3 个</option>
              <option value="annealing">模拟退火 (Annealing) — 随机采样 100 次,适合参数 ≥ 4 个</option>
            </select>
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <div style={{ fontSize: 10, color: "var(--text-mute)", marginBottom: 4 }}>优化目标 (BTC 趋势策略专用)</div>
            <select
              value={target}
              onChange={e => setTarget(e.target.value)}
              style={{ width: "100%", background: "#1a1a1a", border: "1px solid #333", color: "#eee", fontSize: 11, padding: "6px 8px" }}
            >
              <option value="calmar">Calmar 比率 (推荐) — 年化收益 ÷ 最大回撤</option>
              <option value="sortino">Sortino 比率 — 只惩罚下行波动</option>
              <option value="profit_factor">Profit Factor — 总盈利 ÷ 总亏损</option>
            </select>
          </div>
          <button
            onClick={() => {
              // 计算起始日期:今天向前推 yearsBack 年
              const d = new Date();
              d.setDate(d.getDate() - Math.round(yearsBack * 365));
              const startDate = d.toISOString().slice(0, 10);
              onOptimizeStart?.(enabledRows, startDate, method, target);
            }}
            disabled={optimizeStatus === "running" || enabledRows.length === 0}
            style={{
              padding: "8px 24px", borderRadius: 6, border: "none", fontWeight: 700, fontSize: 12,
              background: optimizeStatus === "running" || enabledRows.length === 0 ? "#444" : "var(--up)", color: "#fff", cursor: optimizeStatus === "running" || enabledRows.length === 0 ? "not-allowed" : "pointer",
              height: 32, whiteSpace: "nowrap",
            }}
          >
            {optimizeStatus === "running" ? "优化中..." : "开始优化"}
          </button>
        </div>
        <div style={{ padding: "0 12px 8px 12px", fontSize: 10, color: "var(--text-mute)", lineHeight: 1.6 }}>
          <div>
            {method === 'grid'
              ? `当前 ${enabledRows.length} 个参数共 ${comboCount} 组合,穷举将逐一回测。超 2000 组后端会拒绝。`
              : comboCount <= 100
                ? `退火每次随机扰动一个参数,固定采样 100 次。当前组合数 ${comboCount} 较少,建议改用穷举。`
                : `退火每次随机扰动一个参数,固定采样 100 次(不依赖总组合数)。当前组合数 ${comboCount} 较大,退火能在有限时间内逼近最优。`}
          </div>
          <div style={{ marginTop: 3, color: "#787b86" }}>
            {target === 'calmar' && '🎯 Calmar = 年化收益 ÷ 最大回撤,平衡收益与风险,BTC 趋势策略最优选。'}
            {target === 'sortino' && '🎯 Sortino 改进自夏普,只惩罚下行波动,对趋势策略的暴拉行情更公平。'}
            {target === 'profit_factor' && '🎯 Profit Factor 衡量盈亏比,趋势策略 (低胜率高盈亏比) 的核心指标。'}
          </div>
          <div style={{ marginTop: 3, color: "#787b86" }}>
            ✓ 完成后到 <a href="/report" style={{ color: "var(--up)" }}>/report</a> 做稳健性深度分析 (邻域稳定性 / Pareto 前沿 / 8 维过滤)。
          </div>
        </div>
        {/* 显眼进度条:跑起来就在这里,无论结果区有没有数据 */}
        {optimizeStatus === "running" && (
          <ProgressBar
            iter={optimizeProgress.iter}
            total={optimizeProgress.total || comboCount}
            method={method}
          />
        )}
      </div>

      {/* Bottom: Results */}
      <div style={{ flex: "1 1 40%", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
        <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <span style={{ fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>优化结果排名 ({optimizeEpochs.length})</span>
          {optimizeStatus === "running" && optimizeProgress.total > 0 && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(optimizeProgress.iter / optimizeProgress.total) * 100}%`, height: "100%", background: "var(--up)", transition: "width .2s" }} />
              </div>
              <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--text-mute)", whiteSpace: "nowrap" }}>
                {optimizeProgress.iter} / {optimizeProgress.total} · {((optimizeProgress.iter / optimizeProgress.total) * 100).toFixed(0)}%
              </span>
            </div>
          )}
          {optimizeEpochs.length > 0 && (
            <button onClick={onOptimizeCsvDownload} style={{ fontSize: 10, padding: "4px 10px", background: "rgba(0,168,100,0.1)", border: "1px solid var(--up)", color: "var(--up)", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}>下载 CSV</button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {optimizeStatus === "running" && optimizeEpochs.length === 0 ? (
            <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-mute)", gap: 12 }}>
              <div>正在寻找最优参数组合...</div>
              {optimizeProgress.total > 0 && (
                <>
                  <div style={{ width: 320, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ width: `${(optimizeProgress.iter / optimizeProgress.total) * 100}%`, height: "100%", background: "var(--up)", transition: "width .2s" }} />
                  </div>
                  <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--text)" }}>
                    {optimizeProgress.iter} / {optimizeProgress.total} ({((optimizeProgress.iter / optimizeProgress.total) * 100).toFixed(1)}%)
                  </div>
                </>
              )}
            </div>
          ) : optimizeEpochs.length > 0 ? (
            (() => {
              const paramKeys = Object.keys(optimizeEpochs[0].params);
              return (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>#</th>
                      {([
                        ['profit_pct', '收益 %'],
                        ['drawdown_pct', '回撤 %'],
                        ['win_rate_pct', '胜率 %'],
                        ['trades', '交易数'],
                      ] as [SortKey, string][]).map(([k, label]) => (
                        <th
                          key={k}
                          onClick={() => toggleSort(k)}
                          style={{ ...thStyle, cursor: 'pointer', userSelect: 'none', color: sortKey === k ? 'var(--up)' : (thStyle as React.CSSProperties).color }}
                          title="点击切换排序方向"
                        >
                          {label}{sortKey === k ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ' ⇅'}
                        </th>
                      ))}
                      {paramKeys.map(h => <th key={h} style={thStyle}>{h}</th>)}
                      <th style={thStyle}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((ep, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ padding: "4px 8px", color: "var(--text-mute)" }}>{i + 1}</td>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace", color: ep.profit_pct >= 0 ? "var(--up)" : "var(--down)" }}>{ep.profit_pct.toFixed(2)}%</td>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace", color: "var(--down)" }}>-{Math.abs(ep.drawdown_pct).toFixed(2)}%</td>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{ep.win_rate_pct.toFixed(1)}%</td>
                        <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>{ep.trades}</td>
                        {paramKeys.map(k => <td key={k} style={{ padding: "4px 8px", fontFamily: "monospace", color: "var(--text-mute)" }}>{ep.params[k]}</td>)}
                        <td style={{ padding: "4px 8px" }}>
                          <button onClick={() => onApplyBestParams?.(ep.params)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "none", background: "rgba(38,166,154,0.2)", color: "var(--up)", cursor: "pointer" }}>应用</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-mute)" }}>暂无优化数据</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── FTMO 风控标签页 ──────────────────────────────────────────────────────────

function FtmoLight({ label, status, observed, limit, unit = '%' }: {
  label: string; status: 'pass' | 'fail' | 'reached' | 'not_reached' | 'ok'
  observed?: number | null; limit?: number; unit?: string
}) {
  const pass = status === 'pass' || status === 'reached' || status === 'ok'
  const color = pass ? 'var(--up)' : 'var(--down)'
  const bg = pass ? 'rgba(38,166,154,0.08)' : 'rgba(239,83,80,0.08)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 8, background: bg, border: `1px solid ${color}33` }}>
      <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}` }} />
      <div style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{label}</div>
      {observed != null && limit != null && (
        <div className="num" style={{ fontSize: 12, color }}>
          {Math.abs(observed).toFixed(2)}{unit} / 限 {limit}{unit}
        </div>
      )}
      <div style={{ fontSize: 11, fontWeight: 700, color }}>{pass ? '✓ 通过' : '✗ 未通过'}</div>
    </div>
  )
}

function FtmoTab({ ftmoScan }: { ftmoScan?: FtmoScanResult | null }) {
  if (!ftmoScan) {
    return (
      <div style={{ padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🛡</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>尚无 FTMO 扫描结果</div>
        <div style={{ fontSize: 12, color: 'var(--text-mute)', lineHeight: 1.7 }}>
          完成回测后，前往{' '}
          <a href="/monte-carlo" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>风控分析页</a>
          {' '}运行完整 FTMO Swing 扫描。
        </div>
      </div>
    )
  }

  const { summary, daily_loss, total_loss, rolling_entry, consecutive_loss, monte_carlo, final_return_pct, trading_days, rules } = ftmoScan

  const verdictColor = summary.overall_verdict === 'pass' ? 'var(--up)' : summary.overall_verdict === 'fail' ? 'var(--down)' : 'var(--gold)'
  const verdictText = summary.overall_verdict === 'pass' ? '✓ 可申请 FTMO' : summary.overall_verdict === 'fail' ? '✗ 不符合 FTMO 规则' : '⚠ 边缘情况，需进一步评估'

  return (
    <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', maxHeight: '100%' }}>

      {/* 综合判定 */}
      <div style={{ padding: '12px 18px', borderRadius: 10, background: `${verdictColor}18`, border: `1px solid ${verdictColor}55`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: verdictColor }}>{verdictText}</div>
          <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 4 }}>
            规则：{rules.rule_set} · 日亏损限 {rules.daily_loss_pct}% · 总亏损限 {rules.total_loss_pct}% · 盈利目标 {rules.profit_target_pct}%
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 16, fontWeight: 700, color: final_return_pct >= 0 ? 'var(--up)' : 'var(--down)' }}>
            {final_return_pct >= 0 ? '+' : ''}{final_return_pct.toFixed(2)}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-mute)' }}>最终收益 · {trading_days} 交易日</div>
        </div>
      </div>

      {/* 3 灯 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <FtmoLight label={`每日亏损（日内最大 ${daily_loss.max_observed_pct.toFixed(2)}%，违规 ${daily_loss.violation_count} 次，最差 ${daily_loss.worst_day ?? '—'}）`}
          status={summary.daily_loss_status} observed={daily_loss.max_observed_pct} limit={daily_loss.limit_pct} />
        <FtmoLight label={`总亏损（相对初始本金最大 ${total_loss.max_observed_pct.toFixed(2)}%）`}
          status={summary.total_loss_status} observed={total_loss.max_observed_pct} limit={total_loss.limit_pct} />
        <FtmoLight label={`盈利目标（需 ≥ ${rules.profit_target_pct}%，当前 ${final_return_pct.toFixed(2)}%）`}
          status={summary.target_status} />
      </div>

      {/* 关键风控指标 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {[
          { label: '滚动起点失败率', value: `${rolling_entry.fail_rate_pct}%`, sub: `${rolling_entry.fail_count}/${rolling_entry.total_entries} 个起点会爆仓`, color: rolling_entry.fail_rate_pct < 30 ? 'var(--up)' : rolling_entry.fail_rate_pct < 60 ? 'var(--gold)' : 'var(--down)' },
          { label: '最坏起点最大回撤', value: `${rolling_entry.worst_drawdown_pct}%`, sub: '从最差起点开始的历史最大跌幅', color: 'var(--down)' },
          { label: '最大连亏笔数', value: `${consecutive_loss.max_consec_loss_count} 笔`, sub: `累计亏损 ${consecutive_loss.max_consec_loss_amount.toFixed(0)} USDT`, color: 'var(--text)' },
          { label: '蒙特卡洛通过率', value: monte_carlo ? `${monte_carlo.pass_rate_pct}%` : '—', sub: monte_carlo ? `${monte_carlo.n_simulations} 次模拟` : '数据不足', color: monte_carlo && monte_carlo.pass_rate_pct >= 60 ? 'var(--up)' : monte_carlo && monte_carlo.pass_rate_pct >= 30 ? 'var(--gold)' : 'var(--down)' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, color: 'var(--text-mute)', marginBottom: 6 }}>{label}</div>
            <div className="num" style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* 违规日期列表 */}
      {daily_loss.violations.length > 0 && (
        <div style={{ borderRadius: 8, border: '1px solid rgba(239,83,80,0.3)', overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', background: 'rgba(239,83,80,0.1)', fontSize: 11, fontWeight: 600, color: 'var(--down)' }}>
            日亏损违规明细（前 {Math.min(daily_loss.violations.length, 50)} 条）
          </div>
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {daily_loss.violations.map((v, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', borderTop: '1px solid var(--border)', fontSize: 11 }}>
                <span style={{ color: 'var(--text-mute)' }}>{v.date}</span>
                <span className="num" style={{ color: 'var(--down)' }}>-{v.daily_loss_pct.toFixed(2)}%</span>
                <span className="num" style={{ color: 'var(--text-mute)' }}>{v.day_open.toFixed(0)} → {v.day_low.toFixed(0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 跳转完整分析 */}
      <a href="/monte-carlo" style={{
        display: 'block', textAlign: 'center', padding: '10px', borderRadius: 6,
        background: 'var(--accent-soft)', border: '1px solid rgba(0,212,255,0.3)',
        color: 'var(--accent)', fontSize: 12, textDecoration: 'none', fontWeight: 600,
      }}>
        → 前往风控分析页运行完整蒙特卡洛 + FTMO 扫描
      </a>
    </div>
  )
}

function ExportTab({ xlsxDownloadUrl, strategyName, summary, trades }: {
  xlsxDownloadUrl?: string | null;
  strategyName?: string;
  summary?: BacktestSummary | null;
  trades?: TradeRecord[];
}) {
  const today = new Date().toISOString().slice(0, 10);
  const hasTrades = trades && trades.length > 0;
  const xlsxFilename = `${strategyName ?? "strategy"}_OKX_BTCUSDT.P_${today}.xlsx`;

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── xlsx 下载（单套参数详细绩效报告） ── */}
      <div style={{
        padding: "20px 24px", borderRadius: 12,
        background: "linear-gradient(135deg, rgba(59,130,246,0.15), rgba(59,130,246,0.05))",
        border: "1px solid rgba(59,130,246,0.35)",
        display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>下载回测报告 xlsx</div>
        <div style={{ fontSize: 11, color: "var(--text-mute)", lineHeight: 1.7 }}>
          5个Sheet：表现 · 交易分析 · 风险调整 · 交易清单 · 属性，格式与 TradingView 导出一致，可直接用 Excel 打开。
        </div>
        {xlsxDownloadUrl && hasTrades ? (
          <a
            href={`/py-api/api/backtest/dynamic/xlsx/${xlsxDownloadUrl}`}
            download={xlsxFilename}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: "#3B82F6", color: "#fff", textDecoration: "none", boxShadow: "0 2px 12px rgba(59,130,246,0.35)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            下载 xlsx ({trades.length} 笔交易)
          </a>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-mute)", fontStyle: "italic" }}>请先完成回测，再导出数据。</div>
        )}
      </div>

      {/* ── 提示：多参数优化 CSV 在 S4 下载 ── */}
      <div style={{ padding: "14px 20px", borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ fontSize: 11, color: "var(--text-mute)", lineHeight: 1.7 }}>
          💡 多套参数优化结果的 CSV 下载请前往下方「<span style={{ color: "#F59E0B" }}>04 · 参数优化</span>」层，完成优化后点击"下载 CSV"。
        </div>
      </div>
    </div>
  );
}


// ── Main Component ────────────────────────────────────────────────────────────

export default function StrategyTesterPanel({
  visible = true,
  onClose,
  summary,
  trades = [],
  equity = [],
  balance = [],
  xlsxDownloadUrl,
  strategyName,
  logs = [],
  running = false,
  strategyCode,
  defaultTab,
  fixedPanel = false,
  allowedTabs,
  onOptimizeStart,
  optimizeStatus = "idle",
  optimizeEpochs = [],
  optimizeError = "",
  optimizeProgress = { iter: 0, total: 0 },
  onOptimizeCsvDownload,
  onApplyBestParams,
  ftmoScan,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab ?? "回测控制台");
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  // 回测开始时自动展开面板（仅非固定模式）
  useEffect(() => {
    if (running && !fixedPanel) { setCollapsed(false); setHeight(h => h <= MIN_HEIGHT + 4 ? DEFAULT_HEIGHT : h); }
  }, [running, fixedPanel]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startH: height };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
  }, [height]);

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragRef.current) return;
      const delta = dragRef.current.startY - e.clientY;
      const newH = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, dragRef.current.startH + delta));
      setHeight(newH);
      if (newH <= MIN_HEIGHT + 4) setCollapsed(true);
      else setCollapsed(false);
    }
    function onMouseUp() {
      dragRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  if (!visible) return null;

  const panelHeight = collapsed ? MIN_HEIGHT : height;

  // fixedPanel: 高度由父级管理，无拖拽/折叠功能
  if (fixedPanel) {
    const visibleTabs = allowedTabs ?? [...TABS];
    const showTabBar = visibleTabs.length > 1;
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg-elev, #0d1117)" }}>
        {/* Tab bar */}
        <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", flexShrink: 0, paddingLeft: 4, background: "var(--bg-elev, #0d1117)" }}>
          {showTabBar ? visibleTabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: "7px 14px", fontSize: 11, fontWeight: activeTab === tab ? 600 : 400,
              background: "none", border: "none", cursor: "pointer",
              color: activeTab === tab ? "var(--text)" : "var(--text-mute)",
              borderBottom: activeTab === tab ? "2px solid var(--up)" : "2px solid transparent",
            }}>
              {tab}
            </button>
          )) : (
            <span style={{ padding: "7px 14px", fontSize: 11, fontWeight: 600, color: "var(--text)", borderBottom: "2px solid var(--up)" }}>
              {visibleTabs[0]}
            </span>
          )}
        </div>
        {/* Content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {activeTab === "回测控制台" && <ConsoleTab logs={logs} running={running} summary={summary} />}
          {activeTab === "资金曲线"   && <EquityTab equity={equity} balance={balance} trades={trades} summary={summary} />}
          {activeTab === "交易明细"   && <TradesTab trades={trades} />}
          {activeTab === "参数优化"   && <OptimizeTab onOptimizeStart={onOptimizeStart} optimizeStatus={optimizeStatus} optimizeEpochs={optimizeEpochs} optimizeError={optimizeError} optimizeProgress={optimizeProgress} onOptimizeCsvDownload={onOptimizeCsvDownload} onApplyBestParams={onApplyBestParams} strategyCode={strategyCode} strategyName={strategyName} />}
          {activeTab === "FTMO 风控"  && <FtmoTab ftmoScan={ftmoScan} />}
          {activeTab === "下载报告"   && <ExportTab xlsxDownloadUrl={xlsxDownloadUrl} strategyName={strategyName} summary={summary} trades={trades} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: "relative", background: "var(--bg-elev, #0d1117)", borderTop: "1px solid var(--border)",
      display: "flex", flexDirection: "column", height: panelHeight, flexShrink: 0,
      transition: dragRef.current ? "none" : "height 0.15s ease",
    }}>
      <div onMouseDown={onMouseDown} style={{ height: 5, cursor: "row-resize", flexShrink: 0, background: "transparent", borderTop: "1px solid var(--border)" }} />
      <div style={{ display: "flex", alignItems: "center", borderBottom: collapsed ? "none" : "1px solid var(--border)", flexShrink: 0, paddingLeft: 4, background: "var(--bg-elev, #0d1117)" }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => { setActiveTab(tab); setCollapsed(false); setHeight(h => h <= MIN_HEIGHT + 4 ? DEFAULT_HEIGHT : h); }} style={{
            padding: "7px 14px", fontSize: 11, fontWeight: activeTab === tab && !collapsed ? 600 : 400,
            background: "none", border: "none", cursor: "pointer",
            color: activeTab === tab && !collapsed ? "var(--text)" : "var(--text-mute)",
            borderBottom: activeTab === tab && !collapsed ? "2px solid var(--up)" : "2px solid transparent",
          }}>
            {tab}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => setCollapsed(!collapsed)} style={{ padding: "4px 10px", background: "none", border: "none", cursor: "pointer", color: "var(--text-mute)", fontSize: 11 }}>
          {collapsed ? "▲" : "▼"}
        </button>
        {onClose && (
          <button onClick={onClose} title="关闭面板" style={{ padding: "4px 10px", background: "none", border: "none", cursor: "pointer", color: "var(--text-mute)", fontSize: 13 }}>
            ×
          </button>
        )}
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          {activeTab === "回测控制台" && <ConsoleTab logs={logs} running={running} summary={summary} />}
          {activeTab === "资金曲线"   && <EquityTab equity={equity} balance={balance} trades={trades} summary={summary} />}
          {activeTab === "交易明细"   && <TradesTab trades={trades} />}
          {activeTab === "参数优化"   && <OptimizeTab onOptimizeStart={onOptimizeStart} optimizeStatus={optimizeStatus} optimizeEpochs={optimizeEpochs} optimizeError={optimizeError} optimizeProgress={optimizeProgress} onOptimizeCsvDownload={onOptimizeCsvDownload} onApplyBestParams={onApplyBestParams} strategyCode={strategyCode} strategyName={strategyName} />}
          {activeTab === "FTMO 风控"  && <FtmoTab ftmoScan={ftmoScan} />}
          {activeTab === "下载报告"   && <ExportTab xlsxDownloadUrl={xlsxDownloadUrl} strategyName={strategyName} summary={summary} trades={trades} />}
        </div>
      )}
    </div>
  );
}

