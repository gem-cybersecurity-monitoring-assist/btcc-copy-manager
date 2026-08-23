export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
export type MarketState = "CONFIRMED" | "CAUTION" | "STALE" | "UNKNOWN";
export type Opportunity = {
  id: string; symbol: string; direction: "LONG" | "SHORT"; trader: string;
  roi30d: number; winRate: number; maxDrawdown: number; followers: number;
  leverage: number; liquidity: "HIGH" | "MEDIUM" | "LOW"; score: number;
  risk: RiskLevel; market: MarketState; freshness: string; rationale: string[];
  source: string; degraded?: boolean;
};

const candidates: Opportunity[] = [
  { id: "btc-trend", symbol: "BTCUSDT", direction: "LONG", trader: "Northstar Quant", roi30d: 18.4, winRate: 68, maxDrawdown: 7.2, followers: 842, leverage: 3, liquidity: "HIGH", score: 86, risk: "LOW", market: "CONFIRMED", freshness: "2m ago", rationale: ["30d ROI is positive with a controlled 7.2% drawdown", "3× leverage stays below the 5× policy ceiling", "BTC liquidity supports reliable copy execution"], source: "BTCC public profile" },
  { id: "eth-range", symbol: "ETHUSDT", direction: "LONG", trader: "Basis Desk", roi30d: 12.1, winRate: 64, maxDrawdown: 9.6, followers: 391, leverage: 2, liquidity: "HIGH", score: 78, risk: "LOW", market: "CONFIRMED", freshness: "4m ago", rationale: ["Consistent win rate across the recent window", "Low leverage and high liquidity reduce execution friction", "Market trend agrees with the long bias"], source: "BTCC public profile" },
  { id: "sol-momentum", symbol: "SOLUSDT", direction: "LONG", trader: "Momentum Lab", roi30d: 26.7, winRate: 59, maxDrawdown: 14.9, followers: 216, leverage: 4, liquidity: "MEDIUM", score: 69, risk: "MODERATE", market: "CAUTION", freshness: "8m ago", rationale: ["Strong return is discounted for elevated drawdown", "4× leverage leaves less room for volatility", "SOL market confirmation is mixed"], source: "BTCC public profile" },
  { id: "xrp-mean", symbol: "XRPUSDT", direction: "SHORT", trader: "Mean Reversion", roi30d: 9.3, winRate: 62, maxDrawdown: 11.2, followers: 174, leverage: 2, liquidity: "MEDIUM", score: 64, risk: "MODERATE", market: "UNKNOWN", freshness: "11m ago", rationale: ["Positive returns with moderate drawdown", "Short signal lacks a fresh market confirmation", "Medium liquidity requires smaller sizing"], source: "BTCC public profile", degraded: true },
  { id: "doge-break", symbol: "DOGEUSDT", direction: "SHORT", trader: "Volatility Edge", roi30d: 31.2, winRate: 51, maxDrawdown: 24.1, followers: 88, leverage: 5, liquidity: "LOW", score: 42, risk: "HIGH", market: "STALE", freshness: "37m ago", rationale: ["Return is outweighed by 24.1% drawdown", "Maximum leverage and low liquidity increase risk", "Market snapshot is stale; monitor only"], source: "BTCC public profile", degraded: true }
];

export function scoreOpportunity(input: Pick<Opportunity, "roi30d" | "winRate" | "maxDrawdown" | "leverage" | "liquidity" | "market">) {
  const liquidity = { HIGH: 12, MEDIUM: 6, LOW: 0 }[input.liquidity];
  const market = { CONFIRMED: 12, CAUTION: 4, UNKNOWN: 0, STALE: -8 }[input.market];
  return Math.max(0, Math.min(100, Math.round(input.roi30d * 1.4 + input.winRate * .35 - input.maxDrawdown * 1.5 - input.leverage * 2 + liquidity + market)));
}
export function getOpportunities() { return candidates; }
export function selectWatchlist(items = candidates) { return [...items].sort((a,b) => b.score-a.score).filter((item, index, all) => all.findIndex((x) => x.symbol === item.symbol) === index).slice(0, 5); }
export function getMarketStatus() { return { state: "CAUTION" as const, checkedAt: new Date().toISOString(), provider: "public read-only proxy", note: "Market confirmation is informational and never submits orders." }; }
export function getCopyActivity() { return { configured: false, status: "NOT_CONFIGURED", message: "Copy activity provider is not configured; no email, webhook, or manual alert was sent." }; }
export function scan() { return { scannedAt: new Date().toISOString(), watchlist: selectWatchlist(), market: getMarketStatus(), copyActivity: getCopyActivity(), execution: "READ_ONLY" as const }; }
export function dedupeNotification(key: string, seen: Set<string>) { if (seen.has(key)) return false; seen.add(key); return true; }
