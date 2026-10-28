// Engine state defaults, validation, and audit helpers. Validation is strict: one malformed record
// rejects the whole engine payload so imports and cloud restores never partially overwrite data.

import { DEFAULT_WEIGHTS } from "./scoring.ts";
import { CAPABILITIES, PROVIDER_STATUSES, type Alert, type AuditEvent, type EngineState, type Evidence, type Observation, type PaperPortfolio, type PlannerSettings, type ProviderAccount, type ProviderDefinition, type ReturnSeries, type RiskPolicy, type ScoreSnapshot, type ScoringWeights, type Strategy } from "./types.ts";

export const ENGINE_LIMITS = { strategies: 60, seriesPoints: 400, totalPoints: 8_000, observationsPerStrategy: 10, providers: 30, alerts: 200, audit: 300, scoreHistory: 1500, paperPortfolios: 20 } as const;

export const DEFAULT_POLICY: RiskPolicy = {
  maxPerProviderPct: 40,
  maxPerStrategyPct: 35,
  maxClusterPct: 50,
  maxAssetPct: 60,
  maxStrategyDrawdownPct: 35,
  maxPortfolioDrawdownPct: 25,
  maxLeverage: 10,
  minHistoryPoints: 30,
  minConfidence: 0.45,
  maxProfitSharePct: 30,
  maxCostPct: 5,
  staleAfterHours: 168,
  correlationThreshold: 0.7,
  minScore: 45,
};

export const DEFAULT_PLANNER: PlannerSettings = { totalCapitalUsd: 30, reservePct: 10, maxPerProviderUsd: 10, method: "risk_adjusted", allowUnknownMinimum: false };

export function defaultEngineState(): EngineState {
  return {
    version: 1,
    weights: { ...DEFAULT_WEIGHTS },
    providers: [],
    customProviders: [],
    strategies: [],
    policy: { ...DEFAULT_POLICY },
    planner: { ...DEFAULT_PLANNER },
    alerts: [],
    audit: [],
    scoreHistory: [],
    paperPortfolios: [],
    monitor: { intervalHours: 24, lastRunAt: null, lastRunSummary: null },
  };
}

