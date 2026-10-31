export const SIGNAL_INBOX_SYMBOLS = ["BTC", "ETH", "SOL", "BNB", "ADA", "XRP", "DOT", "AVAX", "DOGE", "LINK"] as const;
export type SignalInboxSymbol = (typeof SIGNAL_INBOX_SYMBOLS)[number];
export type SignalSide = "BUY" | "SELL" | "HOLD";
export type SignalReviewState = "REVIEW_REQUIRED" | "STALE_REVIEW" | "BLOCKED_FALLBACK";

export type SignalInboxItem = {
  symbol: SignalInboxSymbol;
  side: SignalSide;
  confidence: number;
  entryPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  strategy: string;
  sourceKind: "PERSISTED_SIGNAL" | "DERIVED_WORKER_SIGNAL";
  priceSource: string | null;
  createdAt: string | null;
  responseAt: string | null;
  reviewState: SignalReviewState;
};

export type SignalNormalization =
  | { ok: true; value: SignalInboxItem }
  | { ok: false; error: string };

export function isSignalInboxSymbol(value: string): value is SignalInboxSymbol {
  return (SIGNAL_INBOX_SYMBOLS as readonly string[]).includes(value.trim().toUpperCase());
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const sqliteUtc = value.match(/^(\\d{4}-\\d{2}-\\d{2}) (\\d{2}:\\d{2}:\\d{2})$/);
  const date = new Date(sqliteUtc ? `${sqliteUtc[1]}T${sqliteUtc[2]}Z` : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Strictly normalizes the public Worker response. It never makes a signal actionable. */
export function normalizeWorkerSignal(input: unknown, requestedSymbol: SignalInboxSymbol): SignalNormalization {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "The signal service returned an invalid response." };
  }
  const row = input as Record<string, unknown>;
  const symbol = typeof row.symbol === "string" ? row.symbol.trim().toUpperCase() : "";
  if (symbol !== requestedSymbol) return { ok: false, error: "The signal service returned a different symbol than requested." };
  if (row.available !== true) return { ok: false, error: "No signal is currently available for this symbol." };

  const runtimeSafe =
    row.mode === "paper" &&
    row.trading_mode === "paper" &&
    row.exchange_mode === "paper" &&
    row.network === "testnet" &&
    row.allow_mainnet === false &&
    row.live_trading_enabled === false &&
    row.withdrawals_enabled === false;
  if (!runtimeSafe) return { ok: false, error: "The signal service did not confirm its paper/testnet-only safety state." };

  const rawSide = String(row.side ?? row.action ?? row.signal ?? "").toUpperCase();
  if (rawSide !== "BUY" && rawSide !== "SELL" && rawSide !== "HOLD") {
    return { ok: false, error: "The signal direction is not supported." };
  }
  const confidence = finite(row.confidence);
  const entryPrice = finite(row.entry_price);
  if (confidence === null || confidence < 0 || confidence > 1 || entryPrice === null || entryPrice <= 0) {
    return { ok: false, error: "The signal confidence or reference price is invalid." };
  }

  const priceSource = typeof row.price_source === "string" && row.price_source.trim()
    ? row.price_source.trim().toLowerCase()
    : null;
  const reviewState: SignalReviewState = priceSource === "fallback"
    ? "BLOCKED_FALLBACK"
    : !priceSource || priceSource.startsWith("cache")
      ? "STALE_REVIEW"
      : "REVIEW_REQUIRED";
  const persisted = (finite(row.id) ?? 0) > 0 || typeof row.created_at === "string";
  const responseTimestamp = finite(row.ts);
  const responseDate = responseTimestamp !== null && responseTimestamp > 0 ? new Date(responseTimestamp) : null;
  const responseAt = responseDate && Number.isFinite(responseDate.getTime()) ? responseDate.toISOString() : null;

  return {
    ok: true,
    value: {
      symbol: requestedSymbol,
      side: rawSide,
      confidence,
      entryPrice,
      stopLoss: finite(row.stop_loss),
      takeProfit: finite(row.take_profit),
      strategy: typeof row.strategy === "string" && row.strategy.trim() ? row.strategy.trim().slice(0, 100) : "Unspecified strategy",
      sourceKind: persisted ? "PERSISTED_SIGNAL" : "DERIVED_WORKER_SIGNAL",
      priceSource,
      createdAt: isoDate(row.created_at),
      responseAt,
      reviewState,
    },
  };
}
