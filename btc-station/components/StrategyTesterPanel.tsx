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
}

export interface BacktestSummary {
  net_profit_pct: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  total_trades: number;
  sharpe?: number;
  sortino?: number;
  profit_factor?: number;
  initial_capital?: number;
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
  /** Download URL for the TV-compatible CSV */
  csvDownloadUrl?: string | null;
  /** Strategy name shown in export filename */
  strategyName?: string;
  /** Log lines from the backtest run */
  logs?: string[];
  /** Whether backtest is currently running */
  running?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = ["回测控制台", "资金曲线", "交易明细", "量化导出"] as const;
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

// ── Sub-components ────────────────────────────────────────────────────────────

function ConsoleTab({ logs, running, summary }: { logs: string[]; running: boolean; summary?: BacktestSummary | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {summary && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          {[
            { label: "总收益率",  value: fmt(summary.net_profit_pct, 2, "%"),    color: summary.net_profit_pct >= 0 ? "var(--up)" : "var(--down)" },
            { label: "最大回撤",  value: fmt(-Math.abs(summary.max_drawdown_pct), 2, "%"), color: "var(--down)" },
            { label: "胜率",      value: fmt(summary.win_rate_pct, 1, "%"),       color: "var(--text)" },
            { label: "交易笔数",  value: String(summary.total_trades),            color: "var(--text)" },
            { label: "Sharpe",    value: summary.sharpe != null ? summary.sharpe.toFixed(3) : "—", color: "var(--text)" },
            { label: "盈利因子",  value: summary.profit_factor != null ? summary.profit_factor.toFixed(3) : "—", color: "var(--text)" },
          ].map(c => (
            <div key={c.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 10, color: "var(--text-mute)" }}>{c.label}</span>
              <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "monospace", color: c.color }}>{c.value}</span>
            </div>
          ))}
        </div>
      )}
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

