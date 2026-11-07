import { rankStrategies } from "../../lib/engine/scoring.ts";
import type { EngineState } from "../../lib/engine/types.ts";
import type { LiquidityObservation } from "./liquidity.ts";

/**
 * Coordinated evidence assessment. Does not infer native copy-trading quotes
 * from spot books and NEVER authorizes an exchange order.
 */
export type DecisionCheck = {
  id: "strategy" | "portfolio" | "liquidity" | "service";
  title: string;
  status: "observed" | "review" | "blocked";
  detail: string;
};
export type CombinedDecision = {
  researchStatus: "EVIDENCE_AVAILABLE" | "RESEARCH_HOLD";
  executionPermitted: false;
  eligibleStrategies: number;
  verifiedBooks: number;
  checks: DecisionCheck[];
  observedAt: string;
};

export function assessCombinedDecision(
  engine: EngineState | null,
  books: LiquidityObservation[],
  sentinelConnected: boolean,
  now = new Date(),
): CombinedDecision {
  const checks: DecisionCheck[] = [];
  const validNow = Number.isFinite(now.getTime()) ? now : new Date();
  const eligible = engine
    ? rankStrategies(engine.strategies, engine.policy, validNow, engine.weights)
      .filter(result => result.eligible && !result.simulated).length
    : 0;
  const strategies = engine?.strategies.length ?? 0;
  checks.push({
    id: "strategy",
    title: "Trader evidence",
    status: eligible ? "observed" : "blocked",
    detail: eligible
      ? `${eligible} recorded strategy/strategies meet the saved screening policy. Native exchange IDs, full fee reconciliation, and execution rights remain unverified.`
      : strategies
        ? `None of ${strategies} recorded strategies has the verified history and risk evidence required by your screening policy.`
        : "No eligible trader history is recorded in this workspace.",
  });

  const critical = engine?.alerts.filter(a => !a.resolvedAt && a.severity === "critical").length ?? 0;
  const warnings = engine?.alerts.filter(a => !a.resolvedAt && a.severity === "warning").length ?? 0;
  checks.push({
    id: "portfolio",
    title: "Portfolio risk",
    status: !engine || critical ? "blocked" : warnings ? "review" : "observed",
    detail: !engine
      ? "No validated portfolio record is available."
      : critical
        ? `${critical} unresolved critical risk alert(s). New exposure must remain on hold until independently reviewed.`
        : warnings
          ? `${warnings} unresolved portfolio warning(s). Review drawdown and concentration before adding exposure.`
          : "No unresolved critical or warning alerts in the saved workspace. This does not prove exchange-enforced limits.",
  });

  // Provider-observed spot order books can establish context only. Separate USD
  // and USDT books; do not treat a stale quote or a spot spread as a futures fill.
  const freshBooks = books.filter(b =>
    b && (b.symbol === "BTC" || b.symbol === "ETH") &&
    (b.quoteCurrency === "USD" || b.quoteCurrency === "USDT") &&
    Number.isFinite(b.spreadBps) && b.spreadBps >= 0 && b.spreadBps <= 10000 &&
    Number.isFinite(b.bidDepthQuote) && b.bidDepthQuote > 0 &&
    Number.isFinite(b.askDepthQuote) && b.askDepthQuote > 0 &&
    Number.isFinite(Date.parse(b.sourceTimestamp)) &&
    validNow.getTime() - Date.parse(b.sourceTimestamp) >= 0 &&
    validNow.getTime() - Date.parse(b.sourceTimestamp) <= 120_000,
  );
  const usdtSources = new Set(freshBooks.filter(b => b.quoteCurrency === "USDT").map(b => b.provider));
  const symbols = new Set(freshBooks.map(b => b.symbol));
  const wideSpreads = freshBooks.filter(b => b.spreadBps > 30).length;
  const marketObserved = usdtSources.size >= 2 && symbols.has("BTC") && symbols.has("ETH") && wideSpreads === 0;
  checks.push({
    id: "liquidity",
    title: "Market liquidity",
    status: marketObserved ? "observed" : freshBooks.length ? "review" : "blocked",
    detail: !freshBooks.length
      ? "No fresh validated spot order-book observations. No execution price assumptions are allowed."
      : `${freshBooks.length} fresh spot books, ${usdtSources.size} USDT venue(s), ${symbols.size} asset(s)${wideSpreads ? `, ${wideSpreads} wide spread(s)` : ""}. Spot depth is context only, not executable futures copy liquidity.`,
  });

  checks.push({
    id: "service",
    title: "Persistent account service",
    status: sentinelConnected ? "review" : "blocked",
    detail: sentinelConnected
      ? "Sentinel health responded, but owner-scoped account data, native project mapping, and continuous risk execution are not independently verified."
      : "A persistent owner-authenticated Sentinel service is not confirmed. Browser-local reviews cannot operate after the dashboard closes.",
  });

  const evidence = checks.some(c => c.status === "observed");
  return {
    researchStatus: evidence ? "EVIDENCE_AVAILABLE" : "RESEARCH_HOLD",
    executionPermitted: false,
    eligibleStrategies: eligible,
    verifiedBooks: freshBooks.length,
    checks,
    observedAt: validNow.toISOString(),
  };
}
