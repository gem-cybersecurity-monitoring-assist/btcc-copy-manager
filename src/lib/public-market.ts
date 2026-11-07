export type PublicMarketAsset = {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24hPct: number | null;
  volume24hUsd: number | null;
  marketCapUsd: number | null;
  updatedAt: string;
};

const symbols = new Set(["bitcoin", "ethereum", "solana"]);
export function parsePublicMarket(input: unknown): PublicMarketAsset[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const result: PublicMarketAsset[] = [];
  for (const row of input) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || !symbols.has(r.id) || seen.has(r.id)) continue;
    if (typeof r.symbol !== "string" || typeof r.name !== "string") continue;
    if (typeof r.current_price !== "number" || !Number.isFinite(r.current_price) || r.current_price <= 0) continue;
    if (typeof r.last_updated !== "string" || !Number.isFinite(Date.parse(r.last_updated))) continue;
    const optional = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
    seen.add(r.id);
    result.push({
      id: r.id, symbol: r.symbol.toUpperCase(), name: r.name,
      priceUsd: r.current_price,
      change24hPct: optional(r.price_change_percentage_24h),
      volume24hUsd: optional(r.total_volume),
      marketCapUsd: optional(r.market_cap),
      updatedAt: r.last_updated,
    });
  }
  return result;
}
