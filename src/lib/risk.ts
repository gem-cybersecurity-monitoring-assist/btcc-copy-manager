import type { CopyPlan, RiskResult } from "./types";

export const DEFAULT_PLAN: CopyPlan = {
  id: "plan-demo-001",
  name: "Current BTCC plan review",
  leader: "Enter lead trader",
  symbol: "BTC/USDT",
  allocatedUsdt: 100,
  marginPerTradeUsdt: 10,
  leverage: 5,
  maxOpenTrades: 3,
  stopLossPercent: 5,
  takeProfitPercent: 10,
  leaderDrawdownPercent: 12,
  state: "REVIEW",
  updatedAt: "Not synced"
};

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function evaluateRisk(input: CopyPlan): RiskResult {
  const allocated = finite(input.allocatedUsdt);
  const margin = finite(input.marginPerTradeUsdt);
  const leverage = finite(input.leverage, 1);
  const openTrades = Math.max(1, Math.floor(finite(input.maxOpenTrades, 1)));
  const stopLoss = finite(input.stopLossPercent);
  const drawdown = finite(input.leaderDrawdownPercent);
  const worstCaseMarginUsdt = margin * openTrades;
  const notionalPerTradeUsdt = margin * leverage;
  const portfolioExposureUsdt = notionalPerTradeUsdt * openTrades;
  const estimatedStopLossUsdt = portfolioExposureUsdt * (stopLoss / 100);
  const allocationRatio = allocated > 0 ? worstCaseMarginUsdt / allocated : 1;
  const stopRatio = allocated > 0 ? estimatedStopLossUsdt / allocated : 1;

  let score = 12;
  const flags: string[] = [];
  const recommendations: string[] = [];

  if (leverage > 10) { score += 32; flags.push("Leverage is above the 10× review ceiling."); recommendations.push("Reduce leverage to 5× or lower while validating the plan."); }
  else if (leverage > 5) { score += 18; flags.push("Leverage increases liquidation sensitivity."); recommendations.push("Stress-test the plan at 5× leverage."); }
  else if (leverage > 2) score += 8;

  if (allocationRatio > 0.5) { score += 25; flags.push("More than half of allocated capital can be tied up as margin."); recommendations.push("Reduce margin per trade or maximum simultaneous trades."); }
  else if (allocationRatio > 0.3) { score += 12; flags.push("Margin concentration is elevated."); }

  if (stopLoss === 0) { score += 24; flags.push("No stop-loss value is recorded."); recommendations.push("Record a protective stop-loss before considering activation."); }
  else if (stopRatio > 0.1) { score += 18; flags.push("Estimated stop exposure exceeds 10% of allocated capital."); recommendations.push("Lower size, leverage, or stop distance until estimated loss is below 5%."); }
  else if (stopRatio > 0.05) score += 8;

  if (drawdown > 20) { score += 22; flags.push("Lead-trader drawdown is above 20%."); recommendations.push("Do not activate without reviewing a longer verified performance window."); }
  else if (drawdown > 10) { score += 10; flags.push("Lead-trader drawdown requires review."); }

  if (allocated <= 0 || margin <= 0) { score = 100; flags.push("Allocation or margin is missing."); recommendations.push("Enter the actual BTCC plan values before making a decision."); }
  score = Math.min(100, Math.round(score));
  const grade = score >= 75 ? "CRITICAL" : score >= 50 ? "HIGH" : score >= 25 ? "MODERATE" : "LOW";
  if (flags.length === 0) flags.push("No policy threshold is currently exceeded.");
  if (recommendations.length === 0) recommendations.push("Verify live position limits, fees, and stop-loss behavior before activation.");

  return { score, grade, worstCaseMarginUsdt, notionalPerTradeUsdt, portfolioExposureUsdt, estimatedStopLossUsdt, flags, recommendations };
}
