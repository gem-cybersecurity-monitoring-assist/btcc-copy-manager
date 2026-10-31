export const SIGNAL_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "ADA", "XRP", "DOT", "AVAX", "DOGE", "LINK"] as const;
export type SignalSymbol = (typeof SIGNAL_SYMBOLS)[number];
export type SignalSide = "BUY" | "SELL" | "HOLD";
export type SignalSource = "PERSISTED_SIGNAL" | "DERIVED_WORKER_SIGNAL";
export type SignalFreshness = "FRESH_BY_SIGNAL_TIME" | "FRESH_MARKET_DATA" | "STALE" | "SOURCE_TIME_UNVERIFIED";

export type SignalInboxItem = {
  id: string; symbol: SignalSymbol; side: SignalSide; confidence: number; strategy: string;
  entryPrice: number; stopLoss: number | null; takeProfit: number | null;
  source: SignalSource; priceSource: string | null; signalCreatedAt: string | null;
  marketDataAsOf: string | null; fetchedAt: string | null; freshness: SignalFreshness;
  reviewRequired: true; readOnly: true;
};

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positiveOrNull = (value: unknown): number | null | undefined => value === null || value === undefined ? null : finite(value) && value > 0 ? value : undefined;

export function normalizeWorkerSignal(payload: unknown, nowMs = Date.now()): { ok: true; value: SignalInboxItem } | { ok: false; error: string } {
  if (!record(payload)) return { ok: false, error: "The signal response is not an object." };
  if (payload.available !== true) return { ok: false, error: "The Worker has no available signal for this symbol." };
  if (payload.mode !== "paper" || payload.trading_mode !== "paper" || payload.network !== "testnet" || payload.allow_mainnet !== false || payload.live_trading_enabled !== false || payload.withdrawals_enabled !== false) return { ok: false, error: "The Worker did not confirm all paper-only safety flags." };
  const rawSymbol = typeof payload.symbol === "string" ? payload.symbol.toUpperCase().trim().replace(/[-/](USDT|USD)$/i, "").replace(/(USDT|USD)$/i, "") : "";
  if (!(SIGNAL_SYMBOLS as readonly string[]).includes(rawSymbol)) return { ok: false, error: "The signal symbol is not supported." };
  const symbol = rawSymbol as SignalSymbol;
  const rawSide = payload.side ?? payload.action ?? payload.signal;
  if (rawSide !== "BUY" && rawSide !== "SELL" && rawSide !== "HOLD") return { ok: false, error: "The signal direction is invalid." };
  if (!finite(payload.confidence) || payload.confidence < 0 || payload.confidence > 1) return { ok: false, error: "Signal confidence must be between 0 and 1." };
  if (!finite(payload.entry_price) || payload.entry_price <= 0) return { ok: false, error: "The signal entry price is invalid." };
  if (typeof payload.strategy !== "string" || !payload.strategy.trim() || payload.strategy.length > 100) return { ok: false, error: "The signal strategy is missing or invalid." };
  const stopLoss = positiveOrNull(payload.stop_loss); const takeProfit = positiveOrNull(payload.take_profit);
  if (stopLoss === undefined || takeProfit === undefined) return { ok: false, error: "The signal risk levels are invalid." };
  const fetchedAt = finite(payload.ts) && payload.ts > 0 && payload.ts <= 8.64e15 && Number.isFinite(new Date(payload.ts).getTime()) ? new Date(payload.ts).toISOString() : null;
  const createdAtRaw = payload.created_at; let signalCreatedAt: string | null = null;
  const marketRaw = payload.market_data_as_of;
  const marketMs = typeof marketRaw === "string" ? Date.parse(marketRaw) : NaN;
  const marketDataAsOf = Number.isFinite(marketMs) && Math.abs(marketMs) <= 8.64e15 ? new Date(marketMs).toISOString() : null;
  let source: SignalSource; let freshness: SignalFreshness; let id: string;
  if (typeof createdAtRaw === "string" && createdAtRaw.trim()) {
    const parsed = Date.parse(createdAtRaw);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > 8.64e15) return { ok: false, error: "The persisted signal timestamp is invalid." };
    if (parsed > nowMs + 5 * 60_000) return { ok: false, error: "The persisted signal timestamp is in the future." };
    signalCreatedAt = new Date(parsed).toISOString(); source = "PERSISTED_SIGNAL";
    freshness = payload.stale === true || nowMs - parsed > 15 * 60_000 ? "STALE" : "FRESH_BY_SIGNAL_TIME";
    id = typeof payload.event_id === "string" && payload.event_id.length <= 180 ? payload.event_id : "persisted:" + symbol + ":" + String(payload.id ?? signalCreatedAt);
  } else if (payload.strategy === "worker_ema_crossover") {
    if (payload.price_source !== "coinbase" && payload.price_source !== "binance") return { ok: false, error: "The derived signal uses cached or fallback pricing and is excluded from the inbox." };
    source = "DERIVED_WORKER_SIGNAL";
    const marketTimeValid = Number.isFinite(marketMs) && marketMs <= nowMs + 5 * 60_000 && nowMs - marketMs <= 15 * 60_000;
    if (payload.stale === true || payload.market_data_stale === true || (Number.isFinite(marketMs) && !marketTimeValid)) freshness = "STALE";
    else if (payload.market_data_stale === false && marketTimeValid) freshness = "FRESH_MARKET_DATA";
    else freshness = "SOURCE_TIME_UNVERIFIED";
    id = typeof payload.event_id === "string" && payload.event_id.length <= 180 ? payload.event_id : "derived-review:" + symbol + ":" + String(rawSide) + ":" + String(payload.strategy);
  } else return { ok: false, error: "The signal has no verifiable creation time or recognized derived-signal source." };
  return { ok: true, value: { id, symbol, side: rawSide, confidence: payload.confidence, strategy: payload.strategy.trim(), entryPrice: payload.entry_price, stopLoss, takeProfit, source, priceSource: typeof payload.price_source === "string" ? payload.price_source : null, signalCreatedAt, marketDataAsOf, fetchedAt, freshness, reviewRequired: true, readOnly: true } };
}