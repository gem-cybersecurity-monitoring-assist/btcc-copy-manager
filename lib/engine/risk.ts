// Portfolio-level risk engine: exposures across providers, strategies, correlated clusters and assets,
// behaviour-change detection, and alerts with proportionate, honest recommendations.

import { analyzeClusters } from "./allocation.ts";
import { computeMetrics, mean, splitRecent, stdev } from "./metrics.ts";
import { effectiveStatus, findProvider } from "./providers.ts";
import { netSeriesReturns, type StrategyEvaluation } from "./scoring.ts";
import type { Alert, AlertSeverity, ProviderAccount, ProviderDefinition, RiskPolicy, Strategy } from "./types.ts";

export const STOP_COPY_NOTE = "Stopping or pausing copy trading on a platform usually stops new copied trades but may leave existing copied positions open. Check open positions on the platform and close them there if you want to exit.";

export type Holding = { providerId: string; strategyId: string | null; amountUsd: number };
export type Exposure = { key: string; label: string; amountUsd: number; pct: number; limitPct: number; breached: boolean };
export type PortfolioRisk = {
  totalUsd: number;
  byProvider: Exposure[];
  byStrategy: Exposure[];
  byCluster: Exposure[];
  byAsset: Exposure[];
  stressLossUsd: number;
  stressLossPct: number;
  alerts: Omit<Alert, "createdAt" | "acknowledgedAt" | "resolvedAt">[];
};

export type Deterioration = { code: string; message: string };

/** Compares the recent part of a return series with its own earlier baseline. */
export function detectDeterioration(returns: number[], frequency: "daily" | "weekly"): Deterioration[] {
  const split = splitRecent(returns);
  if (!split) return [];
  const out: Deterioration[] = [];
  const base = computeMetrics({ dates: [], returns: split.baseline, frequency });
  const recent = computeMetrics({ dates: [], returns: split.recent, frequency });
  if (recent.maxDrawdownPct > Math.max(base.maxDrawdownPct, 1) * 1.2 && recent.maxDrawdownPct > 5) {
    out.push({ code: "drawdown_beyond_history", message: `Recent drawdown ${recent.maxDrawdownPct}% exceeds the worst drawdown in the earlier record (${base.maxDrawdownPct}%).` });
  }
  const bv = stdev(split.baseline), rv = stdev(split.recent);
  if (bv > 0 && rv > bv * 2) out.push({ code: "volatility_jump", message: `Recent volatility is ${(rv / bv).toFixed(1)}× the earlier level — leverage or strategy may have changed.` });
  const se = bv / Math.sqrt(split.recent.length);
  if (se > 0) {
    const z = (mean(split.recent) - mean(split.baseline)) / se;
    if (z < -2) out.push({ code: "returns_below_baseline", message: `Recent average return is significantly below its own history (z = ${z.toFixed(1)}).` });
  }
  return out;
}

function exposures(map: Map<string, { label: string; amount: number }>, total: number, limitPct: number): Exposure[] {
  return [...map.entries()]
    .map(([key, v]) => ({ key, label: v.label, amountUsd: Math.round(v.amount * 100) / 100, pct: total ? Math.round(v.amount / total * 1000) / 10 : 0, limitPct, breached: total > 0 && v.amount / total * 100 > limitPct + 1e-9 }))
    .sort((a, b) => b.amountUsd - a.amountUsd);
}

export function holdingsFromAccounts(accounts: ProviderAccount[]): Holding[] {
  return accounts.filter((a) => a.allocatedUsd > 0).map((a) => ({ providerId: a.providerId, strategyId: a.selectedStrategyId, amountUsd: a.allocatedUsd }));
}

