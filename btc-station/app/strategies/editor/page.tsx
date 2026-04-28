"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  fetchTemplates,
  fetchTemplateCode,
  listMyStrategies,
  saveStrategy,
  submitBacktest,
  getBacktest,
  connectBacktestStream,
  csvDownloadUrl,
  getQuota,
  type TemplateInfo,
  type StrategyMeta,
  type BacktestMetrics,
  type StreamMsg,
} from "@/lib/freqtrade-api";
import ChatSidebar from "@/components/ChatSidebar";

// Monaco loads client-side only
const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

// ── Default template shown on first load ─────────────────────────────────────
const DEFAULT_CODE = `"""
MA 双均线交叉策略 — 在此基础上修改您的策略逻辑

逻辑：快线(EMA20)上穿慢线(EMA50) → 买入；下穿 → 卖出
"""
from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta
import freqtrade.vendor.qtpylib.indicators as qtpylib


class MyCrossStrategy(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "4h"
    stake_currency = "USDT"
    # 依赖出场信号平仓
    minimal_roi = {"0": 10}
    stoploss = -0.10
    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    can_short = False

    # 策略参数（直接用整数，不用 IntParameter）
    fast_period = 20
    slow_period = 50

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["fast_ma"] = ta.EMA(dataframe, timeperiod=self.fast_period)
        dataframe["slow_ma"] = ta.EMA(dataframe, timeperiod=self.slow_period)
        print(f"[DEBUG] dataframe rows: {len(dataframe)}, fast_ma valid: {dataframe['fast_ma'].notna().sum()}")
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            qtpylib.crossed_above(dataframe["fast_ma"], dataframe["slow_ma"]),
            "enter_long",
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            qtpylib.crossed_below(dataframe["fast_ma"], dataframe["slow_ma"]),
            "exit_long",
        ] = 1
        return dataframe
`;

// ── Backtest status helpers ───────────────────────────────────���───────────────
type BtStatus = "idle" | "pending" | "running" | "completed" | "failed";

const STATUS_LABEL: Record<BtStatus, string> = {
  idle: "",
  pending: "排队中",
  running: "回测运行中",
  completed: "已完成",
  failed: "已失败",
};

