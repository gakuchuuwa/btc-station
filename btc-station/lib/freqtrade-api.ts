/**
 * Client-side helpers for Phase 3.1 Freqtrade backend API.
 * Base URL is proxied via next.config.js → /py-api → FastAPI on Railway.
 */

const BASE = "/py-api/api";

async function authHeaders(): Promise<HeadersInit> {
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token ?? "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ── Templates ────────────────────────────────────────────���───────────────────

export interface TemplateInfo {
  id: string;
  name: string;
  category: string;
}

export async function fetchTemplates(): Promise<TemplateInfo[]> {
  const r = await fetch(`${BASE}/templates`);
  if (!r.ok) return [];
  return r.json();
}

export async function fetchTemplateCode(id: string): Promise<string> {
  const r = await fetch(`${BASE}/templates/${id}/code`);
  if (!r.ok) throw new Error("模板加载失败");
  const d = await r.json();
  return d.code as string;
}

// ── Strategy CRUD ───────────────────────────────────────────────────────���─────

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  class_name: string;
  strategy_type: string;
  created_at: string;
}

export async function listMyStrategies(): Promise<StrategyMeta[]> {
  const h = await authHeaders();
  const r = await fetch(`${BASE}/strategies`, { headers: h });
  if (!r.ok) return [];
  return r.json();
}

export async function saveStrategy(data: {
  id?: string;
  name: string;
  description?: string;
  code: string;
}): Promise<{ id: string }> {
  const h = await authHeaders();
  if (data.id) {
    const r = await fetch(`${BASE}/strategies/${data.id}`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ name: data.name, description: data.description ?? "", code: data.code }),
    });
    if (!r.ok) throw new Error(await r.text());
    return { id: data.id };
  } else {
    const r = await fetch(`${BASE}/strategies`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({ name: data.name, description: data.description ?? "", code: data.code }),
    });
    if (!r.ok) throw new Error(await r.text());
    const d = await r.json();
    return { id: Array.isArray(d) ? d[0].id : d.id };
  }
}

// ── Backtest ────────────────────────────���─────────────────────────────────────

export interface BacktestConfig {
  strategy_id: string;
  timeframe: string;
  timerange: string;
  market: "spot" | "futures";
  initial_capital: number;
  leverage: number;
  fee_pct: number;
}

export interface BacktestSubmitResult {
  task_id: string;
  backtest_id: string;
  status: string;
}

export async function submitBacktest(cfg: BacktestConfig): Promise<BacktestSubmitResult> {
  const h = await authHeaders();
  const r = await fetch(`${BASE}/backtests`, {
    method: "POST",
    headers: h,
    body: JSON.stringify(cfg),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: r.statusText }));
    throw new Error(err.detail ?? "提交回测失败");
  }
  return r.json();
}

export async function getBacktest(backtestId: string) {
  const h = await authHeaders();
  const r = await fetch(`${BASE}/backtests/${backtestId}`, { headers: h });
  if (!r.ok) throw new Error("获取回测状态失败");
  return r.json();
}

export function csvDownloadUrl(backtestId: string): string {
  return `${BASE}/backtests/${backtestId}/csv`;
}

export async function getQuota() {
  const h = await authHeaders();
  const r = await fetch(`${BASE}/quota`, { headers: h });
  if (!r.ok) return null;
  return r.json();
}

// ── WebSocket stream helper ───────────────────────────────────────────────────

export type StreamMsg =
  | { type: "status"; value: string }
  | { type: "progress"; percent: number }
  | { type: "log"; line: string; level: "info" | "warning" | "error" }
  | { type: "result"; result: BacktestMetrics }
  | { type: "error"; message: string };

export interface BacktestMetrics {
  net_profit_pct: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  total_trades: number;
  sharpe?: number;
  sortino?: number;
  profit_factor?: number;
}

export function connectBacktestStream(
  backtestId: string,
  onMessage: (msg: StreamMsg) => void,
  onClose: () => void,
): WebSocket {
  const wsBase = typeof window !== "undefined"
    ? (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host + "/py-api"
    : "";
  const ws = new WebSocket(`${wsBase}/api/backtests/${backtestId}/stream`);
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  ws.onclose = onClose;
  ws.onerror = () => onClose();
  return ws;
}
