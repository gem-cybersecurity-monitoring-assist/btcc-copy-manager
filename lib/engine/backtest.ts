// Walk-forward backtesting and paper portfolios. Every allocation decision uses only data dated before
// the decision (no look-ahead). Results are simulations and must never be presented as earnings.

import { planAllocation } from "./allocation.ts";
import { computeMetrics, type SeriesMetrics } from "./metrics.ts";
import { DEFAULT_WEIGHTS, evaluateStrategy, netSeriesReturns } from "./scoring.ts";
import type { AllocationMethod, PaperPortfolio, PlannerSettings, ProviderAccount, ProviderDefinition, RiskPolicy, ScoringWeights, Strategy } from "./types.ts";

export type BacktestConfig = {
  startCapitalUsd: number;
  /** Rebalance every N periods. */
  rebalanceEvery: number;
  /** Periods of history required before the first decision (training window, never scored). */
  warmup: number;
  /** Simulates late data: decisions at t only see data up to t - delay. */
  delayPeriods: number;
  /** Cost charged on traded amount at each rebalance, in %. */
  rebalanceCostPct: number;
};

export const DEFAULT_BACKTEST: BacktestConfig = { startCapitalUsd: 30, rebalanceEvery: 14, warmup: 60, delayPeriods: 1, rebalanceCostPct: 0.2 };

export type BacktestResult = {
  method: AllocationMethod | "cash";
  periods: number;
  startDate: string | null;
  endDate: string | null;
  rebalances: number;
  finalValueUsd: number;
  metrics: SeriesMetrics;
  equity: { date: string; value: number }[];
  avgHoldings: number;
  avgCashPct: number;
  turnoverUsd: number;
  costsUsd: number;
  missingDataPeriods: number;
};

export type BacktestReport = {
  config: BacktestConfig;
  frequency: "daily" | "weekly" | null;
  universe: string[];
  excluded: { strategyId: string; reason: string }[];
  trainingPeriods: number;
  evaluationPeriods: number;
  results: BacktestResult[];
  assumptions: string[];
  limitations: string[];
};

function truncate(strategy: Strategy, cutoffDate: string): Strategy {
  if (!strategy.series) return strategy;
  const n = strategy.series.dates.filter((d) => d < cutoffDate).length;
  return { ...strategy, series: { ...strategy.series, dates: strategy.series.dates.slice(0, n), returns: strategy.series.returns.slice(0, n) } };
}