const STATUS_COLOR: Record<BtStatus, string> = {
  idle: "text-[var(--text-mute)]",
  pending: "text-yellow-400",
  running: "text-[var(--up)]",
  completed: "text-[var(--up)]",
  failed: "text-[var(--down)]",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function EditorPage() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [strategyName, setStrategyName] = useState("我的策略");
  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Templates & my strategies
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [myStrategies, setMyStrategies] = useState<StrategyMeta[]>([]);
  const [showTemplateMenu, setShowTemplateMenu] = useState(false);
  const [showMyMenu, setShowMyMenu] = useState(false);

  // Backtest config
  const [timeframe, setTimeframe] = useState("4h");
  const [timerange, setTimerange] = useState("20230101-20260101");
  const [market, setMarket] = useState<"spot" | "futures">("futures");
  const [capital, setCapital] = useState(10000);
  const [leverage, setLeverage] = useState(1);
  const [feePct, setFeePct] = useState(0.05);

  // Backtest state
  const [btStatus, setBtStatus] = useState<BtStatus>("idle");
  const [btError, setBtError] = useState("");
  const [btLogs, setBtLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [btResult, setBtResult] = useState<BacktestMetrics | null>(null);
  const [currentBtId, setCurrentBtId] = useState<string | null>(null);

  // Quota
  const [quota, setQuota] = useState<{ plan: string; backtests_used: number; backtests_limit: number | null } | null>(null);

  // AI sidebar toggle
  const [showAI, setShowAI] = useState(false);
  // AI report state
  const [aiReport, setAiReport] = useState("");
  const [aiReporting, setAiReporting] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    fetchTemplates().then(setTemplates);
    listMyStrategies().then(setMyStrategies);
    getQuota().then(setQuota);
  }, []);

  const loadTemplate = async (tid: string) => {
    try {
      const c = await fetchTemplateCode(tid);
      setCode(c);
      setShowTemplateMenu(false);
      setSavedId(null);
    } catch {
      /* ignore */
    }
  };

  const loadMyStrategy = (s: StrategyMeta) => {
    setStrategyName(s.name);
    setSavedId(s.id);
    setShowMyMenu(false);
    // Fetch code
    import("@/lib/freqtrade-api").then(({ getBacktest: _ }) => {
      fetch(`/py-api/api/strategies/${s.id}`, {
        headers: { "Content-Type": "application/json" },
      })
        .then((r) => r.json())
        .then((d) => setCode(d.code))
        .catch(() => {});
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const result = await saveStrategy({ id: savedId ?? undefined, name: strategyName, code });
      setSavedId(result.id);
      setSaveMsg("已保存");
      listMyStrategies().then(setMyStrategies);
    } catch (e: unknown) {
      setSaveMsg((e as Error).message ?? "保存失败");
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  const handleRunBacktest = useCallback(async () => {
    if (!savedId) {
      setBtError("请先保存策略再运行回测");
      return;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setBtStatus("pending");
    setBtError("");
    setBtLogs([]);
    setBtResult(null);

    try {
      const res = await submitBacktest({
        strategy_id: savedId,
        timeframe,
        timerange,
        market,
        initial_capital: capital,
        leverage,
        fee_pct: feePct,
      });

      setCurrentBtId(res.backtest_id);

      const ws = connectBacktestStream(
        res.backtest_id,
        (msg: StreamMsg) => {
          if (msg.type === "status") {
            setBtStatus(msg.value as BtStatus);
          } else if (msg.type === "log") {
            setBtLogs((prev) => [...prev.slice(-99), msg.line]);
          } else if (msg.type === "result") {
            setBtResult(msg.result);
            setBtStatus("completed");
          } else if (msg.type === "error") {
            setBtError(msg.message);
            setBtStatus("failed");
          }
        },
        () => {
          // WS closed — fallback poll
          if (res.backtest_id) {
            const poll = setInterval(async () => {
              const d = await getBacktest(res.backtest_id).catch(() => null);
              if (!d) return;
              setBtStatus(d.status as BtStatus);
              if (d.status === "completed") {
                clearInterval(poll);
                if (d.result?.metrics) setBtResult(d.result.metrics);
              }
              if (d.status === "failed") {
                clearInterval(poll);
                setBtError(d.error ?? "回测失败");
              }
            }, 3000);
          }
        },
      );
      wsRef.current = ws;
    } catch (e: unknown) {
      setBtError((e as Error).message ?? "提交失败");
      setBtStatus("failed");
    }
  }, [savedId, timeframe, timerange, market, capital, leverage, feePct]);

  const isRunning = btStatus === "pending" || btStatus === "running";

  return (
    <div className="flex flex-col h-[calc(100vh-48px)] overflow-hidden">
      {/* ── Top Toolbar ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-elev)] flex-shrink-0">
        <Link href="/strategies" className="text-[var(--text-mute)] hover:text-[var(--text)] text-sm flex items-center gap-1">
          ← 策略库
        </Link>
        <span className="text-[var(--border-hi)]">|</span>

        {/* Template selector */}
        <div className="relative">
          <button
            onClick={() => { setShowTemplateMenu(!showTemplateMenu); setShowMyMenu(false); }}
            className="text-sm px-3 py-1 rounded border border-[var(--border)] hover:border-[var(--border-hi)] text-[var(--text-mute)] hover:text-[var(--text)] transition-colors"
          >
            加载模板 ▾
          </button>
          {showTemplateMenu && (
            <div className="absolute top-8 left-0 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl min-w-[200px]">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => loadTemplate(t.id)}
                  className="w-full text-left px-4 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--border)] first:rounded-t-lg last:rounded-b-lg transition-colors"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* My strategies */}
        {myStrategies.length > 0 && (
          <div className="relative">
            <button
              onClick={() => { setShowMyMenu(!showMyMenu); setShowTemplateMenu(false); }}
              className="text-sm px-3 py-1 rounded border border-[var(--border)] hover:border-[var(--border-hi)] text-[var(--text-mute)] hover:text-[var(--text)] transition-colors"
            >
              我的策略 ▾
            </button>
            {showMyMenu && (
              <div className="absolute top-8 left-0 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl min-w-[220px]">
                {myStrategies.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadMyStrategy(s)}
                    className="w-full text-left px-4 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--border)] first:rounded-t-lg last:rounded-b-lg transition-colors"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex-1" />

        {/* Strategy name input */}
        <input
          value={strategyName}
          onChange={(e) => setStrategyName(e.target.value)}
          className="bg-transparent border border-[var(--border)] rounded px-3 py-1 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--up)] w-48"
          placeholder="策略名称"
        />

        <button
          onClick={handleSave}
          disabled={saving}
          className="text-sm px-4 py-1 rounded bg-[var(--border-hi)] hover:bg-[var(--surface-2)] text-[var(--text)] transition-colors disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存策略"}
        </button>
        {saveMsg && <span className="text-xs text-[var(--up)]">{saveMsg}</span>}

        {/* Quota badge */}
        {quota && (
          <span className="text-xs text-[var(--text-mute)] px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)]">
            {quota.plan === "pro" ? "Pro" : `免费 ${quota.backtests_used}/${quota.backtests_limit}`}
          </span>
        )}

        {/* AI sidebar toggle */}
        <button
          onClick={() => setShowAI(v => !v)}
          className={`text-sm px-3 py-1 rounded border transition-colors ${
            showAI
              ? "border-[var(--primary)] text-[var(--primary)] bg-[rgba(0,168,100,0.1)]"
              : "border-[var(--border)] text-[var(--text-mute)] hover:text-[var(--text)]"
          }`}
        >
          🤖 AI
        </button>
      </div>

      {/* ── Main area: editor + right panel + AI sidebar ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Monaco Editor */}
        <div className="flex-1 overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="python"
            value={code}
            onChange={(v) => setCode(v ?? "")}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              tabSize: 4,
              wordWrap: "on",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              folding: true,
              renderLineHighlight: "line",
              padding: { top: 12, bottom: 12 },
            }}
          />
        </div>

        {/* Right: backtest control panel */}
        <div className="w-80 flex-shrink-0 border-l border-[var(--border)] flex flex-col overflow-y-auto bg-[var(--bg-elev)]">

          {/* Config section */}
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-semibold text-[var(--text)] mb-3">回测配置</h3>
            <div className="flex flex-col gap-3">
              {/* Market */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-mute)]">市场类型</label>
                <div className="flex rounded overflow-hidden border border-[var(--border)]">
                  {(["spot", "futures"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMarket(m)}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${
                        market === m
                          ? "bg-[var(--up)] text-white"
                          : "bg-[var(--bg)] text-[var(--text-mute)] hover:text-[var(--text)]"
                      }`}
                    >
                      {m === "spot" ? "现货" : "永续合约"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Timeframe */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-mute)]">时间周期</label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--up)]"
                >
                  {["1m","5m","15m","1h","4h","1d"].map((tf) => (
                    <option key={tf} value={tf}>{tf}</option>
                  ))}
                </select>
              </div>

              {/* Time range */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-mute)]">回测时间范围</label>
                <select
                  value={timerange}
                  onChange={(e) => setTimerange(e.target.value)}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--up)]"
                >
                  <option value="20250101-20260101">近 1 年</option>
                  <option value="20230101-20260101">近 3 年</option>
                  <option value="20210101-20260101">近 5 年</option>
                  <option value="20200101-20260101">近 6 年（完整）</option>
                </select>
              </div>

              {/* Capital */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-mute)]">初始资金 (USDT)</label>
                <input
                  type="number"
                  value={capital}
                  onChange={(e) => setCapital(Number(e.target.value))}
                  min={100}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--up)]"
                />
              </div>

              {/* Leverage (futures only) */}
              {market === "futures" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-[var(--text-mute)]">杠杆倍数</label>
                  <input
                    type="number"
                    value={leverage}
                    onChange={(e) => setLeverage(Math.max(1, Math.min(50, Number(e.target.value))))}
                    min={1} max={50}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--up)]"
                  />
                </div>
              )}

              {/* Fee */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-mute)]">手续费率 (%)</label>
                <input
                  type="number"
                  value={feePct}
                  step={0.01}
                  onChange={(e) => setFeePct(Number(e.target.value))}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--up)]"
                />
              </div>
            </div>
          </div>

          {/* Run button + status */}
          <div className="p-4 border-b border-[var(--border)]">
            <button
              onClick={handleRunBacktest}
              disabled={isRunning}
              className="w-full py-2.5 rounded bg-[var(--up)] hover:bg-[#1f8c6a] text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isRunning ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  {STATUS_LABEL[btStatus]}
                </>
              ) : "运行回测"}
            </button>

            {btStatus !== "idle" && (
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-xs font-medium ${STATUS_COLOR[btStatus]}`}>
                  {STATUS_LABEL[btStatus]}
                </span>
              </div>
            )}

            {btError && (
              <p className="mt-2 text-xs text-[var(--down)] leading-relaxed">{btError}</p>
            )}

            {!savedId && (
              <p className="mt-2 text-xs text-yellow-400">请先保存策略再运行回测</p>
            )}
          </div>

          {/* Live logs */}
          {btLogs.length > 0 && (
            <div className="border-b border-[var(--border)]">
              <button
                onClick={() => setShowLogs(!showLogs)}
                className="w-full px-4 py-2 text-left text-xs text-[var(--text-mute)] hover:text-[var(--text)] flex justify-between items-center"
              >
                <span>实时日志 ({btLogs.length})</span>
                <span>{showLogs ? "▲" : "▼"}</span>
              </button>
              {showLogs && (
                <div className="px-3 pb-3 max-h-40 overflow-y-auto font-mono text-xs text-[var(--text-mute)] space-y-0.5 bg-[var(--bg)]">
                  {btLogs.map((l, i) => (
                    <div key={i} className="leading-5">{l}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {btResult && (
            <div className="p-4 flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-[var(--text)]">回测结果</h3>

              {/* 4 core metrics */}
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  label="总收益率"
                  value={`${btResult.net_profit_pct >= 0 ? "+" : ""}${btResult.net_profit_pct.toFixed(2)}%`}
                  color={btResult.net_profit_pct >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}
                />
                <MetricCard label="最大回撤" value={`${btResult.max_drawdown_pct.toFixed(2)}%`} color="text-[var(--down)]" />
                <MetricCard label="胜率" value={`${btResult.win_rate_pct.toFixed(1)}%`} />
                <MetricCard label="交易笔数" value={String(btResult.total_trades)} />
              </div>

              {/* Extended metrics */}
              <div className="flex flex-col gap-1.5">
                {btResult.sharpe != null && (
                  <MetricRow label="Sharpe 比率" value={btResult.sharpe.toFixed(3)} />
                )}
                {btResult.sortino != null && (
                  <MetricRow label="Sortino 比率" value={btResult.sortino.toFixed(3)} />
                )}
                {btResult.profit_factor != null && (
                  <MetricRow label="盈利因子" value={btResult.profit_factor.toFixed(3)} />
                )}
              </div>

              {/* CSV Download */}
              {currentBtId && (
                <a
                  href={csvDownloadUrl(currentBtId)}
                  className="w-full py-2 rounded border border-[var(--up)] text-[var(--up)] hover:bg-[var(--up-soft)] text-sm font-medium text-center transition-colors block"
                >
                  下载 CSV（quant-lab.org）
                </a>
              )}
            </div>
          )}

          {/* AI report section */}
          {btResult && (
            <div className="p-4 border-t border-[var(--border)]">
              <button
                onClick={async () => {
                  const key = localStorage.getItem("btcstation_openai_key");
                  if (!key) { setShowAI(true); return; }
                  setAiReporting(true);
                  setAiReport("");
                  try {
                    const { createClient } = await import("@/lib/supabase/client");
                    const sb = createClient();
                    const { data } = await sb.auth.getSession();
                    const auth = `Bearer ${data.session?.access_token ?? ""}`;
                    const res = await fetch("/py-api/api/ai/report", {
                      method: "POST",
                      headers: { "Content-Type": "application/json", Authorization: auth },
                      body: JSON.stringify({ api_key: key, metrics: btResult }),
                    });
                    if (!res.ok || !res.body) throw new Error("请求失败");
                    const reader = res.body.getReader();
                    const dec = new TextDecoder();
                    let buf = "";
                    while (true) {
                      const { done, value } = await reader.read();
                      if (done) break;
                      buf += dec.decode(value, { stream: true });
                      const lines = buf.split("\n"); buf = lines.pop() ?? "";
                      for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        const d = line.slice(6).trim();
                        if (d === "[DONE]") break;
                        try {
                          const p = JSON.parse(d);
                          if (p.delta) setAiReport(prev => prev + p.delta);
                        } catch { /* skip */ }
                      }
                    }
                  } catch (e: unknown) {
                    setAiReport(`生成失败: ${(e as Error).message}`);
                  } finally {
                    setAiReporting(false);
                  }
                }}
                disabled={aiReporting}
                className="w-full py-2 rounded border border-purple-500/50 text-purple-400 hover:bg-purple-500/10 text-xs font-medium transition-colors disabled:opacity-50"
              >
                {aiReporting ? "AI 分析中…" : "🤖 AI 解读报告"}
              </button>

              {aiReport && (
                <div className="mt-3 p-3 rounded bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)] leading-relaxed ai-markdown overflow-y-auto max-h-64">
                  <AiReportRenderer content={aiReport} streaming={aiReporting} />
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {btStatus === "idle" && !btResult && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="text-3xl mb-3 opacity-30">📊</div>
              <p className="text-xs text-[var(--text-mute)] leading-relaxed">
                编写策略后点击「运行回测」<br/>
                支持 5 年完整 BTC 历史数据<br/>
                永续合约含资金费率精确模拟
              </p>
            </div>
          )}
        </div>

        {/* AI Sidebar */}
        {showAI && (
          <div className="w-72 flex-shrink-0 border-l border-[var(--border)] overflow-hidden">
            <ChatSidebar codeContext={code} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────���──────────────

function MetricCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-3 rounded bg-[var(--bg)] border border-[var(--border)] flex flex-col gap-1">
      <span className="text-xs text-[var(--text-mute)]">{label}</span>
      <span className={`text-base font-bold num ${color ?? "text-[var(--text)]"}`}>{value}</span>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-[var(--text-mute)]">{label}</span>
      <span className="text-[var(--text)] font-medium num">{value}</span>
    </div>
  );
}

function AiReportRenderer({ content, streaming }: { content: string; streaming: boolean }) {
  const ReactMarkdown = dynamic(() => import("react-markdown"), { ssr: false });
  return <ReactMarkdown>{content + (streaming ? "▌" : "")}</ReactMarkdown>;
}
