// Transparent, configurable strategy scoring. Every candidate is assessed with the same framework.
// A score is a screening aid for comparing evidence, not a prediction or guarantee of future returns.

import { computeMetrics, netReturns, type SeriesMetrics } from "./metrics.ts";
import { assessQuality, dataConfidence, isSimulated, latestObservation, type QualityFlag } from "./quality.ts";
import type { RiskPolicy, ScoringWeights, Strategy } from "./types.ts";

export const DEFAULT_WEIGHTS: ScoringWeights = { netReturn: 20, drawdown: 25, riskAdjusted: 15, consistency: 10, history: 10, dataQuality: 20 };

/** Default per-period cost drag (fees, funding, slippage) used when estimating net returns, in %. */
export const DEFAULT_COST_DRAG_PCT = { daily: 0.02, weekly: 0.1 } as const;

export type ScoreComponent = { key: keyof ScoringWeights; label: string; points: number | null; weight: number; explanation: string };
export type StrategyEvaluation = {
  strategyId: string;
  score: number;
  grade: "A" | "B" | "C" | "D";
  eligible: boolean;
  simulated: boolean;
  components: ScoreComponent[];
  penalties: string[];
  ineligibleReasons: string[];
  missing: string[];
  invalidators: string[];
  flags: QualityFlag[];
  confidence: number;
  gross: SeriesMetrics | null;
  net: SeriesMetrics | null;
  /** Annualized volatility used for risk-adjusted allocation (net series, else null). */
  volatilityPct: number | null;
};

const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

export function netSeriesReturns(strategy: Strategy): number[] | null {
  const s = strategy.series;
  if (!s) return null;
  if (s.basis === "net") return s.returns;
  return netReturns(s.returns, strategy.profitSharePct ?? 0, DEFAULT_COST_DRAG_PCT[s.frequency]);
}

function rollingPositiveShare(returns: number[], window: number): number | null {
  if (returns.length < window * 2) return null;
  let positive = 0, total = 0;
  for (let i = window; i <= returns.length; i += Math.max(1, Math.floor(window / 2))) {
    const growth = returns.slice(i - window, i).reduce((v, r) => v * (1 + r), 1);
    total++;
    if (growth > 1) positive++;
  }
  return total ? positive / total : null;
}

export type EvaluateOptions = { /** Simulation lab only: score simulated data instead of rejecting it. */ allowSimulated?: boolean };

