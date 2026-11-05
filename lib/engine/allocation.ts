// Small-capital allocation planner. Proposes amounts only: it never moves funds, and it is allowed to
// leave capital unallocated when candidates do not meet the user's requirements.

import { assetOverlap, correlation } from "./metrics.ts";
import { findProvider } from "./providers.ts";
import { netSeriesReturns, type StrategyEvaluation } from "./scoring.ts";
import type { AllocationMethod, PlannerSettings, ProviderAccount, ProviderDefinition, RiskPolicy, Strategy } from "./types.ts";

export type CorrelationPair = { a: string; b: string; correlation: number | null; overlap: number; assetOverlap: number; linked: boolean; reason: string };
export type ClusterAnalysis = { clusters: string[][]; clusterOf: Map<string, number>; pairs: CorrelationPair[] };

/** Groups strategies whose returns move together or that trade substantially the same assets. */
export function analyzeClusters(strategies: Strategy[], policy: RiskPolicy): ClusterAnalysis {
  const parent = new Map(strategies.map((s) => [s.id, s.id]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  const pairs: CorrelationPair[] = [];
  const nets = new Map(strategies.map((s) => [s.id, s.series ? { dates: s.series.dates, returns: netSeriesReturns(s)! } : null]));
  for (let i = 0; i < strategies.length; i++) {
    for (let j = i + 1; j < strategies.length; j++) {
      const a = strategies[i], b = strategies[j];
      const na = nets.get(a.id), nb = nets.get(b.id);
      const corr = na && nb ? correlation(na, nb) : { value: null, overlap: 0 };
      const overlap = assetOverlap(a.assets, b.assets);
      const byCorr = corr.value !== null && corr.value >= policy.correlationThreshold;
      const byAssets = corr.value === null && overlap >= 0.5;
      const linked = byCorr || byAssets;
      const reason = byCorr ? `Returns correlate at ${corr.value} over ${corr.overlap} shared periods.` : byAssets ? `No shared history to measure correlation, and ${Math.round(overlap * 100)}% of traded assets overlap.` : corr.value !== null ? `Correlation ${corr.value} (${corr.overlap} shared periods).` : "Not enough shared data.";
      pairs.push({ a: a.id, b: b.id, correlation: corr.value, overlap: corr.overlap, assetOverlap: Math.round(overlap * 100) / 100, linked, reason });
      if (linked) parent.set(find(a.id), find(b.id));
    }
  }
  const groups = new Map<string, string[]>();
  for (const s of strategies) groups.set(find(s.id), [...(groups.get(find(s.id)) ?? []), s.id]);
  const clusters = [...groups.values()];
  const clusterOf = new Map<string, number>();
  clusters.forEach((c, i) => c.forEach((id) => clusterOf.set(id, i)));
  return { clusters, clusterOf, pairs };
}

export type ProposedAllocation = { strategyId: string; providerId: string; amountUsd: number; weightPct: number; minimumUsd: number | null; estCostUsd: number; reasons: string[] };
export type RejectedCandidate = { strategyId: string; providerId: string; reasons: string[] };
export type AllocationPlan = {
  method: AllocationMethod;
  totalCapitalUsd: number;
  reserveUsd: number;
  investableUsd: number;
  allocatedUsd: number;
  unallocatedUsd: number;
  allocations: ProposedAllocation[];
  rejected: RejectedCandidate[];
  warnings: string[];
  stressLossUsd: number;
  estCostsUsd: number;
};

type Candidate = { strategy: Strategy; evaluation: StrategyEvaluation; provider: ProviderDefinition; account: ProviderAccount | null; minimum: number | null; fixedCost: number; weight: number; cluster: number; maxDd: number };

const cents = (x: number) => Math.floor(x * 100) / 100;

export function planAllocation(input: {
  strategies: Strategy[];
  evaluations: StrategyEvaluation[];
  accounts: ProviderAccount[];
  customProviders: ProviderDefinition[];
  policy: RiskPolicy;
  planner: PlannerSettings;
  method?: AllocationMethod;
}): AllocationPlan {
  const { policy, planner } = input;
  const method = input.method ?? planner.method;
  const total = Math.max(0, planner.totalCapitalUsd);
  const reserve = cents(total * Math.min(Math.max(planner.reservePct, 0), 100) / 100);
  const investable = cents(total - reserve);
  const rejected: RejectedCandidate[] = [];
  const warnings: string[] = [];
  const evalById = new Map(input.evaluations.map((e) => [e.strategyId, e]));
  const clusters = analyzeClusters(input.strategies, policy);
  let active: Candidate[] = [];

  for (const strategy of input.strategies) {
    const evaluation = evalById.get(strategy.id);
    const provider = findProvider(strategy.providerId, input.customProviders);
    const reasons: string[] = [];
    if (!evaluation) reasons.push("Not evaluated.");
    if (!provider) reasons.push("Provider is not in the registry.");
    if (evaluation && !evaluation.eligible) reasons.push(...evaluation.ineligibleReasons);
    const account = input.accounts.find((a) => a.providerId === strategy.providerId) ?? null;
    if (account && ["DISCONNECTED", "ERROR", "NOT_SUPPORTED"].includes(account.status)) reasons.push(`Provider status is ${account.status}.`);
    const minimums = [strategy.minCopyUsd, account?.minAllocationUsd ?? provider?.defaultMinAllocationUsd ?? null].filter((m): m is number => m !== null);
    const minimum = minimums.length ? Math.max(...minimums) : null;
    if (minimum === null && !planner.allowUnknownMinimum) reasons.push("Minimum copy amount is unknown. Enter it from the provider (or allow unknown minimums) before allocating.");
    const maxDd = evaluation?.net?.maxDrawdownPct ?? strategy.observations.at(-1)?.values.maxDrawdownPct ?? 100;
    let weight = 1;
    if (method === "risk_adjusted") {
      const vol = evaluation?.volatilityPct;
      if (vol && vol > 0) weight = 1 / vol;
      else reasons.push("Risk-adjusted method needs volatility from 30+ periods of history.");
    } else if (method === "score_weighted") weight = Math.max(evaluation?.score ?? 0, 1);
    if (reasons.length) { rejected.push({ strategyId: strategy.id, providerId: strategy.providerId, reasons }); continue; }
    active.push({ strategy, evaluation: evaluation!, provider: provider!, account, minimum, fixedCost: account?.fixedCostUsd ?? 0, weight, cluster: clusters.clusterOf.get(strategy.id) ?? -1, maxDd });
  }

  const strategyCap = total * policy.maxPerStrategyPct / 100;
  const providerCap = Math.min(planner.maxPerProviderUsd > 0 ? planner.maxPerProviderUsd : Infinity, total * policy.maxPerProviderPct / 100);
  const clusterCap = total * policy.maxClusterPct / 100;

  /**
   * Water-filling: each round offers the remaining capital to the unfrozen candidates by weight, then
   * scales offers down proportionally wherever a strategy, provider, or correlated-cluster cap would be
   * exceeded (so members of a shared cap are treated fairly), freezes capped candidates, and repeats.
   */
  const distribute = (cands: Candidate[]) => {
    const amount = new Map<string, number>(cands.map((c) => [c.strategy.id, 0]));
    const binding = new Map<string, string>();
    let free = [...cands];
    let remaining = investable;
    const groupUsed = (pick: (c: Candidate) => string | number, key: string | number) => cands.filter((c) => pick(c) === key).reduce((a, c) => a + amount.get(c.strategy.id)!, 0);
    for (let round = 0; round < 50 && free.length && remaining > 0.005; round++) {
      const weightSum = free.reduce((a, c) => a + c.weight, 0);
      const offer = new Map(free.map((c) => [c.strategy.id, remaining * c.weight / weightSum]));
      const limited = new Set<string>();
      for (const c of free) {
        const room = Math.max(0, strategyCap - amount.get(c.strategy.id)!);
        if (offer.get(c.strategy.id)! > room) { offer.set(c.strategy.id, room); limited.add(c.strategy.id); binding.set(c.strategy.id, `per-strategy cap ${policy.maxPerStrategyPct}%`); }
      }
      const scaleGroup = (pick: (c: Candidate) => string | number, capFor: (key: string | number) => number, label: string) => {
        for (const key of new Set(free.map(pick))) {
          const cap = capFor(key);
          const members = free.filter((c) => pick(c) === key);
          const wanted = members.reduce((a, c) => a + offer.get(c.strategy.id)!, 0);
          const room = Math.max(0, cap - groupUsed(pick, key));
          if (wanted > room + 1e-9) {
            const f = wanted > 0 ? room / wanted : 0;
            for (const c of members) { offer.set(c.strategy.id, offer.get(c.strategy.id)! * f); limited.add(c.strategy.id); binding.set(c.strategy.id, label); }
          }
        }
      };
      scaleGroup((c) => c.provider.id, () => providerCap, "per-provider cap");
      // Single-strategy clusters are already bounded by the per-strategy cap.
      scaleGroup((c) => c.cluster, (key) => (cands.filter((c) => c.cluster === key).length > 1 ? clusterCap : Infinity), `correlated-cluster cap ${policy.maxClusterPct}%`);
      let used = 0;
      for (const c of free) { amount.set(c.strategy.id, amount.get(c.strategy.id)! + offer.get(c.strategy.id)!); used += offer.get(c.strategy.id)!; }
      remaining -= used;
      free = free.filter((c) => !limited.has(c.strategy.id));
      if (used < 0.005) break;
    }
    return { amount, binding };
  };

  type Problem = { c: Candidate; reason: string };
  const findProblems = (cands: Candidate[], res: ReturnType<typeof distribute>): Problem[] => cands
    .map((c) => {
      const amt = res.amount.get(c.strategy.id)!;
      if (c.minimum !== null && amt + 1e-9 < c.minimum) return { c, reason: `Proposed $${amt.toFixed(2)} is below the $${c.minimum} minimum on ${c.provider.name}.` };
      if (amt > 0 && c.fixedCost / amt * 100 > policy.maxCostPct) return { c, reason: `Fixed costs $${c.fixedCost.toFixed(2)} would be ${(c.fixedCost / amt * 100).toFixed(1)}% of $${amt.toFixed(2)}, above your ${policy.maxCostPct}% limit.` };
      if (amt < 1) return { c, reason: `Proposed amount $${amt.toFixed(2)} is too small to be meaningful.` };
      return null;
    })
    .filter((p): p is Problem => p !== null)
    .sort((a, b) => a.c.evaluation.score - b.c.evaluation.score);

  // Remove the weakest candidate that cannot meet its minimum or cost limit, then redistribute. When the
  // shortfall comes from a shared correlated-cluster cap, drop the weakest member of that cluster instead.
  let result = distribute(active);
  const sizeRejected: { c: Candidate; reason: string }[] = [];
  for (let guard = 0; guard < 100; guard++) {
    const problems = findProblems(active, result);
    if (!problems.length) break;
    let drop = problems[0];
    const weakerMate = active.filter((x) => x !== drop.c && x.cluster === drop.c.cluster && x.evaluation.score < drop.c.evaluation.score).sort((a, b) => a.evaluation.score - b.evaluation.score)[0];
    if (weakerMate) drop = { c: weakerMate, reason: `Correlated with higher-scoring ${drop.c.strategy.name}; the shared cluster cap only leaves room for one allocation at the provider minimum.` };
    sizeRejected.push(drop);
    active = active.filter((c) => c !== drop.c);
    result = distribute(active);
  }
  // Second chance: re-try size/cost rejections from strongest to weakest now that the set has settled.
  for (const r of [...sizeRejected].sort((a, b) => b.c.evaluation.score - a.c.evaluation.score)) {
    const trial = [...active, r.c];
    const trialResult = distribute(trial);
    if (!findProblems(trial, trialResult).length) {
      active = trial;
      result = trialResult;
      sizeRejected.splice(sizeRejected.indexOf(r), 1);
    }
  }
  for (const r of sizeRejected) rejected.push({ strategyId: r.c.strategy.id, providerId: r.c.provider.id, reasons: [r.reason] });

  // Portfolio drawdown budget: if every holding repeated its worst historical drawdown at once,
  // the loss must stay within the user's limit. Scale down (to cash) rather than exceed it.
  const stress = () => active.reduce((a, c) => a + result.amount.get(c.strategy.id)! * c.maxDd / 100, 0);
  const budget = total * policy.maxPortfolioDrawdownPct / 100;
  if (stress() > budget && stress() > 0) {
    const factor = budget / stress();
    for (const c of active) result.amount.set(c.strategy.id, result.amount.get(c.strategy.id)! * factor);
    warnings.push(`Scaled allocations to ${Math.round(factor * 100)}% so a simultaneous repeat of each strategy's worst drawdown stays within your ${policy.maxPortfolioDrawdownPct}% portfolio limit.`);
    for (const c of [...active]) {
      const amt = result.amount.get(c.strategy.id)!;
      if (c.minimum !== null && amt + 1e-9 < c.minimum) {
        rejected.push({ strategyId: c.strategy.id, providerId: c.provider.id, reasons: [`After applying the portfolio drawdown limit, $${amt.toFixed(2)} is below the $${c.minimum} minimum.`] });
        active = active.filter((x) => x !== c);
        result.amount.set(c.strategy.id, 0);
      }
    }
  }

  const allocations: ProposedAllocation[] = active
    .map((c) => {
      const amountUsd = cents(result.amount.get(c.strategy.id)!);
      const reasons = [`Score ${c.evaluation.score} (${c.evaluation.grade}).`];
      if (method === "equal") reasons.push("Equal share of investable capital.");
      if (method === "risk_adjusted") reasons.push(`Sized inversely to volatility (${c.evaluation.volatilityPct}% annualized).`);
      if (method === "score_weighted") reasons.push("Sized in proportion to score.");
      const bind = result.binding.get(c.strategy.id);
      if (bind) reasons.push(`Limited by ${bind}.`);
      if (c.minimum === null) reasons.push("Minimum unknown — confirm on the provider before copying.");
      if (c.fixedCost) reasons.push(`Estimated fixed cost $${c.fixedCost.toFixed(2)}.`);
      return { strategyId: c.strategy.id, providerId: c.provider.id, amountUsd, weightPct: total ? Math.round(amountUsd / total * 1000) / 10 : 0, minimumUsd: c.minimum, estCostUsd: c.fixedCost, reasons };
    })
    .filter((a) => a.amountUsd > 0)
    .sort((a, b) => b.amountUsd - a.amountUsd);

  const allocated = cents(allocations.reduce((a, x) => a + x.amountUsd, 0));
  const unallocated = cents(investable - allocated);
  if (!allocations.length && input.strategies.length) warnings.push("No candidate met your requirements. Holding all capital unallocated is the recommendation.");
  else if (unallocated > 0.01) warnings.push(`$${unallocated.toFixed(2)} stays unallocated because caps, minimums, or the drawdown budget limit further allocation.`);
  for (const cluster of clusters.clusters) {
    const held = allocations.filter((a) => cluster.includes(a.strategyId));
    if (held.length > 1) warnings.push(`${held.length} allocations share a correlated cluster; they are capped together at ${policy.maxClusterPct}% because they behave like one position.`);
  }

  return {
    method,
    totalCapitalUsd: total,
    reserveUsd: reserve,
    investableUsd: investable,
    allocatedUsd: allocated,
    unallocatedUsd: unallocated,
    allocations,
    rejected,
    warnings,
    stressLossUsd: cents(allocations.reduce((a, x) => a + x.amountUsd * (active.find((c) => c.strategy.id === x.strategyId)?.maxDd ?? 100) / 100, 0)),
    estCostsUsd: cents(allocations.reduce((a, x) => a + x.estCostUsd, 0)),
  };
}
