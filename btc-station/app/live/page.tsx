"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  startLive,
  stopLive,
  getLiveStatus,
  getLiveMetrics,
  listMyStrategies,
  type StrategyMeta,
  type LiveStartConfig,
} from "@/lib/freqtrade-api";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LiveStatus {
  running: boolean;
  dry_run?: boolean;
  strategy_class?: string;
  timeframe?: string;
  stake_amount?: number;
  pid?: number;
  log_tail?: string[];
}

interface OpenTrade {
  trade_id: number;
  pair: string;
  open_rate: number;
  current_rate: number;
  profit_pct: number;
  profit_abs: number;
  amount: number;
  open_date: string;
}

interface ProfitSummary {
  profit_all_coin: number;
  profit_all_percent: number;
  profit_closed_coin: number;
  profit_closed_percent: number;
  trade_count: number;
  closed_trade_count: number;
  winning_trades: number;
  losing_trades: number;
  best_pair: string;
  best_rate: number;
}

interface Metrics {
  running: boolean;
  dry_run: boolean;
  strategy_class?: string;
  timeframe?: string;
  stake_amount?: number;
  profit?: ProfitSummary;
  open_trades?: OpenTrade[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | undefined | null, decimals = 2, suffix = "") {
  if (n == null || isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(decimals)}${suffix}`;
}

function pnlColor(n: number | undefined | null) {
  if (n == null) return "var(--text-mute)";
  return n >= 0 ? "var(--up)" : "var(--dn)";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "16px 20px",
      minWidth: 140,
      flex: "1 1 140px",
    }}>
      <div style={{ fontSize: 11, color: "var(--text-mute)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color ?? "var(--text)", fontFamily: "monospace" }}>{value}</div>
    </div>
  );
}

function LogTerminal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);

  return (
    <div ref={ref} style={{
      background: "#0a0a0a",
      border: "1px solid #222",
      borderRadius: 8,
      padding: "12px 14px",
      fontFamily: "'Fira Code', 'Consolas', monospace",
      fontSize: 12,
      color: "#a8ff78",
      height: 280,
      overflowY: "auto",
      lineHeight: 1.6,
      whiteSpace: "pre-wrap",
      wordBreak: "break-all",
    }}>
      {lines.length === 0
        ? <span style={{ color: "#555" }}>[ 暂无日志 ]</span>
        : lines.map((l, i) => {
            const color = l.includes("ERROR") || l.includes("error")
              ? "#ff6b6b"
              : l.includes("WARNING") || l.includes("warn")
              ? "#ffd93d"
              : "#a8ff78";
            return <div key={i} style={{ color }}>{l}</div>;
          })
      }
    </div>
  );
}

// ── Start Form ────────────────────────────────────────────────────────────────

function StartForm({
  strategies,
  onStart,
  loading,
}: {
  strategies: StrategyMeta[];
  onStart: (cfg: LiveStartConfig) => void;
  loading: boolean;
}) {
  const [strategyId, setStrategyId] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [timeframe, setTimeframe] = useState("4h");
  const [stakeAmount, setStakeAmount] = useState(100);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!strategyId) return;
    onStart({
      strategy_id: strategyId,
      dry_run: dryRun,
      timeframe,
      stake_amount: stakeAmount,
      okx_api_key: apiKey,
      okx_secret: secret,
      okx_password: password,
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 13,
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 12,
    color: "var(--text-mute)",
    marginBottom: 4,
    fontWeight: 500,
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {/* Strategy */}
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>选择策略</label>
          <select value={strategyId} onChange={e => setStrategyId(e.target.value)} style={inputStyle} required>
            <option value="">— 请选择 —</option>
            {strategies.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.class_name})</option>
            ))}
          </select>
        </div>

        {/* Timeframe */}
        <div>
          <label style={labelStyle}>K 线周期</label>
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)} style={inputStyle}>
            {["1m","5m","15m","1h","4h","1d"].map(tf => <option key={tf}>{tf}</option>)}
          </select>
        </div>

        {/* Stake */}
        <div>
          <label style={labelStyle}>每笔投入 (USDT)</label>
          <input
            type="number" min={10} step={10} value={stakeAmount}
            onChange={e => setStakeAmount(Number(e.target.value))}
            style={inputStyle}
          />
        </div>

        {/* Mode toggle */}
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 10 }}>
          <button
            type="button"
            onClick={() => setDryRun(true)}
            style={{
              padding: "6px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${dryRun ? "var(--primary)" : "var(--border)"}`,
              background: dryRun ? "var(--primary-soft)" : "transparent",
              color: dryRun ? "var(--primary)" : "var(--text-mute)",
            }}
          >模拟盘</button>
          <button
            type="button"
            onClick={() => setDryRun(false)}
            style={{
              padding: "6px 18px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${!dryRun ? "#ff6b6b" : "var(--border)"}`,
              background: !dryRun ? "rgba(255,107,107,0.12)" : "transparent",
              color: !dryRun ? "#ff6b6b" : "var(--text-mute)",
            }}
          >⚠ 实盘</button>
          {!dryRun && (
            <span style={{ fontSize: 11, color: "#ff6b6b" }}>实盘将使用真实资金</span>
          )}
        </div>

        {/* OKX credentials — only shown for live */}
        {!dryRun && (
          <>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,107,107,0.08)", border: "1px solid rgba(255,107,107,0.3)", fontSize: 12, color: "#ff6b6b", marginBottom: 8 }}>
                OKX API Key 仅用于生成本次配置文件，不会被存储到数据库。
              </div>
            </div>
            <div>
              <label style={labelStyle}>OKX API Key</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="API Key" style={inputStyle} required={!dryRun} />
            </div>
            <div>
              <label style={labelStyle}>OKX Secret Key</label>
              <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="Secret" style={inputStyle} required={!dryRun} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>OKX Passphrase</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Passphrase" style={inputStyle} required={!dryRun} />
            </div>
          </>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !strategyId}
        style={{
          padding: "10px 0", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
          background: dryRun ? "var(--primary)" : "#ff6b6b",
          color: "#fff", border: "none", opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "启动中…" : dryRun ? "启动模拟盘" : "启动实盘"}
      </button>
    </form>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LivePage() {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load strategies and initial status ──
  useEffect(() => {
    listMyStrategies().then(setStrategies);
    refreshStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poll metrics when running ──
  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const m = await getLiveMetrics();
        setMetrics(m);
        if (!m) setStatus(s => s ? { ...s, running: false } : null);
      } catch {
        // ignore intermittent errors
      }
      // Also refresh log tail
      try {
        const st = await getLiveStatus();
        setStatus(st);
      } catch { /* ignore */ }
    }, 8000);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function refreshStatus() {
    try {
      const st = await getLiveStatus();
      setStatus(st);
      if (st?.running) {
        startPolling();
        const m = await getLiveMetrics();
        setMetrics(m);
      } else {
        stopPolling();
        setMetrics(null);
      }
    } catch { /* ignore */ }
  }

  async function handleStart(cfg: LiveStartConfig) {
    setError("");
    setActionLoading(true);
    try {
      await startLive(cfg);
      await refreshStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "启动失败");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStop() {
    setError("");
    setActionLoading(true);
    try {
      await stopLive();
      stopPolling();
      setMetrics(null);
      await refreshStatus();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "停止失败");
    } finally {
      setActionLoading(false);
    }
  }

  const running = status?.running ?? false;
  const profit = metrics?.profit;
  const openTrades = metrics?.open_trades ?? [];

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 16px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text)", margin: 0 }}>实盘 / 模拟盘工作台</h1>
          <span style={{
            padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
            background: running ? "rgba(0,200,100,0.15)" : "var(--card)",
            border: `1px solid ${running ? "#00c864" : "var(--border)"}`,
            color: running ? "#00c864" : "var(--text-mute)",
          }}>
            {running ? (status?.dry_run ? "● 模拟盘运行中" : "● 实盘运行中") : "○ 未运行"}
          </span>
        </div>
        <p style={{ color: "var(--text-mute)", fontSize: 13, margin: 0 }}>
          基于 Freqtrade trade 模式，后端常驻进程执行，安全代理转发持仓数据。
        </p>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.35)", color: "#ff6b6b", fontSize: 13, marginBottom: 20 }}>
          {error}
        </div>
      )}

      {/* ── Running state ── */}
      {running && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 32 }}>
          {/* Stats row */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <StatCard
              label="累计盈亏"
              value={fmt(profit?.profit_all_coin, 2, " USDT")}
              color={pnlColor(profit?.profit_all_coin)}
            />
            <StatCard
              label="累计盈亏 %"
              value={fmt(profit?.profit_all_percent, 2, "%")}
              color={pnlColor(profit?.profit_all_percent)}
            />
            <StatCard
              label="已平仓盈亏"
              value={fmt(profit?.profit_closed_coin, 2, " USDT")}
              color={pnlColor(profit?.profit_closed_coin)}
            />
            <StatCard
              label="总交易笔数"
              value={profit?.trade_count != null ? String(profit.trade_count) : "—"}
            />
            <StatCard
              label="胜 / 负"
              value={profit ? `${profit.winning_trades} / ${profit.losing_trades}` : "—"}
            />
            <StatCard
              label="最佳标的"
              value={profit?.best_pair ?? "—"}
            />
          </div>

          {/* Open trades */}
          {openTrades.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
                当前持仓 ({openTrades.length})
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {["交易对", "开仓价", "当前价", "未结盈亏", "未结盈亏 %", "数量", "开仓时间"].map(h => (
                        <th key={h} style={{ padding: "6px 10px", textAlign: "left", color: "var(--text-mute)", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {openTrades.map(t => (
                      <tr key={t.trade_id} style={{ borderBottom: "1px solid var(--border-lo)" }}>
                        <td style={{ padding: "7px 10px", color: "var(--text)", fontWeight: 600 }}>{t.pair}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{t.open_rate?.toFixed(2)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{t.current_rate?.toFixed(2)}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace", color: pnlColor(t.profit_abs) }}>{fmt(t.profit_abs, 2, " USDT")}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace", color: pnlColor(t.profit_pct) }}>{fmt(t.profit_pct * 100, 2, "%")}</td>
                        <td style={{ padding: "7px 10px", fontFamily: "monospace" }}>{t.amount?.toFixed(4)}</td>
                        <td style={{ padding: "7px 10px", color: "var(--text-mute)" }}>{t.open_date ? new Date(t.open_date).toLocaleString("zh-CN") : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {openTrades.length === 0 && metrics && (
            <div style={{ color: "var(--text-mute)", fontSize: 13, padding: "12px 0" }}>暂无持仓</div>
          )}

          {/* Log terminal */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>日志终端</div>
            <LogTerminal lines={status?.log_tail ?? []} />
          </div>

          {/* Stop button */}
          <button
            onClick={handleStop}
            disabled={actionLoading}
            style={{
              padding: "10px 24px", borderRadius: 8, fontSize: 14, fontWeight: 700,
              background: "rgba(255,107,107,0.15)", border: "1px solid rgba(255,107,107,0.5)",
              color: "#ff6b6b", cursor: actionLoading ? "not-allowed" : "pointer",
              opacity: actionLoading ? 0.6 : 1, alignSelf: "flex-start",
            }}
          >
            {actionLoading ? "停止中…" : "■ 停止引擎"}
          </button>
        </div>
      )}

      {/* ── Not running: show start form ── */}
      {!running && (
        <div style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 24,
          maxWidth: 540,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 18 }}>启动引擎</div>
          {strategies.length === 0 ? (
            <div style={{ color: "var(--text-mute)", fontSize: 13 }}>
              尚无策略。请先在 <a href="/strategies/editor" style={{ color: "var(--primary)" }}>策略编辑器</a> 中保存一个 Freqtrade 策略。
            </div>
          ) : (
            <StartForm strategies={strategies} onStart={handleStart} loading={actionLoading} />
          )}
        </div>
      )}
    </div>
  );
}
