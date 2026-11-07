export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type MarketState = "CONFIRMED" | "CAUTION" | "STALE" | "UNKNOWN";
export type Opportunity = {
  id: string; symbol: string; direction: "LONG" | "SHORT"; trader: string;
  roi30d: number; winRate: number; maxDrawdown: number; followers: number;
  leverage: number; liquidity: "HIGH" | "MEDIUM" | "LOW"; score: number;
  risk: RiskLevel; market: MarketState; freshness: string; rationale: string[];
  source: string; degraded?: boolean;
};

// Public trader discovery is not yet connected to a verified provider.
// Never display seeded examples as real traders or fabricate data freshness.
const candidates: Opportunity[] = [];

export function scoreOpportunity(input: Pick<Opportunity, "roi30d" | "winRate" | "maxDrawdown" | "leverage" | "liquidity" | "market">) {
  const liquidity = { HIGH: 12, MEDIUM: 6, LOW: 0 }[input.liquidity];
  const market = { CONFIRMED: 12, CAUTION: 4, UNKNOWN: 0, STALE: -8 }[input.market];
  return Math.max(0, Math.min(100, Math.round(input.roi30d * 1.4 + input.winRate * .35 - input.maxDrawdown * 1.5 - input.leverage * 2 + liquidity + market)));
}
export function getOpportunities() { return candidates; }
export function selectWatchlist(items = candidates) { return [...items].sort((a,b) => b.score-a.score).filter((item, index, all) => all.findIndex((x) => x.symbol === item.symbol) === index).slice(0, 5); }
export function getMarketStatus() { return { state: "UNKNOWN" as const, checkedAt: null, provider: null, note: "No verified real-time market provider connected. Trader discovery and liquidity metrics are unavailable." }; }
export function getCopyActivity() { return { configured: false, status: "NOT_CONFIGURED", message: "Copy activity provider is not configured; no email, webhook, or manual alert was sent." }; }
export function scan() { return { scannedAt: new Date().toISOString(), watchlist: selectWatchlist(), market: getMarketStatus(), copyActivity: getCopyActivity(), execution: "READ_ONLY" as const }; }
export function dedupeNotification(key: string, seen: Set<string>) { if (seen.has(key)) return false; seen.add(key); return true; }