export function assessPortfolio(input: {
  holdings: Holding[];
  accounts: ProviderAccount[];
  strategies: Strategy[];
  evaluations: StrategyEvaluation[];
  customProviders: ProviderDefinition[];
  policy: RiskPolicy;
  now: Date;
  /** Capital base for percentage limits. Defaults to the sum of holdings. */
  capitalBaseUsd?: number;
}): PortfolioRisk {
  const { policy, holdings } = input;
  const totalHeld = holdings.reduce((a, h) => a + h.amountUsd, 0);
  const base = input.capitalBaseUsd && input.capitalBaseUsd > 0 ? Math.max(input.capitalBaseUsd, totalHeld) : totalHeld;
  const strategyById = new Map(input.strategies.map((s) => [s.id, s]));
  const evalById = new Map(input.evaluations.map((e) => [e.strategyId, e]));
  const providerName = (id: string) => findProvider(id, input.customProviders)?.name ?? id;
  const alerts: PortfolioRisk["alerts"] = [];
  const add = (severity: AlertSeverity, kind: string, subject: string, message: string, recommendation: string) =>
    alerts.push({ key: `${kind}:${subject}`, severity, kind, subject, message, recommendation });

  const byProvider = new Map<string, { label: string; amount: number }>();
  const byStrategy = new Map<string, { label: string; amount: number }>();
  const byAsset = new Map<string, { label: string; amount: number }>();
  for (const h of holdings) {
    byProvider.set(h.providerId, { label: providerName(h.providerId), amount: (byProvider.get(h.providerId)?.amount ?? 0) + h.amountUsd });
    const s = h.strategyId ? strategyById.get(h.strategyId) : undefined;
    const sKey = s?.id ?? `${h.providerId}:unassigned`;
    byStrategy.set(sKey, { label: s ? `${s.name} (${providerName(s.providerId)})` : `Unassigned on ${providerName(h.providerId)}`, amount: (byStrategy.get(sKey)?.amount ?? 0) + h.amountUsd });
    const assets = s?.assets.length ? s.assets : ["UNKNOWN"];
    for (const a of assets) {
      const k = a.trim().toUpperCase();
      byAsset.set(k, { label: k === "UNKNOWN" ? "Unknown assets" : k, amount: (byAsset.get(k)?.amount ?? 0) + h.amountUsd / assets.length });
    }
  }

  const heldStrategies = holdings.map((h) => (h.strategyId ? strategyById.get(h.strategyId) : undefined)).filter((s): s is Strategy => Boolean(s));
  const clusters = analyzeClusters([...new Map(heldStrategies.map((s) => [s.id, s])).values()], policy);
  const byCluster = new Map<string, { label: string; amount: number }>();
  clusters.clusters.forEach((ids, i) => {
    const amount = holdings.filter((h) => h.strategyId && ids.includes(h.strategyId)).reduce((a, h) => a + h.amountUsd, 0);
    if (ids.length > 1) byCluster.set(`cluster-${i}`, { label: ids.map((id) => strategyById.get(id)?.name ?? id).join(" + "), amount });
  });

  const result: PortfolioRisk = {
    totalUsd: Math.round(totalHeld * 100) / 100,
    byProvider: exposures(byProvider, base, policy.maxPerProviderPct),
    byStrategy: exposures(byStrategy, base, policy.maxPerStrategyPct),
    byCluster: exposures(byCluster, base, policy.maxClusterPct),
    byAsset: exposures(byAsset, base, policy.maxAssetPct),
    stressLossUsd: 0,
    stressLossPct: 0,
    alerts,
  };

  const pauseHint = (providerId: string) => {
    const p = findProvider(providerId, input.customProviders);
    return p ? ` On ${p.name}: ${p.pauseSteps[0]} ${STOP_COPY_NOTE}` : ` ${STOP_COPY_NOTE}`;
  };

  for (const e of result.byProvider.filter((x) => x.breached)) add("warning", "provider_concentration", e.key, `${e.label} holds ${e.pct}% of capital (limit ${e.limitPct}%).`, `Reduce the copy amount on ${e.label} or raise capital elsewhere before adding more here.`);
  for (const e of result.byStrategy.filter((x) => x.breached)) add("warning", "strategy_concentration", e.key, `${e.label} is ${e.pct}% of capital (limit ${e.limitPct}%).`, "Lower the maximum copy amount for this trader on the platform.");
  for (const e of result.byCluster.filter((x) => x.breached)) add("warning", "cluster_concentration", e.key, `Correlated strategies ${e.label} together hold ${e.pct}% (limit ${e.limitPct}%). They sit on different accounts but behave like one position.`, "Reduce one of these allocations; diversification across platforms does not help when strategies move together.");
  for (const e of result.byAsset.filter((x) => x.breached && x.key !== "UNKNOWN")) add("warning", "asset_concentration", e.key, `About ${e.pct}% of capital is exposed to ${e.label} across providers (limit ${e.limitPct}%).`, "Prefer strategies trading different markets for new allocations.");
  const unknownAssets = result.byAsset.find((x) => x.key === "UNKNOWN");
  if (unknownAssets && unknownAssets.amountUsd > 0) add("info", "unknown_assets", "assets", `$${unknownAssets.amountUsd} is held in strategies with no recorded assets, so shared exposure cannot be checked.`, "Record the markets each strategy trades.");

  let stress = 0;
  for (const h of holdings) {
    const s = h.strategyId ? strategyById.get(h.strategyId) : undefined;
    const ev = s ? evalById.get(s.id) : undefined;
    const name = s?.name ?? `unassigned allocation on ${providerName(h.providerId)}`;
    const worst = ev?.net?.maxDrawdownPct ?? s?.observations.at(-1)?.values.maxDrawdownPct ?? 100;
    stress += h.amountUsd * worst / 100;
    if (!s) { add("warning", "unassigned_allocation", h.providerId, `$${h.amountUsd} on ${providerName(h.providerId)} is not linked to a recorded strategy, so its risk is unknown.`, "Select the trader you copy on this platform."); continue; }
    if (ev && !ev.eligible) add("warning", "held_strategy_ineligible", s.id, `${name} no longer meets your policy: ${ev.ineligibleReasons.join(" ")}`, `Review this allocation. If you decide to exit, pause copying on the platform.${pauseHint(s.providerId)}`);
    if (ev?.net && ev.net.currentDrawdownPct > policy.maxStrategyDrawdownPct) add("critical", "strategy_drawdown", s.id, `${name} is ${ev.net.currentDrawdownPct}% below its peak (limit ${policy.maxStrategyDrawdownPct}%).`, `Consider pausing copying on the platform.${pauseHint(s.providerId)}`);
    if (s.maxLeverage !== null && s.maxLeverage > policy.maxLeverage) add("critical", "leverage", s.id, `${name} uses up to ${s.maxLeverage}x leverage (limit ${policy.maxLeverage}x).`, `Lower the copy leverage on the platform if it allows, or pause.${pauseHint(s.providerId)}`);
    const net = netSeriesReturns(s);
    if (net && s.series) for (const d of detectDeterioration(net, s.series.frequency)) add("warning", `deterioration_${d.code}`, s.id, `${name}: ${d.message}`, `Review whether the strategy has changed before adding capital; reduce or pause if the change persists.${pauseHint(s.providerId)}`);
    if (ev?.flags.some((f) => f.code === "stale_series" || f.code === "stale_observation")) add("warning", "stale_strategy_data", s.id, `Performance data for ${name} is out of date.`, "Refresh the trader's figures from the platform.");
  }
  result.stressLossUsd = Math.round(stress * 100) / 100;
  result.stressLossPct = base ? Math.round(stress / base * 1000) / 10 : 0;
  if (base > 0 && stress / base * 100 > policy.maxPortfolioDrawdownPct) add("critical", "portfolio_drawdown", "portfolio", `If every holding repeated its worst recorded drawdown at once, the loss would be $${result.stressLossUsd} (${result.stressLossPct}%), above your ${policy.maxPortfolioDrawdownPct}% limit.`, "Reduce the largest high-drawdown allocations until the stress loss is within the limit.");

  for (const a of input.accounts) {
    const status = effectiveStatus(a, input.now, policy.staleAfterHours);
    if (status === "DATA_STALE") add("warning", "provider_data_stale", a.providerId, `${providerName(a.providerId)} has not been updated in over ${policy.staleAfterHours} hours.`, "Open the platform and record current balances and copy status.");
    if (a.status === "ERROR") add("critical", "provider_error", a.providerId, `${providerName(a.providerId)} is in an error state.`, "Check the platform directly; do not rely on its figures in GEM until resolved.");
  }
  return result;
}
