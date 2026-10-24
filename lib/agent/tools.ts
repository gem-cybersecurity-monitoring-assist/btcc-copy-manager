// Tools for the in-app GEM agent. Framework-free: the server route sends AGENT_TOOLS to Claude, and the
// browser runs executeAgentTool() against the user's own workspace. Read tools return data immediately;
// write tools return a *proposed* engine state plus a plain-language summary, which is applied only after
// the user clicks Approve. No tool can move money, contact an exchange, or claim a verified status.

import { planAllocation } from "../engine/allocation.ts";
import { runBacktest } from "../engine/backtest.ts";
import { runMonitoring } from "../engine/monitoring.ts";
import { allProviders, findProvider, newProviderAccount, STATUS_LABELS, transitionStatus } from "../engine/providers.ts";
import { parseSeriesCsv } from "../engine/quality.ts";
import { assessPortfolio, holdingsFromAccounts } from "../engine/risk.ts";
import { rankStrategies } from "../engine/scoring.ts";
import { ENGINE_LIMITS, newId, parseEngineState } from "../engine/state.ts";
import { PROVIDER_STATUSES, type AllocationMethod, type EngineState, type ProviderStatus, type Strategy } from "../engine/types.ts";

type JsonSchema = Record<string, unknown>;
export type AgentToolDef = { name: string; description: string; input_schema: JsonSchema; strict: true };

const num = { type: ["number", "null"] };
const str = (maxLength = 200) => ({ type: ["string", "null"], maxLength });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const METHODS: AllocationMethod[] = ["equal", "risk_adjusted", "score_weighted"];
const SETTABLE_STATUSES: ProviderStatus[] = PROVIDER_STATUSES.filter((s) => s !== "DATA_STALE");

export const WRITE_TOOLS = new Set(["add_strategy", "update_plan_settings", "update_risk_policy", "record_provider_update", "run_risk_review"]);

export const AGENT_TOOLS: AgentToolDef[] = [
  { name: "get_workspace_overview", strict: true, input_schema: obj({}),
    description: "Summary of the user's GEM workspace: plan settings, risk policy, tracked providers with statuses and recorded allocations, every recorded strategy with its score and eligibility, and open alerts. Call this first in most conversations." },
  { name: "get_strategy_details", strict: true, input_schema: obj({ strategy_id: { type: "string", maxLength: 80 } }),
    description: "Full evaluation of one recorded strategy: score breakdown, net/gross metrics, data-quality flags, ineligibility reasons, missing data, and what could invalidate the ranking." },
  { name: "propose_allocation", strict: true,
    input_schema: obj({ total_capital_usd: num, method: { type: ["string", "null"], enum: [...METHODS, null] }, include_simulated: { type: "boolean" } }),
    description: "Compute an allocation proposal (read-only; nothing is saved or moved). Defaults to the saved plan settings when total_capital_usd or method is null. include_simulated=true is for demonstrations only and must be labelled as simulated to the user." },
  { name: "get_risk_report", strict: true, input_schema: obj({}),
    description: "Portfolio-level risk from the allocations the user recorded: exposure by provider, strategy, asset and correlated cluster, stress loss, and current alert conditions with recommendations." },
  { name: "run_backtest", strict: true, input_schema: obj({}),
    description: "Run the walk-forward backtest over recorded return histories (includes simulated data if present) comparing equal, risk-adjusted, score-weighted and cash. Read-only simulation; results are not earnings." },
  { name: "add_strategy", strict: true,
    input_schema: obj({
      provider_id: { type: "string", maxLength: 80 }, name: { type: "string", maxLength: 120 },
      assets: { type: "array", items: { type: "string", maxLength: 30 }, maxItems: 20 },
      style: str(80), max_leverage: num, profit_share_pct: num, min_copy_usd: num, profile_url: str(500),
      summary: obj({ roi_pct: num, period_days: num, max_drawdown_pct: num, win_rate_pct: num, trades: num }),
      summary_source: { type: "string", enum: ["provider_profile", "user_entered"] },
      history_csv: str(60000), history_basis: { type: "string", enum: ["gross", "net"] },
    }),
    description: "WRITE (requires the user's approval): record a trader/strategy the user is considering, using figures the USER provided (never invent numbers). history_csv uses a header of date,return_pct or date,equity with YYYY-MM-DD dates oldest first. Use null for anything the user did not give." },
  { name: "update_plan_settings", strict: true,
    input_schema: obj({ total_capital_usd: num, reserve_pct: num, max_per_provider_usd: num, method: { type: ["string", "null"], enum: [...METHODS, null] } }),
    description: "WRITE (requires approval): change saved plan settings. Null leaves a field unchanged." },
  { name: "update_risk_policy", strict: true,
    input_schema: obj({ max_leverage: num, max_strategy_drawdown_pct: num, max_portfolio_drawdown_pct: num, max_per_provider_pct: num, max_per_strategy_pct: num, min_score: num }),
    description: "WRITE (requires approval): change risk limits. Null leaves a field unchanged. Explain the effect before proposing looser limits." },
  { name: "record_provider_update", strict: true,
    input_schema: obj({
      provider_id: { type: "string", maxLength: 80 },
      new_status: { type: ["string", "null"], enum: [...SETTABLE_STATUSES, null] },
      evidence_note: { type: "string", maxLength: 500 }, strategy_id: str(80), allocated_usd: num, min_allocation_usd: num,
    }),
    description: "WRITE (requires approval): record what the USER says they did or saw on an exchange (tracks the provider if needed). Status changes must follow the allowed path and the evidence_note must quote what the user reported; never record a status the user did not confirm. Selecting a trader is not activation." },
  { name: "run_risk_review", strict: true, input_schema: obj({}),
    description: "WRITE (requires approval): run the monitoring review now, which records new/resolved alerts, score history, and an audit entry. Changes nothing on any exchange." },
];

