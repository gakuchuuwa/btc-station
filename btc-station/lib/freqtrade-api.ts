/**
 * 后端 API 工具函数，代理路径：/py-api → FastAPI localhost:8000
 */

const BASE = "/py-api/api";

async function authHeaders(): Promise<HeadersInit> {
  const { createClient } = await import("@/lib/supabase/client");
  const sb = createClient();
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token ?? "";
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

// ── Templates ─────────────────────────────────────────────────────────────────

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

// ── Strategy CRUD ─────────────────────────────────────────────────────────────

export interface StrategyMeta {
  id: string;
  name: string;
  description: string;
  class_name: string;
  strategy_type: string;
  created_at: string;
}

export async function deleteStrategy(id: string): Promise<void> {
  const h = await authHeaders();
  const r = await fetch(`${BASE}/strategies/${id}`, { method: "DELETE", headers: h });
  if (!r.ok) throw new Error(await r.text());
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

// ── Backtest ──────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  strategy_id: string;
  timeframe: string;
  timerange: string;
  market: "spot" | "futures";
  initial_capital: number;
  leverage: number;
  fee_pct: number;
}

export interface BacktestMetrics {
  net_profit_pct: number;
  max_drawdown_pct: number;
  ftmo_drawdown_pct?: number;
  win_rate_pct: number;
  total_trades: number;
  sharpe?: number;
  sortino?: number;
  profit_factor?: number;
}

export async function submitBacktest(cfg: BacktestConfig): Promise<{ backtest_id: string; status: string }> {
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

// ── WebSocket stream ──────────────────────────────────────────────────────────

export type StreamMsg =
  | { type: "status"; value: string }
  | { type: "log"; line: string; level: "info" | "warning" | "error" }
  | { type: "result"; result: BacktestMetrics }
  | { type: "error"; message: string };

export function connectBacktestStream(
  backtestId: string,
  onMessage: (msg: StreamMsg) => void,
  onClose: () => void,
): WebSocket {
  const proto = window.location.protocol === "https:" ? "wss://" : "ws://";
  const ws = new WebSocket(`${proto}${window.location.host}/py-api/api/backtests/${backtestId}/stream`);
  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ }
  };
  ws.onclose = onClose;
  ws.onerror = () => onClose();
  return ws;
}

// ── 未使用页面的存根（hyperopt / live 页面引用但功能已废弃）──
export interface EpochRecord { epoch: number; profit_pct: number; drawdown_pct: number; loss: number; win_rate: number; trades: number; params: Record<string, string>; [k: string]: unknown }
export interface HyperoptResult { best_epoch: EpochRecord; best: EpochRecord; epochs: EpochRecord[]; [k: string]: unknown }
export interface LiveStartConfig { strategy_id: string; stake_amount: number; [k: string]: unknown }
export async function startHyperopt(_cfg: unknown): Promise<{ task_id: string }> { return { task_id: '' } }
export async function getHyperoptStatus(_id: string): Promise<{ status: string; progress_pct: number; epochs_done: number; latest_epochs: EpochRecord[]; error?: string; result?: HyperoptResult }> { return { status: 'idle', progress_pct: 0, epochs_done: 0, latest_epochs: [] } }
export async function startLive(_cfg: LiveStartConfig): Promise<{ task_id: string }> { return { task_id: '' } }
export async function stopLive(): Promise<void> {}
export async function getLiveStatus(): Promise<{ running: boolean; dry_run?: boolean; strategy_class?: string; timeframe?: string; stake_amount?: number; pid?: number; log_tail?: string[] }> { return { running: false } }
export async function getLiveMetrics(): Promise<{ running: boolean; dry_run: boolean; strategy_class?: string; timeframe?: string; stake_amount?: number; profit?: { profit_all_coin: number; profit_all_percent: number; profit_closed_coin: number; profit_closed_percent: number; trade_count: number; closed_trade_count: number; winning_trades: number; losing_trades: number; best_pair: string; best_rate: number }; open_trades?: { trade_id: number; pair: string; open_rate: number; current_rate: number; profit_pct: number; profit_abs: number; amount: number; open_date: string }[] }> { return { running: false, dry_run: true } }
