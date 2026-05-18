"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import HyperoptChart from "@/components/HyperoptChart";
import {
  listMyStrategies,
  startHyperopt,
  getHyperoptStatus,
  type StrategyMeta,
  type EpochRecord,
  type HyperoptResult,
} from "@/lib/freqtrade-api";

// ── Constants ─────────────────────────────────────────────────────────────────

const LOSS_OPTIONS = [
  { value: "SharpeHyperOptLoss",        label: "Sharpe (推荐)" },
  { value: "SortinoHyperOptLoss",       label: "Sortino" },
  { value: "CalmarHyperOptLoss",        label: "Calmar" },
  { value: "MaxDrawDownHyperOptLoss",   label: "最小化最大回撤" },
  { value: "OnlyProfitHyperOptLoss",    label: "仅最大化收益" },
  { value: "ProfitDrawDownHyperOptLoss",label: "收益/回撤综合" },
];

const SPACE_OPTIONS = [
  { value: "buy",        label: "入场信号 (buy)" },
  { value: "sell",       label: "出场信号 (sell)" },
  { value: "roi",        label: "止盈比例 (roi)" },
  { value: "stoploss",   label: "止损比例 (stoploss)" },
  { value: "trailing",   label: "移动止损 (trailing)" },
  { value: "protection", label: "保护机制 (protection)" },
];