export type ToolOutcome =
  | { kind: "read"; output: unknown }
  | { kind: "write"; summary: string[]; next: EngineState; output: unknown }
  | { kind: "error"; message: string };

type Ctx = { engine: EngineState; now: Date };
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const r2 = (x: number | null | undefined) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);

function validated(next: EngineState): ToolOutcome | EngineState {
  const parsed = parseEngineState(next);
  return parsed.ok ? parsed.value : { kind: "error", message: `The change would make the workspace invalid: ${parsed.error}` };
}

export function executeAgentTool(name: string, rawInput: unknown, { engine, now }: Ctx): ToolOutcome {
  const input = isRec(rawInput) ? rawInput : {};
  const evaluations = rankStrategies(engine.strategies, engine.policy, now, engine.weights);
  const names = new Map(engine.strategies.map((x) => [x.id, x.name]));
  try {
    switch (name) {
      case "get_workspace_overview": {
        return { kind: "read", output: {
          plan: engine.planner,
          risk_policy: engine.policy,
          providers_available: allProviders(engine.customProviders).map((p) => ({ id: p.id, name: p.name, integration: p.integration, copy_url: p.copyUrl })),
          tracked_providers: engine.providers.map((a) => ({ provider_id: a.providerId, status: STATUS_LABELS[a.status], allocated_usd: a.allocatedUsd, min_allocation_usd: a.minAllocationUsd, selected_strategy: a.selectedStrategyId ? names.get(a.selectedStrategyId) ?? a.selectedStrategyId : null, last_update: a.lastSyncAt, evidence: "user-confirmed, not verified by GEM" })),
          strategies: evaluations.map((e) => ({ id: e.strategyId, name: names.get(e.strategyId), provider_id: engine.strategies.find((x) => x.id === e.strategyId)?.providerId, score: e.score, grade: e.grade, eligible: e.eligible, simulated: e.simulated, top_reason: e.ineligibleReasons[0] ?? null, net_annualized_pct: e.net?.annualizedReturnPct ?? null, max_drawdown_pct: e.net?.maxDrawdownPct ?? null })),
          open_alerts: engine.alerts.filter((a) => !a.resolvedAt).map((a) => ({ severity: a.severity, message: a.message, recommendation: a.recommendation })),
          last_review: engine.monitor.lastRunAt,
        } };
      }
      case "get_strategy_details": {
        const e = evaluations.find((x) => x.strategyId === s(input.strategy_id));
        if (!e) return { kind: "error", message: "No strategy with that id. Call get_workspace_overview for ids." };
        return { kind: "read", output: { name: names.get(e.strategyId), score: e.score, grade: e.grade, eligible: e.eligible, simulated: e.simulated, components: e.components, penalties: e.penalties, ineligible_reasons: e.ineligibleReasons, missing: e.missing, flags: e.flags.map((f) => f.message), invalidators: e.invalidators, net_metrics: e.net, gross_metrics: e.gross } };
      }
      case "propose_allocation": {
        const method = METHODS.includes(input.method as AllocationMethod) ? (input.method as AllocationMethod) : engine.planner.method;
        const total = n(input.total_capital_usd);
        const evals = input.include_simulated === true ? rankStrategies(engine.strategies, engine.policy, now, engine.weights, { allowSimulated: true }) : evaluations;
        const plan = planAllocation({ strategies: engine.strategies, evaluations: evals, accounts: engine.providers, customProviders: engine.customProviders, policy: engine.policy, planner: { ...engine.planner, totalCapitalUsd: total !== null && total >= 0 ? total : engine.planner.totalCapitalUsd }, method });
        return { kind: "read", output: { simulated_data_included: input.include_simulated === true, ...plan, allocations: plan.allocations.map((a) => ({ ...a, strategy: names.get(a.strategyId), provider: findProvider(a.providerId, engine.customProviders)?.name })), rejected: plan.rejected.map((x) => ({ strategy: names.get(x.strategyId), reasons: x.reasons })), note: "Proposal only. GEM moves no money; the user sets amounts on each exchange." } };
      }
      case "get_risk_report": {
        const risk = assessPortfolio({ holdings: holdingsFromAccounts(engine.providers), accounts: engine.providers, strategies: engine.strategies, evaluations, customProviders: engine.customProviders, policy: engine.policy, now, capitalBaseUsd: engine.planner.totalCapitalUsd });
        return { kind: "read", output: risk };
      }
      case "run_backtest": {
        const report = runBacktest({ strategies: engine.strategies, accounts: engine.providers, customProviders: engine.customProviders, policy: engine.policy, planner: engine.planner, weights: engine.weights });
        return { kind: "read", output: { ...report, results: report.results.map((x) => ({ method: x.method, final_value_usd: x.finalValueUsd, total_return_pct: x.metrics.totalReturnPct, max_drawdown_pct: x.metrics.maxDrawdownPct, sharpe: x.metrics.sharpe, rebalances: x.rebalances, avg_cash_pct: x.avgCashPct })) } };
      }
      case "add_strategy": {
        const providerId = s(input.provider_id);
        if (!findProvider(providerId, engine.customProviders)) return { kind: "error", message: `Unknown provider "${providerId}". Use an id from providers_available.` };
        const nameText = s(input.name);
        if (!nameText) return { kind: "error", message: "A strategy name is required." };
        if (engine.strategies.length >= ENGINE_LIMITS.strategies) return { kind: "error", message: "Strategy limit reached." };
        const at = now.toISOString();
        const id = newId("strat", now);
        const summary = isRec(input.summary) ? input.summary : {};
        const values: Record<string, number> = {};
        for (const [k, key] of [["roi_pct", "roiPct"], ["period_days", "periodDays"], ["max_drawdown_pct", "maxDrawdownPct"], ["win_rate_pct", "winRatePct"], ["trades", "trades"]] as const) {
          const v = n(summary[k]);
          if (v !== null) values[key] = key === "trades" ? Math.round(v) : v;
        }
        let series: Strategy["series"] = null;
        const notes: string[] = [];
        const csv = s(input.history_csv);
        if (csv) {
          const parsed = parseSeriesCsv(csv, { source: "imported_csv", collectedAt: at, basis: input.history_basis === "net" ? "net" : "gross", maxPoints: ENGINE_LIMITS.seriesPoints });
          if (!parsed.ok) return { kind: "error", message: `History CSV rejected: ${parsed.error}` };
          series = parsed.series;
          notes.push(...parsed.warnings);
        }
        const source = input.summary_source === "user_entered" ? "user_entered" : "provider_profile";
        const strategy: Strategy = {
          id, providerId, name: nameText.slice(0, 120), externalId: "", profileUrl: s(input.profile_url).startsWith("https://") ? s(input.profile_url) : null,
          assets: Array.isArray(input.assets) ? input.assets.map((a) => s(a).toUpperCase()).filter(Boolean).slice(0, 20) : [], style: s(input.style).slice(0, 80),
          maxLeverage: n(input.max_leverage), profitSharePct: n(input.profit_share_pct), minCopyUsd: n(input.min_copy_usd), series, createdAt: at,
          observations: Object.keys(values).length ? [{ id: newId("obs", now), strategyId: id, source, method: "Provided by the user through the GEM agent", collectedAt: at, confidence: source === "provider_profile" ? 0.7 : 0.5, verified: false, sourceUrl: null, values }] : [],
        };
        const next = validated({ ...engine, strategies: [...engine.strategies, strategy] });
        if ("kind" in next) return next;
        const provider = findProvider(providerId, engine.customProviders)!.name;
        return { kind: "write", next, output: { strategy_id: id, warnings: notes },
          summary: [`Add strategy "${strategy.name}" on ${provider}`, strategy.assets.length ? `Assets: ${strategy.assets.join(", ")}` : "Assets: not given", `Leverage ${strategy.maxLeverage ?? "unknown"}x · profit share ${strategy.profitSharePct ?? "unknown"}% · minimum ${strategy.minCopyUsd === null ? "unknown" : "$" + strategy.minCopyUsd}`, series ? `Return history: ${series.returns.length} ${series.frequency} periods (${series.basis})` : "No return history (cannot be recommended until added)", ...notes] };
      }
      case "update_plan_settings": {
        const p = { ...engine.planner };
        const changes: string[] = [];
        const total = n(input.total_capital_usd), reserve = n(input.reserve_pct), perProvider = n(input.max_per_provider_usd);
        if (total !== null) { p.totalCapitalUsd = total; changes.push(`Total capital → $${total}`); }
        if (reserve !== null) { p.reservePct = reserve; changes.push(`Cash reserve → ${reserve}%`); }
        if (perProvider !== null) { p.maxPerProviderUsd = perProvider; changes.push(`Max per provider → $${perProvider}`); }
        if (METHODS.includes(input.method as AllocationMethod)) { p.method = input.method as AllocationMethod; changes.push(`Method → ${p.method.replace("_", " ")}`); }
        if (!changes.length) return { kind: "error", message: "No settings to change." };
        const next = validated({ ...engine, planner: p });
        return "kind" in next ? next : { kind: "write", next, summary: changes, output: { planner: p } };
      }
      case "update_risk_policy": {
        const pol = { ...engine.policy };
        const changes: string[] = [];
        const map: [string, keyof typeof pol, string][] = [["max_leverage", "maxLeverage", "Max leverage"], ["max_strategy_drawdown_pct", "maxStrategyDrawdownPct", "Max strategy drawdown %"], ["max_portfolio_drawdown_pct", "maxPortfolioDrawdownPct", "Max portfolio stress loss %"], ["max_per_provider_pct", "maxPerProviderPct", "Max per provider %"], ["max_per_strategy_pct", "maxPerStrategyPct", "Max per strategy %"], ["min_score", "minScore", "Minimum score"]];
        for (const [k, key, label] of map) {
          const v = n(input[k]);
          if (v !== null) { changes.push(`${label}: ${pol[key]} → ${v}`); Object.assign(pol, { [key]: v }); }
        }
        if (!changes.length) return { kind: "error", message: "No limits to change." };
        const next = validated({ ...engine, policy: pol });
        return "kind" in next ? next : { kind: "write", next, summary: changes, output: { policy: pol } };
      }
      case "record_provider_update": {
        const providerId = s(input.provider_id);
        const def = findProvider(providerId, engine.customProviders);
        if (!def) return { kind: "error", message: `Unknown provider "${providerId}".` };
        const at = now.toISOString();
        const note = s(input.evidence_note);
        const summary: string[] = [];
        let account = engine.providers.find((a) => a.providerId === providerId);
        let providers = engine.providers;
        if (!account) { account = newProviderAccount(def, at); providers = [...providers, account]; summary.push(`Start tracking ${def.name}`); }
        const status = SETTABLE_STATUSES.includes(input.new_status as ProviderStatus) ? (input.new_status as ProviderStatus) : null;
        if (status && status !== account.status) {
          const t = transitionStatus(account, status, { at, evidence: "user_attested", note, strategyId: s(input.strategy_id) || null });
          if (!t.ok) return { kind: "error", message: t.error };
          account = t.account;
          summary.push(`${def.name}: status → ${STATUS_LABELS[status]} (you confirmed: "${note}")`);
        }
        const allocated = n(input.allocated_usd), min = n(input.min_allocation_usd);
        if (allocated !== null) {
          if (allocated > 0 && !account.selectedStrategyId) return { kind: "error", message: "Record which trader is copied (status Trader selected with strategy_id) before recording an allocated amount." };
          account = { ...account, allocatedUsd: allocated, lastSyncAt: at };
          summary.push(`${def.name}: allocated amount → $${allocated}`);
        }
        if (min !== null) { account = { ...account, minAllocationUsd: min }; summary.push(`${def.name}: minimum copy amount → $${min}`); }
        if (!summary.length) return { kind: "error", message: "Nothing to record." };
        const updated = account;
        const next = validated({ ...engine, providers: providers.map((a) => (a.providerId === providerId ? updated : a)) });
        return "kind" in next ? next : { kind: "write", next, summary, output: { provider_id: providerId, status: STATUS_LABELS[updated.status] } };
      }
      case "run_risk_review": {
        const outcome = runMonitoring(engine, now, "manual");
        return { kind: "write", next: outcome.state, summary: ["Run a risk review now (records alerts, score history and an audit entry)"], output: { summary: outcome.summary, new_alerts: outcome.raised.map((a) => a.message), resolved: outcome.resolved.map((a) => a.message) } };
      }
      default:
        return { kind: "error", message: `Unknown tool ${name}.` };
    }
  } catch {
    return { kind: "error", message: "The tool failed unexpectedly." };
  }
}