function EquityTab({ equity, initialCapital }: { equity: EquityPoint[]; initialCapital: number }) {
  if (equity.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-mute)", fontSize: 12 }}>
        暂无资金曲线数据
      </div>
    );
  }

  const xs = equity.map(p => new Date(p.time * 1000).toISOString().slice(0, 10));
  const ys = equity.map(p => p.equity);
  const colors = ys.map(y => y >= initialCapital ? "#26a69a" : "#ef5350");

  const trace: Plotly.Data = {
    type: "scatter",
    mode: "lines",
    x: xs,
    y: ys,
    line: { color: "#26a69a", width: 1.5 },
    fill: "tozeroy",
    fillcolor: "rgba(38,166,154,0.08)",
    hovertemplate: "%{x}<br>资金: $%{y:,.2f}<extra></extra>",
  };

  const baseline: Plotly.Data = {
    type: "scatter",
    mode: "lines",
    x: [xs[0], xs[xs.length - 1]],
    y: [initialCapital, initialCapital],
    line: { color: "rgba(255,255,255,0.15)", width: 1, dash: "dot" },
    hoverinfo: "none",
    showlegend: false,
  };

  const layout: Partial<Plotly.Layout> = {
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { color: "#888", size: 10 },
    margin: { t: 10, r: 20, b: 36, l: 60 },
    xaxis: { gridcolor: "#1a1a1a", tickfont: { size: 10 }, showgrid: true },
    yaxis: { gridcolor: "#1a1a1a", tickfont: { size: 10 }, tickprefix: "$", showgrid: true },
    hovermode: "x unified",
    showlegend: false,
  };

  return (
    <Plot
      data={[baseline, trace]}
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
            {[
              { key: "entry_time", label: "入场时间" },
              { key: "pair",       label: "标的" },
              { key: "direction",  label: "方向" },
              { key: "entry_price",label: "入场价" },
              { key: "exit_price", label: "出场价" },
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
              <td style={{ padding: "5px 10px", color: "var(--text-mute)", whiteSpace: "nowrap" }}>{ts(t.entry_time)}</td>
              <td style={{ padding: "5px 10px", color: "var(--text)", fontWeight: 600 }}>{t.pair}</td>
              <td style={{ padding: "5px 10px", color: t.direction === "long" ? "var(--up)" : "var(--down)", fontWeight: 600 }}>
                {t.direction === "long" ? "做多" : "做空"}
              </td>
              <td style={{ padding: "5px 10px", fontFamily: "monospace", color: "var(--text)" }}>{t.entry_price.toFixed(2)}</td>
              <td style={{ padding: "5px 10px", fontFamily: "monospace", color: "var(--text)" }}>{t.exit_price.toFixed(2)}</td>
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

function ExportTab({ csvDownloadUrl, strategyName, summary }: {
  csvDownloadUrl?: string | null;
  strategyName?: string;
  summary?: BacktestSummary | null;
}) {
  const filename = `BTC-USDT_${strategyName ?? "strategy"}_${new Date().toISOString().slice(0, 10)}.csv`;

  return (
    <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Primary CTA */}
      <div style={{
        padding: "20px 24px", borderRadius: 12,
        background: "linear-gradient(135deg, rgba(0,168,100,0.15), rgba(0,168,100,0.05))",
        border: "1px solid rgba(0,168,100,0.35)",
        display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start",
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
          导出 quant-lab.org 标准 CSV
        </div>
        <div style={{ fontSize: 11, color: "var(--text-mute)", lineHeight: 1.7 }}>
          191 列 TradingView Assistant 兼容格式，可直接上传到{" "}
          <span style={{ color: "var(--up)" }}>quant-lab.org</span>{" "}
          进行蒙特卡洛稳健性分析与过拟合检验。
        </div>
        {csvDownloadUrl ? (
          <a
            href={csvDownloadUrl}
            download={filename}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "10px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700,
              background: "var(--up)", color: "#fff", textDecoration: "none",
              boxShadow: "0 2px 12px rgba(0,168,100,0.35)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            下载 CSV
          </a>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-mute)", fontStyle: "italic" }}>
            请先在策略编辑器中完成回测，再导出数据。
          </div>
        )}
      </div>

      {/* Summary preview */}
      {summary && (
        <div style={{ fontSize: 11, color: "var(--text-mute)", lineHeight: 1.8 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>预览数据摘要</div>
          <div>净收益率: <span style={{ color: summary.net_profit_pct >= 0 ? "var(--up)" : "var(--down)", fontFamily: "monospace" }}>{fmt(summary.net_profit_pct, 2, "%")}</span></div>
          <div>最大回撤: <span style={{ color: "var(--down)", fontFamily: "monospace" }}>{(-Math.abs(summary.max_drawdown_pct)).toFixed(2)}%</span></div>
          <div>胜率: <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{fmt(summary.win_rate_pct, 1, "%")}</span></div>
          <div>交易笔数: <span style={{ fontFamily: "monospace", color: "var(--text)" }}>{summary.total_trades}</span></div>
        </div>
      )}
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
  csvDownloadUrl,
  strategyName,
  logs = [],
  running = false,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("回测控制台");
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [collapsed, setCollapsed] = useState(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

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

  return (
    <div style={{
      position: "relative",
      background: "var(--bg-elev, #0d1117)",
      borderTop: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      height: panelHeight,
      flexShrink: 0,
      transition: dragRef.current ? "none" : "height 0.15s ease",
    }}>
      {/* ── Drag handle ── */}
      <div
        onMouseDown={onMouseDown}
        style={{
          height: 5, cursor: "row-resize", flexShrink: 0,
          background: "transparent",
          borderTop: "1px solid var(--border)",
        }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
      />

      {/* ── Tab bar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 0,
        borderBottom: collapsed ? "none" : "1px solid var(--border)",
        flexShrink: 0, paddingLeft: 4,
        background: "var(--bg-elev, #0d1117)",
      }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setCollapsed(false); setHeight(h => h <= MIN_HEIGHT + 4 ? DEFAULT_HEIGHT : h); }}
            style={{
              padding: "7px 14px", fontSize: 11, fontWeight: activeTab === tab && !collapsed ? 600 : 400,
              background: "none", border: "none", cursor: "pointer",
              color: activeTab === tab && !collapsed ? "var(--text)" : "var(--text-mute)",
              borderBottom: activeTab === tab && !collapsed ? "2px solid var(--up)" : "2px solid transparent",
              transition: "color 0.15s, border-color 0.15s",
              whiteSpace: "nowrap",
            }}
          >
            {tab}
            {tab === "交易明细" && trades.length > 0 && (
              <span style={{ marginLeft: 4, fontSize: 9, padding: "1px 5px", borderRadius: 10, background: "rgba(255,255,255,0.08)", color: "var(--text-mute)" }}>
                {trades.length}
              </span>
            )}
          </button>
        ))}

        <div style={{ flex: 1 }} />

        {/* Collapse / expand toggle */}
        <button
          onClick={() => {
            if (collapsed) { setCollapsed(false); setHeight(DEFAULT_HEIGHT); }
            else setCollapsed(true);
          }}
          title={collapsed ? "展开" : "收起"}
          style={{ padding: "4px 10px", background: "none", border: "none", cursor: "pointer", color: "var(--text-mute)", fontSize: 11 }}
        >
          {collapsed ? "▲" : "▼"}
        </button>

        {onClose && (
          <button
            onClick={onClose}
            title="关闭面板"
            style={{ padding: "4px 10px", background: "none", border: "none", cursor: "pointer", color: "var(--text-mute)", fontSize: 13 }}
          >
            ×
          </button>
        )}
      </div>

      {/* ── Content area ── */}
      {!collapsed && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          {activeTab === "回测控制台" && <ConsoleTab logs={logs} running={running} summary={summary} />}
          {activeTab === "资金曲线"   && <EquityTab equity={equity} initialCapital={summary?.initial_capital ?? 10000} />}
          {activeTab === "交易明细"   && <TradesTab trades={trades} />}
          {activeTab === "量化导出"   && <ExportTab csvDownloadUrl={csvDownloadUrl} strategyName={strategyName} summary={summary} />}
        </div>
      )}
    </div>
  );
}