export function evaluateStrategy(strategy: Strategy, policy: RiskPolicy, now: Date, weights: ScoringWeights = DEFAULT_WEIGHTS, options: EvaluateOptions = {}): StrategyEvaluation {
  const flags = assessQuality(strategy, now, policy.staleAfterHours);
  const confidence = dataConfidence(strategy);
  const simulated = isSimulated(strategy);
  const s = strategy.series;
  const netR = netSeriesReturns(strategy);
  const gross = s ? computeMetrics(s) : null;
  const net = s && netR ? computeMetrics(s, netR) : null;
  const obs = latestObservation(strategy);
  const missing: string[] = [];
  const penalties: string[] = [];
  const ineligible: string[] = [];

  // Prefer history-derived figures; fall back to the latest recorded summary (lower confidence).
  const maxDd = net?.maxDrawdownPct ?? obs?.values.maxDrawdownPct ?? null;
  const components: ScoreComponent[] = [];

  let annual = net?.annualizedReturnPct ?? null;
  let returnNote = annual !== null ? `${annual}% annualized after estimated profit share and costs.` : "";
  if (annual === null && obs?.values.roiPct !== undefined && obs.values.periodDays) {
    // Summary ROI is gross and unannualized; count only half of it to reflect missing costs/verification.
    annual = obs.values.roiPct * 0.5;
    returnNote = `${obs.values.roiPct}% gross ROI over ${obs.values.periodDays} days (summary only, counted at 50% for missing fees/verification).`;
  }
  if (annual === null) missing.push("net return");
  components.push({ key: "netReturn", label: "Net return", weight: weights.netReturn, points: annual === null ? null : clamp(50 + clamp(annual, -50, 50)), explanation: returnNote || "No return data." });

  if (maxDd === null) missing.push("maximum drawdown");
  components.push({ key: "drawdown", label: "Drawdown", weight: weights.drawdown, points: maxDd === null ? null : clamp(100 - maxDd * 2.5), explanation: maxDd === null ? "No drawdown data." : `Worst peak-to-trough loss ${maxDd}%${net ? `, longest recovery ${net.maxDrawdownDurationPeriods} periods` : " (reported figure)"}.` });

  const sortino = net?.sortino ?? null;
  const sharpe = net?.sharpe ?? null;
  if (sortino === null) missing.push("Sharpe/Sortino (needs 30+ periods of history)");
  components.push({ key: "riskAdjusted", label: "Risk-adjusted", weight: weights.riskAdjusted, points: sortino === null ? null : clamp(20 + sortino * 30), explanation: sortino === null ? "Not enough history." : `Sortino ${sortino}, Sharpe ${sharpe ?? "n/a"} (risk-free rate 0).` });

  const window = s?.frequency === "weekly" ? 4 : 30;
  const consistency = netR ? rollingPositiveShare(netR, window) : null;
  if (consistency === null) missing.push("rolling consistency");
  components.push({ key: "consistency", label: "Consistency", weight: weights.consistency, points: consistency === null ? null : Math.round(consistency * 100), explanation: consistency === null ? "Not enough history for rolling windows." : `${Math.round(consistency * 100)}% of rolling ${window}-${s?.frequency === "weekly" ? "week" : "day"} windows were profitable.` });

  const points = s?.returns.length ?? 0;
  const trades = obs?.values.trades ?? null;
  const historyPoints = clamp(Math.min(points / (s?.frequency === "weekly" ? 52 : 180), 1) * 75 + (trades === null ? 0 : Math.min(trades / 200, 1) * 25));
  components.push({ key: "history", label: "History", weight: weights.history, points: Math.round(historyPoints), explanation: `${points} periods of return history${trades !== null ? `, ${trades} trades reported` : ", trade count unknown"}.` });

  components.push({ key: "dataQuality", label: "Data quality", weight: weights.dataQuality, points: Math.round(confidence * 100), explanation: `Confidence ${Math.round(confidence * 100)}% based on the best available source.` });

  // Missing components score zero: absence of evidence is not treated as average performance.
  const totalWeight = components.reduce((a, c) => a + c.weight, 0) || 1;
  let score = components.reduce((a, c) => a + (c.points ?? 0) * c.weight, 0) / totalWeight;

  const flagCodes = new Set(flags.map((f) => f.code));
  if (flagCodes.has("extreme_periods")) { score -= 10; penalties.push("-10: extreme single-period moves."); }
  if (flagCodes.has("concentrated_gains")) { score -= 10; penalties.push("-10: gains concentrated in a few periods."); }
  if (flagCodes.has("roi_spike")) { score -= 10; penalties.push("-10: short-term ROI spike."); }
  if (flagCodes.has("inconsistent_drawdown")) { score -= 10; penalties.push("-10: reported and computed drawdown disagree."); }

  if (maxDd !== null && maxDd > policy.maxStrategyDrawdownPct) {
    score = Math.min(score, 35);
    penalties.push(`Capped at 35: drawdown ${maxDd}% exceeds your ${policy.maxStrategyDrawdownPct}% limit.`);
    ineligible.push(`Drawdown ${maxDd}% exceeds limit ${policy.maxStrategyDrawdownPct}%.`);
  }
  if (strategy.maxLeverage !== null && strategy.maxLeverage > policy.maxLeverage) {
    score = Math.min(score, 40);
    penalties.push(`Capped at 40: leverage ${strategy.maxLeverage}x exceeds your ${policy.maxLeverage}x limit.`);
    ineligible.push(`Leverage ${strategy.maxLeverage}x exceeds limit ${policy.maxLeverage}x.`);
  }
  if (strategy.profitSharePct !== null && strategy.profitSharePct > policy.maxProfitSharePct) ineligible.push(`Profit share ${strategy.profitSharePct}% exceeds limit ${policy.maxProfitSharePct}%.`);
  if (!s) ineligible.push("No return history recorded; summary figures alone are not enough to allocate capital.");
  else if (points < policy.minHistoryPoints) ineligible.push(`History has ${points} periods; policy requires ${policy.minHistoryPoints}.`);
  if (confidence < policy.minConfidence && !(simulated && options.allowSimulated)) ineligible.push(`Data confidence ${Math.round(confidence * 100)}% is below the ${Math.round(policy.minConfidence * 100)}% minimum.`);
  if (simulated && !options.allowSimulated) ineligible.push("Simulated data cannot support a real allocation.");
  if (flagCodes.has("stale_series") || flagCodes.has("stale_observation")) ineligible.push("Data is stale; refresh it from the provider first.");
  score = Math.round(clamp(score));
  if (score < policy.minScore) ineligible.push(`Score ${score} is below the minimum ${policy.minScore}.`);

  const invalidators = [
    points ? `The ranking assumes the last ${points} ${s?.frequency === "weekly" ? "weeks" : "days"} are representative; a market regime the strategy has not traded through could change results.` : "No history: the ranking rests on reported summary figures only.",
    "The trader can change leverage, assets, or position sizing at any time.",
    "Profit share, fees, and copy minimums can change on the provider.",
    "Your copied results can differ from the trader's because of entry timing, slippage, and position-size rounding.",
  ];
  if (flagCodes.has("concentrated_gains")) invalidators.unshift("A few outsized periods drive most of the return; without them the record may be ordinary.");
  if (!strategy.series?.verified) invalidators.push("History is not independently verified; selective or edited reporting would invalidate the score.");

  return {
    strategyId: strategy.id,
    score,
    grade: score >= 75 ? "A" : score >= 60 ? "B" : score >= 45 ? "C" : "D",
    eligible: ineligible.length === 0,
    simulated,
    components,
    penalties,
    ineligibleReasons: ineligible,
    missing,
    invalidators,
    flags,
    confidence,
    gross,
    net,
    volatilityPct: net?.volatilityPct ?? null,
  };
}

/** Ranks by score, with eligible candidates first. */
export function rankStrategies(strategies: Strategy[], policy: RiskPolicy, now: Date, weights?: ScoringWeights, options: EvaluateOptions = {}) {
  return strategies
    .map((s) => evaluateStrategy(s, policy, now, weights, options))
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
}
