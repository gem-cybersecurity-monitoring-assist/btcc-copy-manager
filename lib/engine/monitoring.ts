// Monitoring run: re-scores strategies, recalculates portfolio risk, raises/resolves alerts idempotently,
// records score history and an audit trail, and proposes a reallocation review when warranted.
// It runs when invoked (on dashboard load when due, or "Run review now"). There is no server-side
// scheduler: user data is protected by row-level security and the server holds no privileged key.

import { planAllocation } from "./allocation.ts";
import { holdingsFromAccounts, assessPortfolio, type PortfolioRisk } from "./risk.ts";
import { rankStrategies, type StrategyEvaluation } from "./scoring.ts";
import { appendAudit, ENGINE_LIMITS } from "./state.ts";
import type { Alert, EngineState } from "./types.ts";

export type MonitorOutcome = {
  state: EngineState;
  evaluations: StrategyEvaluation[];
  risk: PortfolioRisk;
  raised: Alert[];
  resolved: Alert[];
  reviewSuggested: boolean;
  summary: string;
};

export function isMonitorDue(state: EngineState, now: Date) {
  if (!state.monitor.lastRunAt) return true;
  return now.getTime() - Date.parse(state.monitor.lastRunAt) >= state.monitor.intervalHours * 3_600_000;
}

export function runMonitoring(state: EngineState, now: Date, trigger: "scheduled" | "manual"): MonitorOutcome {
  const at = now.toISOString();
  const evaluations = rankStrategies(state.strategies, state.policy, now, state.weights);
  const risk = assessPortfolio({ holdings: holdingsFromAccounts(state.providers), accounts: state.providers, strategies: state.strategies, evaluations, customProviders: state.customProviders, policy: state.policy, now, capitalBaseUsd: state.planner.totalCapitalUsd });

  const currentKeys = new Set(risk.alerts.map((a) => a.key));
  const openByKey = new Map(state.alerts.filter((a) => !a.resolvedAt).map((a) => [a.key, a]));
  const raised: Alert[] = [];
  for (const a of risk.alerts) {
    // Idempotent: an alert that is already open is not raised again (even if acknowledged).
    if (!openByKey.has(a.key)) raised.push({ ...a, createdAt: at, acknowledgedAt: null, resolvedAt: null });
  }
  const resolved: Alert[] = [];
  const alerts = state.alerts.map((a) => {
    if (!a.resolvedAt && !currentKeys.has(a.key)) {
      const r = { ...a, resolvedAt: at };
      resolved.push(r);
      return r;
    }
    return a;
  });
  // Keep open alerts; trim the oldest resolved ones first.
  let nextAlerts = [...alerts, ...raised];
  if (nextAlerts.length > ENGINE_LIMITS.alerts) {
    const open = nextAlerts.filter((a) => !a.resolvedAt);
    const closed = nextAlerts.filter((a) => a.resolvedAt).slice(-(ENGINE_LIMITS.alerts - open.length));
    nextAlerts = [...closed, ...open].slice(-ENGINE_LIMITS.alerts);
  }

  const lastScore = new Map<string, { at: string; score: number; eligible: boolean }>();
  for (const s of state.scoreHistory) lastScore.set(s.strategyId, s);
  const snapshots = evaluations
    .filter((e) => {
      const prev = lastScore.get(e.strategyId);
      return !prev || prev.score !== e.score || prev.eligible !== e.eligible || now.getTime() - Date.parse(prev.at) >= state.monitor.intervalHours * 3_600_000;
    })
    .map((e) => ({ at, strategyId: e.strategyId, score: e.score, eligible: e.eligible }));

  const heldIds = new Set(state.providers.filter((p) => p.allocatedUsd > 0 && p.selectedStrategyId).map((p) => p.selectedStrategyId!));
  const reviewTriggers = risk.alerts.filter((a) => a.severity === "critical" || a.kind === "held_strategy_ineligible" || a.kind.startsWith("deterioration_") || a.kind.endsWith("_concentration"));
  const reviewSuggested = reviewTriggers.length > 0;
  let review = "";
  if (reviewSuggested) {
    const plan = planAllocation({ strategies: state.strategies, evaluations, accounts: state.providers, customProviders: state.customProviders, policy: state.policy, planner: state.planner });
    const names = new Map(state.strategies.map((s) => [s.id, s.name]));
    const proposal = plan.allocations.map((a) => `${names.get(a.strategyId) ?? a.strategyId} $${a.amountUsd.toFixed(2)}`).join(", ") || "hold capital unallocated";
    const exits = [...heldIds].filter((id) => !plan.allocations.some((a) => a.strategyId === id)).map((id) => names.get(id) ?? id);
    review = ` Reallocation review suggested (${reviewTriggers.length} trigger(s)). Current policy would propose: ${proposal}.${exits.length ? ` Not in the proposal: ${exits.join(", ")}.` : ""} Nothing has been changed on any platform.`;
  }

  const eligible = evaluations.filter((e) => e.eligible).length;
  const summary = `${trigger === "manual" ? "Manual" : "Scheduled"} review at ${at}: ${evaluations.length} strategies scored (${eligible} eligible), ${risk.alerts.length} active condition(s), ${raised.length} new alert(s), ${resolved.length} resolved.${review}`;

  let next: EngineState = {
    ...state,
    alerts: nextAlerts,
    scoreHistory: [...state.scoreHistory, ...snapshots].slice(-ENGINE_LIMITS.scoreHistory),
    monitor: { ...state.monitor, lastRunAt: at, lastRunSummary: summary.slice(0, 2000) },
  };
  next = appendAudit(next, { at, actor: "engine", action: "monitor_run", detail: summary });
  for (const a of raised) next = appendAudit(next, { at, actor: "engine", action: "alert_raised", detail: `[${a.severity}] ${a.message}` });
  for (const a of resolved) next = appendAudit(next, { at, actor: "engine", action: "alert_resolved", detail: a.message });
  return { state: next, evaluations, risk, raised, resolved, reviewSuggested, summary };
}