export function runBacktest(input: {
  strategies: Strategy[];
  accounts: ProviderAccount[];
  customProviders: ProviderDefinition[];
  policy: RiskPolicy;
  planner: PlannerSettings;
  weights?: ScoringWeights;
  methods?: AllocationMethod[];
  config?: Partial<BacktestConfig>;
}): BacktestReport {
  const config = { ...DEFAULT_BACKTEST, ...input.config };
  const methods = input.methods ?? ["equal", "risk_adjusted", "score_weighted"];
  const withSeries = input.strategies.filter((s) => s.series && s.series.returns.length > 0);
  const counts = { daily: 0, weekly: 0 };
  withSeries.forEach((s) => counts[s.series!.frequency]++);
  const frequency = withSeries.length ? (counts.daily >= counts.weekly ? "daily" : "weekly") : null;
  const excluded = input.strategies.filter((s) => !s.series || s.series.frequency !== frequency).map((s) => ({ strategyId: s.id, reason: s.series ? `Different frequency (${s.series.frequency}).` : "No return history." }));
  const universe = withSeries.filter((s) => s.series!.frequency === frequency);
  const calendar = [...new Set(universe.flatMap((s) => s.series!.dates))].sort();
  const netByStrategy = new Map(universe.map((s) => {
    const net = netSeriesReturns(s)!;
    return [s.id, new Map(s.series!.dates.map((d, i) => [d, net[i]]))] as const;
  }));
  const evaluationPeriods = Math.max(0, calendar.length - config.warmup);
  const assumptions = [
    "Decisions at each rebalance use only returns dated before that rebalance, lagged by the configured delay.",
    "Returns are net of the recorded profit share (high-water mark) and a per-period cost estimate; a rebalance cost is charged on traded amounts.",
    "Provider minimums, per-provider/strategy/cluster caps, the cash reserve, and the portfolio drawdown budget apply at every rebalance.",
    "Unallocated cash earns 0%. A strategy with no return on a date (gap or ended history) earns 0% for that period.",
    "Copied results are assumed equal to the strategy's recorded returns; real copying adds timing and size-rounding differences.",
  ];
  const limitations = [
    `Sample: ${universe.length} strategies, ${calendar.length} periods (${config.warmup} warm-up, ${evaluationPeriods} evaluated out of sample).`,
    "Survivorship bias: the universe contains only strategies you recorded. Traders that failed and disappeared before you recorded them are missing, which flatters results.",
    "Past returns do not predict future returns; a backtest shows how the rules behaved on this data only.",
  ];
  if (universe.some((s) => s.series!.source === "simulated")) limitations.unshift("Includes SIMULATED data. Results test the engine's mechanics, not any real trader.");
  if (evaluationPeriods < 60) limitations.push("Fewer than 60 evaluated periods: results are not statistically meaningful.");

  const run = (method: AllocationMethod | "cash"): BacktestResult => {
    let value = config.startCapitalUsd;
    let positions = new Map<string, number>();
    let cash = value;
    const equity: { date: string; value: number }[] = [];
    const portfolioReturns: number[] = [];
    let rebalances = 0, holdingsSum = 0, cashPctSum = 0, turnover = 0, costs = 0, missing = 0, samples = 0;
    for (let t = config.warmup; t < calendar.length; t++) {
      const date = calendar[t];
      if (method !== "cash" && (t - config.warmup) % config.rebalanceEvery === 0) {
        const cutoff = calendar[Math.max(0, t - config.delayPeriods)];
        const visible = universe.map((s) => truncate(s, cutoff));
        const now = new Date(cutoff + "T23:59:59Z");
        const evaluations = visible.map((s) => evaluateStrategy(s, input.policy, now, input.weights ?? DEFAULT_WEIGHTS, { allowSimulated: true }));
        const plan = planAllocation({ strategies: visible, evaluations, accounts: input.accounts, customProviders: input.customProviders, policy: input.policy, planner: { ...input.planner, totalCapitalUsd: value }, method });
        const target = new Map(plan.allocations.map((a) => [a.strategyId, a.amountUsd]));
        let traded = 0;
        for (const id of new Set([...positions.keys(), ...target.keys()])) traded += Math.abs((target.get(id) ?? 0) - (positions.get(id) ?? 0));
        const cost = traded * config.rebalanceCostPct / 100;
        turnover += traded;
        costs += cost;
        positions = target;
        cash = value - [...target.values()].reduce((a, b) => a + b, 0) - cost;
        rebalances++;
      }
      const before = value;
      for (const [id, amt] of positions) {
        const r = netByStrategy.get(id)?.get(date);
        if (r === undefined) missing++;
        positions.set(id, amt * (1 + (r ?? 0)));
      }
      value = cash + [...positions.values()].reduce((a, b) => a + b, 0);
      holdingsSum += [...positions.values()].filter((v) => v > 0).length;
      cashPctSum += value > 0 ? cash / value : 1;
      samples++;
      portfolioReturns.push(before > 0 ? value / before - 1 : 0);
      equity.push({ date, value: Math.round(value * 100) / 100 });
    }
    const dates = calendar.slice(config.warmup);
    return {
      method,
      periods: dates.length,
      startDate: dates[0] ?? null,
      endDate: dates.at(-1) ?? null,
      rebalances,
      finalValueUsd: Math.round(value * 100) / 100,
      metrics: computeMetrics({ dates, returns: portfolioReturns, frequency: frequency ?? "daily" }),
      equity,
      avgHoldings: samples ? Math.round(holdingsSum / samples * 10) / 10 : 0,
      avgCashPct: samples ? Math.round(cashPctSum / samples * 1000) / 10 : 100,
      turnoverUsd: Math.round(turnover * 100) / 100,
      costsUsd: Math.round(costs * 100) / 100,
      missingDataPeriods: missing,
    };
  };

  return {
    config,
    frequency,
    universe: universe.map((s) => s.id),
    excluded,
    trainingPeriods: Math.min(config.warmup, calendar.length),
    evaluationPeriods,
    results: evaluationPeriods > 0 ? [...methods.map(run), run("cash")] : [],
    assumptions,
    limitations,
  };
}

// ---- Paper portfolios ---------------------------------------------------------

export function createPaperPortfolio(input: { name: string; method: AllocationMethod; allocations: { strategyId: string; amountUsd: number }[]; cashUsd: number; startDate: string; id: string; createdAt: string }): PaperPortfolio {
  return { id: input.id, name: input.name.slice(0, 80), createdAt: input.createdAt, startDate: input.startDate, method: input.method, positions: input.allocations.filter((a) => a.amountUsd > 0).map((a) => ({ strategyId: a.strategyId, amountUsd: a.amountUsd })), cashUsd: input.cashUsd };
}

/** Marks a paper portfolio to market using recorded net returns dated after its start date. */
export function valuePaperPortfolio(portfolio: PaperPortfolio, strategies: Strategy[]) {
  const byId = new Map(strategies.map((s) => [s.id, s]));
  const start = portfolio.positions.reduce((a, p) => a + p.amountUsd, 0) + portfolio.cashUsd;
  let current = portfolio.cashUsd;
  let lastDate: string | null = null;
  const lines = portfolio.positions.map((p) => {
    const s = byId.get(p.strategyId);
    const net = s ? netSeriesReturns(s) : null;
    let v = p.amountUsd, periods = 0;
    if (s?.series && net) {
      s.series.dates.forEach((d, i) => {
        if (d > portfolio.startDate) { v *= 1 + net[i]; periods++; if (!lastDate || d > lastDate) lastDate = d; }
      });
    }
    current += v;
    return { strategyId: p.strategyId, name: s?.name ?? "(removed strategy)", startUsd: p.amountUsd, valueUsd: Math.round(v * 100) / 100, periods, simulatedSource: s ? s.series?.source === "simulated" : false };
  });
  return { startUsd: Math.round(start * 100) / 100, valueUsd: Math.round(current * 100) / 100, changePct: start ? Math.round((current / start - 1) * 10000) / 100 : 0, asOf: lastDate, lines };
}
