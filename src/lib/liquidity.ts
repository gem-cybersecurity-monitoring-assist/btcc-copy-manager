/** Source-observed spot order books. Not copy-trading execution quotes. */
export type LiquidityObservation = {
  provider: "Bitget" | "Kraken";
  symbol: "BTC" | "ETH";
  quoteCurrency: "USD" | "USDT";
  bid: number; ask: number; mid: number; spreadBps: number;
  bidDepthQuote: number; askDepthQuote: number;
  depthImbalancePct: number; levels: number;
  sourceTimestamp: string; retrievedAt: string;
};
type Level = [unknown, unknown, ...unknown[]];

function parseLevels(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  const output: Array<[number, number]> = [];
  for (const raw of value.slice(0, 10)) {
    if (!Array.isArray(raw) || raw.length < 2) return [];
    const price = Number(raw[0]), size = Number(raw[1]);
    if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) return [];
    output.push([price,size]);
  }
  return output;
}

/** Validated top-ten quote depth and spread; reject stale/crossed markets. */
export function normalizeOrderBook(
  provider: "Bitget" | "Kraken",
  symbol: "BTC" | "ETH",
  raw: unknown, retrieved = new Date(),
): LiquidityObservation | null {
  if (!raw || typeof raw !== "object" || !Number.isFinite(retrieved.getTime())) return null;
  const body = raw as Record<string, unknown>;
  let book: Record<string, unknown>, timestamp: number;
  if (provider === "Bitget") {
    if (body.code !== "00000" || !body.data || typeof body.data !== "object") return null;
    book = body.data as Record<string, unknown>;
    timestamp = Number(book.ts);
  } else {
    if (!Array.isArray(body.error) || body.error.length || !body.result || typeof body.result !== "object") return null;
    const result = body.result as Record<string, unknown>;
    const pairs = Object.values(result).filter(v => v && typeof v === "object") as Record<string,unknown>[];
    if (pairs.length !== 1) return null;
    book = pairs[0];
    const bids = book.bids as Level[] | undefined, asks = book.asks as Level[] | undefined;
    timestamp = Math.min(Number(bids?.[0]?.[2]), Number(asks?.[0]?.[2])) * 1000;
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0 ||
      retrieved.getTime() - timestamp > 120_000 || timestamp > retrieved.getTime() + 15_000) return null;
  const bids = parseLevels(book.bids), asks = parseLevels(book.asks);
  if (!bids.length || !asks.length) return null;
  const bid = bids[0][0], ask = asks[0][0], mid = (bid+ask)/2;
  if (bid >= ask) return null;
  if (bids.some(([price], i) => i > 0 && price > bids[i-1][0]) ||
      asks.some(([price], i) => i > 0 && price < asks[i-1][0])) return null;
  const bidDepthQuote = bids.reduce((acc,[p,s]) => acc + p*s,0);
  const askDepthQuote = asks.reduce((acc,[p,s]) => acc + p*s,0);
  const sum = bidDepthQuote+askDepthQuote;
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return {
    provider, symbol, quoteCurrency: provider === "Bitget" ? "USDT" : "USD",
    bid, ask, mid, spreadBps: (ask-bid)/mid * 10_000,
    bidDepthQuote, askDepthQuote,
    depthImbalancePct: (bidDepthQuote-askDepthQuote)/sum*100,
    levels: Math.min(bids.length,asks.length),
    sourceTimestamp: new Date(timestamp).toISOString(), retrievedAt: retrieved.toISOString(),
  };
}