let counter = 0;
export function newId(prefix: string, now = new Date()) {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${now.getTime().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function appendAudit(state: EngineState, event: Omit<AuditEvent, "id">): EngineState {
  const entry: AuditEvent = { id: newId("audit", new Date(event.at)), ...event, detail: event.detail.slice(0, 1000) };
  return { ...state, audit: [...state.audit, entry].slice(-ENGINE_LIMITS.audit) };
}

const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * Keeps the serialized engine within a byte budget (the cloud workspace limit) by trimming, oldest first,
 * resolved alerts, then audit events, then score snapshots. Never drops strategies, providers, or open alerts.
 */
export function compactToBudget(state: EngineState, budgetBytes: number): { state: EngineState; ok: boolean; trimmed: number; bytes: number } {
  let next = state;
  let bytes = byteLength(next);
  let trimmed = 0;
  const steps: ((s: EngineState) => EngineState | null)[] = [
    (s) => { const i = s.alerts.findIndex((a) => a.resolvedAt); return i < 0 ? null : { ...s, alerts: s.alerts.filter((_, j) => j !== i) }; },
    (s) => (s.audit.length > 20 ? { ...s, audit: s.audit.slice(Math.ceil(s.audit.length * 0.1)) } : null),
    (s) => (s.scoreHistory.length > 20 ? { ...s, scoreHistory: s.scoreHistory.slice(Math.ceil(s.scoreHistory.length * 0.1)) } : null),
  ];
  for (const step of steps) {
    while (bytes > budgetBytes) {
      const candidate = step(next);
      if (!candidate) break;
      trimmed += 1;
      next = candidate;
      bytes = byteLength(next);
    }
  }
  return { state: next, ok: bytes <= budgetBytes, trimmed, bytes };
}

// ---- Validation -------------------------------------------------------------

type R = Record<string, unknown>;
const isRec = (v: unknown): v is R => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === "string" && v.length <= max;
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const nonNeg = (v: unknown): v is number => num(v) && v >= 0;
const iso = (v: unknown): v is string => str(v, 40) && !Number.isNaN(Date.parse(v));
const isoOrNull = (v: unknown) => v === null || iso(v);
const numOrNull = (v: unknown) => v === null || nonNeg(v);
const url = (v: unknown) => v === null || (str(v, 500) && /^https:\/\//i.test(v));
const strArr = (v: unknown, maxLen = 30, maxItem = 100): v is string[] => Array.isArray(v) && v.length <= maxLen && v.every((x) => str(x, maxItem));
const oneOf = <T extends string>(v: unknown, xs: readonly T[]): v is T => typeof v === "string" && (xs as readonly string[]).includes(v);

const EVIDENCE: Evidence[] = ["user_attested", "official_api", "system"];
const SOURCES = ["official_api", "provider_profile", "imported_csv", "user_entered", "simulated"] as const;

function validSeries(v: unknown): v is ReturnSeries {
  if (!isRec(v)) return false;
  if (!oneOf(v.frequency, ["daily", "weekly"] as const) || !oneOf(v.basis, ["gross", "net"] as const) || !oneOf(v.source, SOURCES) || !iso(v.collectedAt) || typeof v.verified !== "boolean") return false;
  if (!Array.isArray(v.dates) || !Array.isArray(v.returns) || v.dates.length !== v.returns.length || v.dates.length > ENGINE_LIMITS.seriesPoints) return false;
  for (let i = 0; i < v.dates.length; i++) {
    const d = v.dates[i], r = v.returns[i];
    if (!str(d, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(d) || (i > 0 && d <= (v.dates[i - 1] as string))) return false;
    if (!num(r) || r <= -1 || r > 100) return false;
  }
  return true;
}

function validObservation(v: unknown): v is Observation {
  if (!isRec(v) || !str(v.id, 80) || !str(v.strategyId, 80) || !oneOf(v.source, SOURCES) || !str(v.method, 200) || !iso(v.collectedAt)) return false;
  if (!num(v.confidence) || v.confidence < 0 || v.confidence > 1 || typeof v.verified !== "boolean" || !url(v.sourceUrl) || !isRec(v.values)) return false;
  const vals = v.values;
  const opt = (k: string, check: (x: unknown) => boolean) => vals[k] === undefined || check(vals[k]);
  return opt("roiPct", (x) => num(x) && Math.abs(x) < 1e6) && opt("maxDrawdownPct", (x) => num(x) && x >= 0 && x <= 100) && opt("winRatePct", (x) => num(x) && x >= 0 && x <= 100)
    && opt("trades", (x) => Number.isInteger(x) && (x as number) >= 0) && opt("periodDays", (x) => nonNeg(x)) && opt("followers", (x) => nonNeg(x)) && opt("aumUsd", (x) => nonNeg(x));
}

function validStrategy(v: unknown): v is Strategy {
  if (!isRec(v) || !str(v.id, 80) || !v.id || !str(v.providerId, 80) || !str(v.name, 120) || !v.name.trim() || !str(v.externalId, 120) || !url(v.profileUrl)) return false;
  if (!strArr(v.assets) || !str(v.style, 80) || !numOrNull(v.maxLeverage) || !(v.profitSharePct === null || (num(v.profitSharePct) && v.profitSharePct >= 0 && v.profitSharePct <= 100)) || !numOrNull(v.minCopyUsd) || !iso(v.createdAt)) return false;
  if (!(v.series === null || validSeries(v.series))) return false;
  return Array.isArray(v.observations) && v.observations.length <= ENGINE_LIMITS.observationsPerStrategy && v.observations.every(validObservation);
}

function validProviderDefinition(v: unknown): v is ProviderDefinition {
  if (!isRec(v) || !str(v.id, 80) || !/^custom-[a-z0-9-]+$/.test(v.id) || !str(v.name, 80) || !url(v.url) || !url(v.copyUrl) || v.builtIn !== false) return false;
  if (!oneOf(v.platformType, ["crypto_exchange", "mt5_broker", "strategy_marketplace", "other"] as const) || !strArr(v.markets) || !oneOf(v.integration, ["manual"] as const)) return false;
  // Custom providers may never claim a supported capability: there is no adapter behind them.
  if (!isRec(v.capabilities) || !CAPABILITIES.every((c) => oneOf((v.capabilities as R)[c], ["not_implemented", "not_available"] as const))) return false;
  return numOrNull(v.defaultMinAllocationUsd) && str(v.feeNotes, 500) && strArr(v.limitations, 10, 500) && strArr(v.activationSteps, 15, 500) && strArr(v.pauseSteps, 10, 500);
}

function validAccount(v: unknown): v is ProviderAccount {
  if (!isRec(v) || !str(v.providerId, 80) || !oneOf(v.status, PROVIDER_STATUSES) || !Array.isArray(v.history) || v.history.length > 100) return false;
  if (!v.history.every((h) => isRec(h) && oneOf(h.status, PROVIDER_STATUSES) && iso(h.at) && oneOf(h.evidence, EVIDENCE) && str(h.note, 500))) return false;
  // Only a real adapter can record API-verified evidence; nothing in a stored payload may claim it.
  if (v.history.some((h) => (h as R).evidence === "official_api")) return false;
  const cap = v.availableCapital;
  if (!(cap === null || (isRec(cap) && nonNeg(cap.amount) && str(cap.currency, 10) && iso(cap.observedAt) && oneOf(cap.evidence, ["user_attested", "system"] as const)))) return false;
  return nonNeg(v.allocatedUsd) && numOrNull(v.minAllocationUsd) && nonNeg(v.fixedCostUsd) && (v.selectedStrategyId === null || str(v.selectedStrategyId, 80)) && isoOrNull(v.lastSyncAt) && str(v.notes, 1000);
}

function validPolicy(v: unknown): v is RiskPolicy {
  if (!isRec(v)) return false;
  const pct = (k: string) => num(v[k]) && (v[k] as number) >= 0 && (v[k] as number) <= 100;
  return ["maxPerProviderPct", "maxPerStrategyPct", "maxClusterPct", "maxAssetPct", "maxStrategyDrawdownPct", "maxPortfolioDrawdownPct", "maxProfitSharePct", "maxCostPct", "minScore"].every(pct)
    && num(v.maxLeverage) && (v.maxLeverage as number) >= 1 && (v.maxLeverage as number) <= 500 && Number.isInteger(v.minHistoryPoints) && (v.minHistoryPoints as number) >= 0
    && num(v.minConfidence) && (v.minConfidence as number) >= 0 && (v.minConfidence as number) <= 1 && num(v.staleAfterHours) && (v.staleAfterHours as number) >= 1
    && num(v.correlationThreshold) && (v.correlationThreshold as number) > 0 && (v.correlationThreshold as number) <= 1;
}

function validPlanner(v: unknown): v is PlannerSettings {
  return isRec(v) && nonNeg(v.totalCapitalUsd) && (v.totalCapitalUsd as number) <= 1e9 && nonNeg(v.reservePct) && (v.reservePct as number) <= 100 && nonNeg(v.maxPerProviderUsd)
    && oneOf(v.method, ["equal", "risk_adjusted", "score_weighted"] as const) && typeof v.allowUnknownMinimum === "boolean";
}

function validWeights(v: unknown): v is ScoringWeights {
  return isRec(v) && ["netReturn", "drawdown", "riskAdjusted", "consistency", "history", "dataQuality"].every((k) => nonNeg(v[k]) && (v[k] as number) <= 100);
}

const validAlert = (v: unknown): v is Alert => isRec(v) && str(v.key, 200) && oneOf(v.severity, ["info", "warning", "critical"] as const) && str(v.kind, 80) && str(v.subject, 120) && str(v.message, 1000) && str(v.recommendation, 1500) && iso(v.createdAt) && isoOrNull(v.acknowledgedAt) && isoOrNull(v.resolvedAt);
const validAudit = (v: unknown): v is AuditEvent => isRec(v) && str(v.id, 80) && iso(v.at) && oneOf(v.actor, ["user", "engine"] as const) && str(v.action, 80) && str(v.detail, 1000);
const validSnapshot = (v: unknown): v is ScoreSnapshot => isRec(v) && iso(v.at) && str(v.strategyId, 80) && num(v.score) && typeof v.eligible === "boolean";
const validPaper = (v: unknown): v is PaperPortfolio => isRec(v) && str(v.id, 80) && str(v.name, 80) && iso(v.createdAt) && str(v.startDate, 10) && oneOf(v.method, ["equal", "risk_adjusted", "score_weighted"] as const)
  && Array.isArray(v.positions) && v.positions.length <= ENGINE_LIMITS.strategies && v.positions.every((p) => isRec(p) && str(p.strategyId, 80) && nonNeg(p.amountUsd)) && nonNeg(v.cashUsd);

export type EngineParse = { ok: true; value: EngineState } | { ok: false; error: string };

export function parseEngineState(input: unknown): EngineParse {
  if (!isRec(input) || input.version !== 1) return { ok: false, error: "Engine data must be version 1." };
  const fail = (what: string): EngineParse => ({ ok: false, error: `Engine ${what} is invalid.` });
  const arr = (k: string, max: number, check: (x: unknown) => boolean) => Array.isArray(input[k]) && (input[k] as unknown[]).length <= max && (input[k] as unknown[]).every(check);
  if (!arr("strategies", ENGINE_LIMITS.strategies, validStrategy)) return fail("strategy data");
  const strategies = input.strategies as Strategy[];
  if (new Set(strategies.map((s) => s.id)).size !== strategies.length) return fail("strategy list (duplicate ids)");
  if (strategies.reduce((a, s) => a + (s.series?.returns.length ?? 0), 0) > ENGINE_LIMITS.totalPoints) return { ok: false, error: `Engine data has more than ${ENGINE_LIMITS.totalPoints} return points in total.` };
  if (!arr("providers", ENGINE_LIMITS.providers, validAccount)) return fail("provider account data");
  if (!arr("customProviders", ENGINE_LIMITS.providers, validProviderDefinition)) return fail("custom provider data");
  if (!validPolicy(input.policy)) return fail("risk policy");
  if (!validPlanner(input.planner)) return fail("planner settings");
  if (!validWeights(input.weights)) return fail("scoring weights");
  if (!arr("alerts", ENGINE_LIMITS.alerts, validAlert)) return fail("alert list");
  if (!arr("audit", ENGINE_LIMITS.audit, validAudit)) return fail("audit log");
  if (!arr("scoreHistory", ENGINE_LIMITS.scoreHistory, validSnapshot)) return fail("score history");
  if (!arr("paperPortfolios", ENGINE_LIMITS.paperPortfolios, validPaper)) return fail("paper portfolios");
  const m = input.monitor;
  if (!isRec(m) || !num(m.intervalHours) || m.intervalHours < 1 || m.intervalHours > 24 * 30 || !isoOrNull(m.lastRunAt) || !(m.lastRunSummary === null || str(m.lastRunSummary, 2000))) return fail("monitor settings");
  return {
    ok: true,
    value: {
      version: 1,
      weights: input.weights as ScoringWeights,
      providers: input.providers as ProviderAccount[],
      customProviders: input.customProviders as ProviderDefinition[],
      strategies,
      policy: input.policy as RiskPolicy,
      planner: input.planner as PlannerSettings,
      alerts: input.alerts as Alert[],
      audit: input.audit as AuditEvent[],
      scoreHistory: input.scoreHistory as ScoreSnapshot[],
      paperPortfolios: input.paperPortfolios as PaperPortfolio[],
      monitor: { intervalHours: m.intervalHours as number, lastRunAt: (m.lastRunAt as string | null) ?? null, lastRunSummary: (m.lastRunSummary as string | null) ?? null },
    },
  };
}