const TIMERANGE_OPTIONS = [
  { value: "20230101-20260101", label: "2023–2026 (3年)" },
  { value: "20220101-20260101", label: "2022–2026 (4年)" },
  { value: "20210101-20260101", label: "2021–2026 (5年)" },
  { value: "20240101-20260101", label: "2024–2026 (2年, 快速)" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = `
  w-full px-3 py-2 rounded-lg text-sm
  bg-[var(--bg)] border border-[var(--border)]
  text-[var(--text)] outline-none
  focus:border-[var(--primary)] transition-colors
`.trim().replace(/\s+/g, " ");

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-[var(--text-mute)] mb-1">{children}</label>;
}

function fmt(n: number, d = 2, suffix = "") {
  if (isNaN(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(d)}${suffix}`;
}

function pnlCls(n: number) {
  return n >= 0 ? "text-[var(--up)]" : "text-[var(--down)]";
}

// ── Top-10 Table ──────────────────────────────────────────────────────────────

function Top10Table({
  epochs,
  onApply,
}: {
  epochs: EpochRecord[];
  onApply: (params: Record<string, string>) => void;
}) {
  const top10 = [...epochs]
    .sort((a, b) => b.profit_pct - a.profit_pct)
    .slice(0, 10);

  if (top10.length === 0) return null;

  const paramKeys = top10[0].params ? Object.keys(top10[0].params) : [];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs text-left">
        <thead>
          <tr className="border-b border-[var(--border)]">
            <th className="px-3 py-2 text-[var(--text-mute)] font-medium">排名</th>
            <th className="px-3 py-2 text-[var(--text-mute)] font-medium">Epoch</th>
            <th className="px-3 py-2 text-[var(--text-mute)] font-medium text-right">收益 %</th>
            <th className="px-3 py-2 text-[var(--text-mute)] font-medium text-right">回撤 %</th>
            <th className="px-3 py-2 text-[var(--text-mute)] font-medium text-right">交易数</th>
            {paramKeys.map(k => (
              <th key={k} className="px-3 py-2 text-[var(--text-mute)] font-medium">{k}</th>
            ))}
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {top10.map((e, i) => (
            <tr
              key={e.epoch}
              className="border-b border-[var(--border)] hover:bg-[var(--bg)] transition-colors"
            >
              <td className="px-3 py-2 font-bold text-[var(--text-mute)]">#{i + 1}</td>
              <td className="px-3 py-2 font-mono text-[var(--text)]">{e.epoch}</td>
              <td className={`px-3 py-2 text-right font-mono font-semibold ${pnlCls(e.profit_pct)}`}>
                {fmt(e.profit_pct, 2, "%")}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--down)]">
                {e.drawdown_pct.toFixed(2)}%
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--text)]">{e.trades}</td>
              {paramKeys.map(k => (
                <td key={k} className="px-3 py-2 font-mono text-[var(--text)]">
                  {e.params?.[k] ?? "—"}
                </td>
              ))}
              <td className="px-3 py-2">
                {e.params && Object.keys(e.params).length > 0 && (
                  <button
                    onClick={() => onApply(e.params!)}
                    className="px-2 py-1 text-xs rounded border border-[var(--primary)] text-[var(--primary)] hover:bg-[var(--primary)] hover:text-white transition-colors"
                  >
                    应用
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Progress Bar ──────────────────────────────────────────────────────────────

function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs text-[var(--text-mute)] mb-1">
        <span>{label}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-[var(--bg)] border border-[var(--border)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, var(--primary), #00c864)",
          }}
        />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function HyperoptPage() {
  const [strategies, setStrategies] = useState<StrategyMeta[]>([]);
  const [strategyId, setStrategyId]   = useState("");
  const [timeframe,  setTimeframe]    = useState("4h");
  const [timerange,  setTimerange]    = useState("20230101-20260101");
  const [epochs,     setEpochs]       = useState(100);
  const [spaces,     setSpaces]       = useState<string[]>(["buy", "sell"]);
  const [lossFunc,   setLossFunc]     = useState("SharpeHyperOptLoss");
  const [minTrades,  setMinTrades]    = useState(30);

  const [taskId,    setTaskId]    = useState<string | null>(null);
  const [status,    setStatus]    = useState<"idle" | "running" | "completed" | "failed">("idle");
  const [pct,       setPct]       = useState(0);
  const [epochsDone, setEpochsDone] = useState(0);
  const [allEpochs, setAllEpochs] = useState<EpochRecord[]>([]);
  const [result,    setResult]    = useState<HyperoptResult | null>(null);
  const [error,     setError]     = useState("");
  const [appliedParams, setAppliedParams] = useState<Record<string, string> | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    listMyStrategies().then(s => { 
      setStrategies(s); 
      setStrategyId(prev => prev || (s.length > 0 ? s[0].id : "")); 
    });
  }, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback((tid: string) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const st = await getHyperoptStatus(tid);
        setPct(st.progress_pct);
        setEpochsDone(st.epochs_done);
        setAllEpochs(prev => {
          const existing = new Set(prev.map(ep => ep.epoch));
          const fresh = st.latest_epochs.filter(ep => !existing.has(ep.epoch));
          return fresh.length ? [...prev, ...fresh] : prev;
        });

        if (st.status === "completed") {
          stopPoll();
          setStatus("completed");
          if (st.result) {
            setResult(st.result);
            setAllEpochs(st.result.epochs);
          }
        } else if (st.status === "failed") {
          stopPoll();
          setStatus("failed");
          setError(st.error ?? "调参失败");
        }
      } catch { /* ignore intermittent */ }
    }, 4000);
  }, [stopPoll]);

  useEffect(() => () => stopPoll(), [stopPoll]);

  // 初始化读取状态
  useEffect(() => {
    const localSession = sessionStorage.getItem('hyperopt_page_state')
    if (localSession) {
      try {
        const state = JSON.parse(localSession)
        if (state.strategyId) setStrategyId(state.strategyId)
        if (state.timeframe) setTimeframe(state.timeframe)
        if (state.timerange) setTimerange(state.timerange)
        if (state.epochs) setEpochs(state.epochs)
        if (state.spaces) setSpaces(state.spaces)
        if (state.lossFunc) setLossFunc(state.lossFunc)
        if (state.minTrades) setMinTrades(state.minTrades)
        
        if (state.allEpochs && state.allEpochs.length > 0) setAllEpochs(state.allEpochs)
        if (state.result) setResult(state.result)
        if (state.appliedParams) setAppliedParams(state.appliedParams)
        
        if (state.status === "completed" || state.status === "failed") {
          setStatus(state.status)
          if (state.error) setError(state.error)
        } else if (state.status === "running" && state.taskId) {
          setTaskId(state.taskId)
          setStatus("running")
          setPct(state.pct || 0)
          setEpochsDone(state.epochsDone || 0)
          startPolling(state.taskId)
        }
      } catch (e) {}
    }
  }, [startPolling])

  // 关键状态变更时保存
  useEffect(() => {
    if (strategyId) {
      sessionStorage.setItem('hyperopt_page_state', JSON.stringify({
        strategyId, timeframe, timerange, epochs, spaces, lossFunc, minTrades,
        taskId, status, pct, epochsDone, allEpochs, result, error, appliedParams
      }))
    }
  }, [strategyId, timeframe, timerange, epochs, spaces, lossFunc, minTrades, taskId, status, pct, epochsDone, allEpochs, result, error, appliedParams])

  function toggleSpace(s: string) {
    setSpaces(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    if (!strategyId || spaces.length === 0) return;
    setError("");
    setStatus("running");
    setPct(0);
    setEpochsDone(0);
    setAllEpochs([]);
    setResult(null);
    setAppliedParams(null);

    try {
      const res = await startHyperopt({ strategy_id: strategyId, timeframe, timerange, epochs, spaces, loss_function: lossFunc, min_trades: minTrades });
      setTaskId(res.task_id);
      startPolling(res.task_id);
    } catch (err: unknown) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "提交失败");
    }
  }

  const displayEpochs = result?.epochs ?? allEpochs;
  const bestEpoch = result?.best ?? (allEpochs.length > 0 ? allEpochs.reduce((a, b) => b.profit_pct > a.profit_pct ? b : a) : null);

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 16px" }}>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--text)] mb-1">Hyperopt 智能调参</h1>
        <p className="text-sm text-[var(--text-mute)]">
          贝叶斯优化穷举策略参数空间，自动找出最优参数组合。散点图气泡越大 = 交易笔数越多，颜色越绿 = 回撤越低。
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* ── Left: form ── */}
        <div className="w-full lg:w-72 flex-shrink-0 flex flex-col gap-4">
          <form onSubmit={handleStart} className="bg-[var(--card,var(--bg-card))] border border-[var(--border)] rounded-xl p-5 flex flex-col gap-4">
            <div className="text-sm font-semibold text-[var(--text)] pb-1 border-b border-[var(--border)]">调参设置</div>

            <div>
              <Label>选择策略</Label>
              <select value={strategyId} onChange={e => setStrategyId(e.target.value)} className={inputCls} required>
                <option value="">— 请选择 —</option>
                {strategies.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>K线周期</Label>
                <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className={inputCls}>
                  {["1h","4h","1d"].map(tf => <option key={tf}>{tf}</option>)}
                </select>
              </div>
              <div>
                <Label>Epochs 数量</Label>
                <input
                  type="number" min={10} max={1000} step={10}
                  value={epochs} onChange={e => setEpochs(Number(e.target.value))}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <Label>时间范围</Label>
              <select value={timerange} onChange={e => setTimerange(e.target.value)} className={inputCls}>
                {TIMERANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <Label>Loss 函数</Label>
              <select value={lossFunc} onChange={e => setLossFunc(e.target.value)} className={inputCls}>
                {LOSS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            <div>
              <Label>最少交易数</Label>
              <input
                type="number" min={10} max={500} step={10}
                value={minTrades} onChange={e => setMinTrades(Number(e.target.value))}
                className={inputCls}
              />
            </div>

            <div>
              <Label>优化空间（至少选一个）</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {SPACE_OPTIONS.map(s => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleSpace(s.value)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      spaces.includes(s.value)
                        ? "border-[var(--primary)] bg-[var(--primary-soft,rgba(0,168,100,0.12))] text-[var(--primary)]"
                        : "border-[var(--border)] text-[var(--text-mute)]"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={status === "running" || !strategyId || spaces.length === 0}
              className="w-full py-2.5 rounded-lg text-sm font-bold bg-[var(--primary)] text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity mt-1"
            >
              {status === "running" ? "调参中…" : "开始调参"}
            </button>
          </form>

          {/* Applied params notice */}
          {appliedParams && (
            <div className="bg-[var(--card,var(--bg-card))] border border-[var(--border)] rounded-xl p-4">
              <div className="text-xs font-semibold text-[var(--up)] mb-2">✓ 已应用参数</div>
              {Object.entries(appliedParams).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs text-[var(--text)] py-0.5">
                  <span className="text-[var(--text-mute)]">{k}</span>
                  <span className="font-mono">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Right: chart + results ── */}
        <div className="flex-1 flex flex-col gap-5 min-w-0">

          {/* Progress */}
          {status === "running" && (
            <div className="bg-[var(--card,var(--bg-card))] border border-[var(--border)] rounded-xl p-5">
              <ProgressBar
                pct={pct}
                label={`Epochs: ${epochsDone} / ${epochs} 已完成${allEpochs.length > 0 ? ` · 当前最优收益 ${fmt(Math.max(...allEpochs.map(e => e.profit_pct)), 2, "%")}` : ""}`}
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Chart */}
          <div className="bg-[var(--card,var(--bg-card))] border border-[var(--border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold text-[var(--text)]">
                Epoch 散点图
                <span className="ml-2 text-xs font-normal text-[var(--text-mute)]">X轴: Epoch序号 · Y轴: 收益率 · 气泡大小: 交易数 · 颜色: 回撤</span>
              </div>
              {displayEpochs.length > 0 && (
                <span className="text-xs text-[var(--text-mute)]">{displayEpochs.length} epochs</span>
              )}
            </div>
            <HyperoptChart epochs={displayEpochs} bestEpoch={bestEpoch} />
          </div>

          {/* Best result summary */}
          {bestEpoch && (
            <div className="bg-[var(--card,var(--bg-card))] border border-[var(--border)] rounded-xl p-5">
              <div className="text-sm font-semibold text-[var(--text)] mb-3">
                最优参数组合
                <span className="ml-2 text-xs font-normal text-[var(--text-mute)]">Epoch #{bestEpoch.epoch}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: "收益率", value: fmt(bestEpoch.profit_pct, 2, "%"), color: pnlCls(bestEpoch.profit_pct) },
                  { label: "最大回撤", value: `${bestEpoch.drawdown_pct.toFixed(2)}%`, color: "text-[var(--down)]" },
                  { label: "交易笔数", value: String(bestEpoch.trades), color: "text-[var(--text)]" },
                  { label: "Epoch", value: `#${bestEpoch.epoch}`, color: "text-[var(--text-mute)]" },
                ].map(c => (
                  <div key={c.label} className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3">
                    <div className="text-xs text-[var(--text-mute)] mb-1">{c.label}</div>
                    <div className={`text-lg font-bold font-mono ${c.color}`}>{c.value}</div>
                  </div>
                ))}
              </div>
              {bestEpoch.params && Object.keys(bestEpoch.params).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(bestEpoch.params).map(([k, v]) => (
                    <span key={k} className="px-2 py-1 text-xs rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] font-mono">
                      {k} = {v}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Top-10 table */}
          {displayEpochs.length > 0 && (
            <div className="bg-[var(--card,var(--bg-card))] border border-[var(--border)] rounded-xl p-5">
              <div className="text-sm font-semibold text-[var(--text)] mb-3">
                Top 10 参数组合
                <span className="ml-2 text-xs font-normal text-[var(--text-mute)]">按收益率排名，点击"应用"将参数填入编辑器</span>
              </div>
              <Top10Table
                epochs={displayEpochs}
                onApply={params => setAppliedParams(params)}
              />
            </div>
          )}

          {/* Idle placeholder */}
          {status === "idle" && displayEpochs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-[var(--text-mute)]">
              <div className="text-5xl mb-4">🧬</div>
              <p className="text-sm">选择策略后点击"开始调参"</p>
              <p className="text-xs mt-1 opacity-60">调参过程中散点图会实时更新，无需等待完成</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