export const AGENT_SYSTEM_PROMPT = `You are the GEM Copy Center agent, built into a copy-trading planning dashboard. You run the dashboard's jobs for the user through your tools: reviewing their workspace, recording traders they are considering, scoring and comparing them, proposing small-capital allocations within their risk limits, checking portfolio risk, running backtests and risk reviews, and keeping records up to date.

What you can and cannot do:
- You cannot move money, deposit, withdraw, place trades, start or stop copy trading, or read any exchange account. The user does those things on the exchange's own website or app (BTCC, Bitget, MT5, or others). When they need to act on an exchange, tell them exactly what to do there, then offer to record it.
- Every write tool asks the user to approve the change before it is saved. Propose writes only for things the user asked for or agreed to, and never invent trader statistics, statuses, amounts, or history: use only figures the user gave you, and use null for anything missing.
- Statuses and amounts in the workspace are the user's own confirmations, not verified by GEM. Only record a status the user says they saw on the exchange.
- Scores, proposals, backtests, and simulations are analytical aids, not predictions or guarantees of earnings. Simulated data (marked simulated) must always be called simulated and never presented as real performance.
- Spreading money across several platforms does not remove risk when strategies trade the same markets or move together; point this out when relevant.

How to work:
- Start by calling get_workspace_overview unless you already have what you need.
- Keep answers short and in plain language for a non-technical user. Use simple steps and dollar amounts. Explain why behind recommendations in a sentence or two.
- When a trader cannot be recommended (for example, no return history or a minimum above the planned amount), say what is missing and how to get it from the exchange profile.`;
