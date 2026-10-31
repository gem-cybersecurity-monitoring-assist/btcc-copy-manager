export const SIGNAL_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "ADA", "XRP", "DOT", "AVAX", "DOGE", "LINK"] as const;
export type SignalSymbol = (typeof SIGNAL_SYMBOLS)[number];
export type SignalSide = "BUY" | "SELL" | "HOLD";
export type SignalSource = "PERSISTED_SIGNAL" | "DERIVED_WORKER_SIGNAL";
export type SignalSourceKind = "persisted" | "derived";
export type SignalFreshness = "FRESH_BY_SIGNAL_AND_MARKET_TIME" | "FRESH_BY_MARKET_TIME" | "FRESH_BY_SIGNAL_TIME" | "STALE" | "SOURCE_TIME_UNVERIFIED";

export type SignalInboxItem = {
  id: string; eventId: string; symbol: SignalSymbol; side: SignalSide; confidence: number; strategy: string;
  entryPrice: number; stopLoss: number | null; takeProfit: number | null;
  source: SignalSource; sourceKind: SignalSourceKind | null; provenanceStatus: string | null;
  priceSource: string | null; signalCreatedAt: string | null; marketDataAsOf: string | null;
  expiresAt: string | null; fetchedAt: string | null; freshness: SignalFreshness;
  decisionGrade: boolean; reviewRequired: true; readOnly: true;
};

type UnknownRecord = Record<string, unknown>;
const record = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const positiveOrNull = (value: unknown): number | null | undefined => value === null || value === undefined ? null : finite(value) && value > 0 ? value : undefined;

function parsedTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

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
  const priceSource = typeof payload.price_source === "string" ? payload.price_source : null;
  const hasVersionedContract = payload.schema_version !== undefined || payload.source_kind !== undefined || payload.event_id !== undefined;

  let source: SignalSource;
  let sourceKind: SignalSourceKind | null = null;
  let provenanceStatus: string | null = null;
  let signalCreatedAt: string | null = null;
  let marketDataAsOf: string | null = null;
  let expiresAt: string | null = null;
  let freshness: SignalFreshness;
  let id: string;
  let eventId: string;
  let decisionGrade = false;

  if (hasVersionedContract) {
    if (payload.schema_version !== 1 || typeof payload.event_id !== "string" || !payload.event_id.trim() || payload.event_id.length > 180) return { ok: false, error: "The versioned signal identity is missing or invalid." };
    if (payload.source_kind !== "persisted" && payload.source_kind !== "derived") return { ok: false, error: "The signal source kind is invalid." };
    if (typeof payload.stale !== "boolean" || typeof payload.decision_grade !== "boolean") return { ok: false, error: "The signal freshness contract is incomplete." };
    const parsedSignalAt = parsedTimestamp(payload.signal_created_at);
    const parsedMarketAt = parsedTimestamp(payload.market_data_as_of);
    const parsedExpiry = parsedTimestamp(payload.expires_at);
    if (parsedSignalAt === undefined || parsedMarketAt === undefined || parsedExpiry === undefined) return { ok: false, error: "The signal provenance timestamps are invalid." };
    if (parsedSignalAt && Date.parse(parsedSignalAt) > nowMs + 5 * 60_000) return { ok: false, error: "The signal creation timestamp is in the future." };
    if (parsedMarketAt && Date.parse(parsedMarketAt) > nowMs + 5 * 60_000) return { ok: false, error: "The market-data timestamp is in the future." };
    if (payload.decision_grade !== !payload.stale) return { ok: false, error: "The signal freshness flags are inconsistent." };
    sourceKind = payload.source_kind;
    source = sourceKind === "persisted" ? "PERSISTED_SIGNAL" : "DERIVED_WORKER_SIGNAL";
    provenanceStatus = typeof payload.provenance_status === "string" ? payload.provenance_status : null;
    const expectedStatus = sourceKind === "persisted" ? "PERSISTED_SIGNAL" : "DERIVED_WORKER_SIGNAL";
    if (provenanceStatus !== expectedStatus && provenanceStatus !== "UNTRUSTED_PRICE_FALLBACK") return { ok: false, error: "The signal provenance label is invalid." };
    if (sourceKind === "derived" && (provenanceStatus === "UNTRUSTED_PRICE_FALLBACK" || priceSource === null || priceSource === "fallback" || priceSource.startsWith("cache:"))) return { ok: false, error: "The derived signal uses cached or fallback pricing and is excluded from the inbox." };
    signalCreatedAt = parsedSignalAt;
    marketDataAsOf = parsedMarketAt;
    expiresAt = parsedExpiry;
    freshness = payload.stale ? "STALE" : sourceKind === "persisted" ? "FRESH_BY_SIGNAL_AND_MARKET_TIME" : "FRESH_BY_MARKET_TIME";
    decisionGrade = payload.decision_grade;
    eventId = payload.event_id;
    id = eventId;
  } else if (typeof payload.event_id === "string" && payload.event_id.trim() && payload.market_data_as_of !== undefined) {
    // Compatibility with the earlier read-only Worker preview contract. This
    // exposes a market timestamp but lacks the complete versioned provenance envelope.
    const parsedMarketAt = parsedTimestamp(payload.market_data_as_of);
    const parsedSignalAt = parsedTimestamp(payload.created_at ?? payload.signal_created_at);
    if (parsedMarketAt === undefined || parsedSignalAt === undefined) return { ok: false, error: "The signal market-data timestamp is invalid." };
    if (parsedMarketAt && Date.parse(parsedMarketAt) > nowMs + 5 * 60_000) return { ok: false, error: "The market-data timestamp is in the future." };
    if (parsedSignalAt && Date.parse(parsedSignalAt) > nowMs + 5 * 60_000) return { ok: false, error: "The signal timestamp is in the future." };
    if (typeof payload.stale !== "boolean" || typeof payload.market_data_stale !== "boolean") return { ok: false, error: "The signal freshness flags are incomplete." };
    sourceKind = parsedSignalAt ? "persisted" : "derived";
    source = sourceKind === "persisted" ? "PERSISTED_SIGNAL" : "DERIVED_WORKER_SIGNAL";
    signalCreatedAt = parsedSignalAt;
    marketDataAsOf = parsedMarketAt;
    provenanceStatus = source;
    const marketAge = parsedMarketAt ? nowMs - Date.parse(parsedMarketAt) : Number.POSITIVE_INFINITY;
    const isStale = payload.stale || payload.market_data_stale || marketAge < 0 || marketAge > 15 * 60_000;
    freshness = isStale ? "STALE" : "FRESH_MARKET_DATA";
    decisionGrade = false;
    eventId = payload.event_id;
    id = eventId;
    if (sourceKind === "derived" && (priceSource === null || priceSource === "fallback" || priceSource.startsWith("cache:"))) return { ok: false, error: "The derived signal uses cached or fallback pricing and is excluded from the inbox." };
  } else {
    const createdAtRaw = payload.created_at;
    const parsedCreatedAt = parsedTimestamp(createdAtRaw);
    if (parsedCreatedAt === undefined) return { ok: false, error: "The persisted signal timestamp is invalid." };
    if (parsedCreatedAt) {
      if (Date.parse(parsedCreatedAt) > nowMs + 5 * 60_000) return { ok: false, error: "The persisted signal timestamp is in the future." };
      signalCreatedAt = parsedCreatedAt; source = "PERSISTED_SIGNAL"; sourceKind = "persisted";
      freshness = nowMs - Date.parse(parsedCreatedAt) > 15 * 60_000 ? "STALE" : "FRESH_BY_SIGNAL_TIME";
      id = "persisted:" + symbol + ":" + String(payload.id ?? signalCreatedAt);
    } else if (payload.strategy === "worker_ema_crossover") {
      if (priceSource !== "coinbase" && priceSource !== "binance") return { ok: false, error: "The derived signal uses cached or fallback pricing and is excluded from the inbox." };
      source = "DERIVED_WORKER_SIGNAL"; sourceKind = "derived"; freshness = "SOURCE_TIME_UNVERIFIED";
      id = "derived-review:" + symbol + ":" + String(rawSide) + ":" + String(payload.strategy);
    } else return { ok: false, error: "The signal has no verifiable creation time or recognized derived-signal source." };
    eventId = id;
  }

  return { ok: true, value: {
    id, eventId, symbol, side: rawSide, confidence: payload.confidence, strategy: payload.strategy.trim(),
    entryPrice: payload.entry_price, stopLoss, takeProfit, source, sourceKind, provenanceStatus,
    priceSource, signalCreatedAt, marketDataAsOf, expiresAt, fetchedAt, freshness,
    decisionGrade, reviewRequired: true, readOnly: true,
  } };
}
