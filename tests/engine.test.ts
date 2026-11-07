import assert from "node:assert/strict";
import test from "node:test";
import { analyzeClusters, planAllocation } from "../lib/engine/allocation.ts";
import { runBacktest, createPaperPortfolio, valuePaperPortfolio } from "../lib/engine/backtest.ts";
import { computeMetrics, correlation, netReturns, assetOverlap } from "../lib/engine/metrics.ts";
import { isMonitorDue, runMonitoring } from "../lib/engine/monitoring.ts";
import { allowedTransitions, BUILT_IN_PROVIDERS, createCustomProvider, effectiveStatus, newProviderAccount, transitionStatus } from "../lib/engine/providers.ts";
import { parseSeriesCsv } from "../lib/engine/quality.ts";
import { assessPortfolio, detectDeterioration, STOP_COPY_NOTE } from "../lib/engine/risk.ts";
import { simulatedStrategies } from "../lib/engine/sample-data.ts";
import { evaluateStrategy, rankStrategies } from "../lib/engine/scoring.ts";
import { compactToBudget, DEFAULT_PLANNER, DEFAULT_POLICY, defaultEngineState, parseEngineState } from "../lib/engine/state.ts";
import type { EngineState, ProviderAccount, ReturnSeries, Strategy } from "../lib/engine/types.ts";
import { CloudService } from "../lib/cloud-core.ts";
import { parseWorkspace } from "../lib/workspace.ts";

const NOW = new Date("2026-10-24T12:00:00Z");
const AT = NOW.toISOString();

function dailyDates(n: number, endIso = "2026-10-23") {
  const end = Date.parse(endIso + "T00:00:00Z");
  return Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}
/** Deterministic wobble around a drift so volatility is non-zero. */
function series(n: number, drift: number, amp: number, phase = 0, extra: Partial<ReturnSeries> = {}): ReturnSeries {
  return { frequency: "daily", dates: dailyDates(n), returns: Array.from({ length: n }, (_, i) => drift + amp * Math.sin(i * 1.7 + phase)), basis: "net", source: "imported_csv", collectedAt: AT, verified: false, ...extra };
}
function strategy(id: string, over: Partial<Strategy> = {}): Strategy {
  return { id, providerId: "btcc", name: id, externalId: id, profileUrl: null, assets: ["BTC"], style: "trend", maxLeverage: 3, profitSharePct: 10, minCopyUsd: 10, series: series(120, 0.002, 0.01), observations: [], createdAt: AT, ...over };
}

// ---- metrics ---------------------------------------------------------------

test("metrics: drawdown, duration and profit factor", () => {
  const m = computeMetrics({ frequency: "daily", dates: ["a", "b", "c", "d", "e"], returns: [0.1, -0.5, 0.2, 0.2, 0.5] });
  assert.equal(m.maxDrawdownPct, 50);
  assert.equal(m.maxDrawdownDurationPeriods, 3);
  assert.equal(m.sharpe, null, "ratios need 30+ points");
  assert.equal(m.profitFactor, 2);
});

test("net returns apply a high-water-mark profit share", () => {
  const net = netReturns([0.1, -0.1, 0.1], 20);
  assert.ok(Math.abs(net[0] - 0.08) < 1e-9, "20% of the 10% gain is paid");
  assert.ok(Math.abs(net[1] + 0.1) < 1e-9, "losses are not refunded");
  // 1.08 -> 0.972 -> 1.0692 stays below the 1.08 high-water mark, so no fee is charged on this recovery.
  assert.ok(Math.abs(net[2] - 0.1) < 1e-9);
  const above = netReturns([0.1, 0.1], 20);
  assert.ok(Math.abs(above[1] - 0.08) < 1e-9, "a new high pays the share on the gain above the mark");
});

test("correlation requires overlap and detects co-movement", () => {
  const a = series(60, 0.001, 0.01);
  const b = series(60, 0.002, 0.02);
  const c = series(60, 0.001, 0.01, Math.PI);
  assert.equal(correlation(a, b).value, 1);
  assert.equal(correlation(a, c).value, -1);
  assert.equal(correlation(series(10, 0, 0.01), series(10, 0, 0.01)).value, null);
  assert.equal(assetOverlap(["BTC", "eth"], ["ETH", "BTC"]), 1);
});

// ---- scoring ---------------------------------------------------------------

test("high ROI with severe drawdown and leverage is penalised and ineligible", () => {
  const wildReturns = series(120, 0.02, 0.03).returns.map((r, i) => (i >= 60 && i < 64 ? -0.15 : r));
  const wild = strategy("wild", { maxLeverage: 50, series: { ...series(120, 0.02, 0.03), returns: wildReturns } });
  const steady = strategy("steady");
  const [a, b] = [evaluateStrategy(wild, DEFAULT_POLICY, NOW), evaluateStrategy(steady, DEFAULT_POLICY, NOW)];
  assert.ok(a.gross!.totalReturnPct > b.gross!.totalReturnPct, "wild has the higher raw return");
  assert.ok(a.score < b.score, "but scores lower");
  assert.equal(a.eligible, false);
  assert.ok(a.penalties.some((p) => p.includes("leverage")));
  assert.equal(b.eligible, true, b.ineligibleReasons.join(" "));
});

test("summary-only and simulated strategies are not eligible for real allocation, and missing data is listed", () => {
  const summary = strategy("summary", { series: null, observations: [{ id: "o", strategyId: "summary", source: "provider_profile", method: "transcribed", collectedAt: AT, confidence: 0.7, verified: false, sourceUrl: null, values: { roiPct: 40, periodDays: 90, maxDrawdownPct: 10 } }] });
  const e = evaluateStrategy(summary, DEFAULT_POLICY, NOW);
  assert.equal(e.eligible, false);
  assert.ok(e.missing.some((m) => m.includes("Sharpe")));
  const sim = simulatedStrategies(NOW)[0];
  assert.equal(evaluateStrategy(sim, DEFAULT_POLICY, NOW).eligible, false);
  assert.ok(evaluateStrategy(sim, DEFAULT_POLICY, NOW).ineligibleReasons.some((r) => r.includes("Simulated")));
  assert.equal(evaluateStrategy(sim, DEFAULT_POLICY, NOW, undefined, { allowSimulated: true }).simulated, true);
});

test("stale data makes a strategy ineligible", () => {
  const old = strategy("old", { series: { ...series(120, 0.002, 0.01), dates: dailyDates(120, "2026-08-01") } });
  const e = evaluateStrategy(old, DEFAULT_POLICY, NOW);
  assert.equal(e.eligible, false);
  assert.ok(e.flags.some((f) => f.code === "stale_series"));
});

test("scoring weights are configurable", () => {
  const s = strategy("s");
  const a = evaluateStrategy(s, DEFAULT_POLICY, NOW, { netReturn: 100, drawdown: 0, riskAdjusted: 0, consistency: 0, history: 0, dataQuality: 0 });
  const b = evaluateStrategy(s, DEFAULT_POLICY, NOW, { netReturn: 0, drawdown: 0, riskAdjusted: 0, consistency: 0, history: 0, dataQuality: 100 });
  assert.notEqual(a.score, b.score);
});

// ---- allocation ------------------------------------------------------------

function plan(strategies: Strategy[], over: Partial<typeof DEFAULT_PLANNER> = {}, accounts: ProviderAccount[] = [], policy = DEFAULT_POLICY) {
  const evaluations = rankStrategies(strategies, policy, NOW);
  return planAllocation({ strategies, evaluations, accounts, customProviders: [], policy, planner: { ...DEFAULT_PLANNER, ...over } });
}

test("$10 per provider: respects provider caps, minimums, reserve, and leaves the rest unallocated", () => {
  const strategies = [
    strategy("a", { providerId: "btcc", assets: ["BTC"] }),
    strategy("b", { providerId: "bitget", assets: ["ETH"], series: series(120, 0.002, 0.01, 2) }),
    strategy("c", { providerId: "mt5", assets: ["EURUSD"], minCopyUsd: 50, series: series(120, 0.001, 0.004, 4) }),
  ];
  const p = plan(strategies, { totalCapitalUsd: 30, reservePct: 10, maxPerProviderUsd: 10 });
  assert.equal(p.reserveUsd, 3);
  assert.deepEqual(p.allocations.map((a) => [a.strategyId, a.amountUsd]).sort(), [["a", 10], ["b", 10]]);
  assert.ok(p.rejected.some((r) => r.strategyId === "c" && r.reasons[0].includes("$50 minimum")));
  assert.equal(p.unallocatedUsd, 7);
  assert.ok(p.allocations.every((a) => a.amountUsd <= 10));
});

test("does not force an allocation when nothing qualifies", () => {
  const p = plan([strategy("bad", { maxLeverage: 100 })], { totalCapitalUsd: 30 });
  assert.equal(p.allocations.length, 0);
  assert.equal(p.unallocatedUsd, 27);
  assert.ok(p.warnings[0].includes("unallocated"));
});

test("unknown minimum is rejected unless explicitly allowed", () => {
  const s = strategy("u", { minCopyUsd: null });
  assert.ok(plan([s]).rejected[0].reasons[0].includes("Minimum copy amount is unknown"));
  assert.equal(plan([s], { allowUnknownMinimum: true, maxPerProviderUsd: 0 }).allocations.length, 1);
});

test("fixed costs that are too large relative to the amount reject the allocation", () => {
  const account = { ...newProviderAccount(BUILT_IN_PROVIDERS[0], AT), fixedCostUsd: 2 };
  const p = plan([strategy("a")], { totalCapitalUsd: 30 }, [account]);
  assert.ok(p.rejected[0].reasons[0].includes("Fixed costs"));
});

test("provider in ERROR or DISCONNECTED state is not allocated to", () => {
  const account = { ...newProviderAccount(BUILT_IN_PROVIDERS[0], AT), status: "ERROR" as const };
  assert.ok(plan([strategy("a")], {}, [account]).rejected[0].reasons[0].includes("ERROR"));
});

test("correlated strategies on different platforms share one cluster cap", () => {
  const a = strategy("a", { providerId: "btcc" });
  const b = strategy("b", { providerId: "bitget", series: series(120, 0.0021, 0.011) }); // same shape: correlation 1
  const clusters = analyzeClusters([a, b], DEFAULT_POLICY);
  assert.equal(clusters.clusters.length, 1);
  const p = plan([a, b], { totalCapitalUsd: 1000, maxPerProviderUsd: 0, reservePct: 0 }, [], { ...DEFAULT_POLICY, maxPerStrategyPct: 100, maxPerProviderPct: 100, maxPortfolioDrawdownPct: 100 });
  assert.ok(p.allocatedUsd <= 500 + 0.01, `cluster cap 50% of 1000, got ${p.allocatedUsd}`);
  assert.ok(p.warnings.some((w) => w.includes("correlated cluster")));
});

test("portfolio drawdown budget scales allocations down", () => {
  const risky = strategy("r", { series: { ...series(120, 0.003, 0.01), returns: series(120, 0.003, 0.01).returns.map((r, i) => (i >= 50 && i < 53 ? -0.07 : r)) } });
  const p = plan([risky], { totalCapitalUsd: 1000, maxPerProviderUsd: 0, reservePct: 0 }, [], { ...DEFAULT_POLICY, maxPerStrategyPct: 100, maxPerProviderPct: 100, maxPortfolioDrawdownPct: 5 });
  assert.ok(p.stressLossUsd <= 50 + 0.5, `stress ${p.stressLossUsd}`);
  assert.ok(p.warnings.some((w) => w.includes("Scaled allocations")));
});

test("equal and risk-adjusted methods differ under the same assumptions", () => {
  const calm = strategy("calm", { providerId: "btcc", assets: ["BTC"], series: series(120, 0.001, 0.004) });
  const jumpy = strategy("jumpy", { providerId: "bitget", assets: ["ETH"], series: series(120, 0.002, 0.02, 2) });
  const opts = { totalCapitalUsd: 300, maxPerProviderUsd: 0, reservePct: 0 };
  const policy = { ...DEFAULT_POLICY, maxPerStrategyPct: 100, maxPerProviderPct: 100, maxPortfolioDrawdownPct: 100 };
  const eq = plan([calm, jumpy], { ...opts, method: "equal" }, [], policy);
  const ra = plan([calm, jumpy], { ...opts, method: "risk_adjusted" }, [], policy);
  const amt = (p: typeof eq, id: string) => p.allocations.find((a) => a.strategyId === id)?.amountUsd ?? 0;
  assert.equal(amt(eq, "calm"), amt(eq, "jumpy"));
  assert.ok(amt(ra, "calm") > amt(ra, "jumpy"), "lower volatility gets more under risk-adjusted sizing");
});

// ---- risk ------------------------------------------------------------------

test("portfolio risk flags shared asset exposure across providers and concentration", () => {
  const a = strategy("a", { providerId: "btcc", assets: ["BTC"] });
  const b = strategy("b", { providerId: "bitget", assets: ["BTC"], series: series(120, 0.002, 0.01, 1.3) });
  const risk = assessPortfolio({
    holdings: [{ providerId: "btcc", strategyId: "a", amountUsd: 10 }, { providerId: "bitget", strategyId: "b", amountUsd: 10 }],
    accounts: [], strategies: [a, b], evaluations: rankStrategies([a, b], DEFAULT_POLICY, NOW), customProviders: [], policy: DEFAULT_POLICY, now: NOW,
  });
  assert.ok(risk.alerts.some((x) => x.kind === "asset_concentration" && x.subject === "BTC"), "100% BTC across two platforms");
  assert.ok(risk.alerts.some((x) => x.kind === "provider_concentration"), "50% per provider exceeds 40%");
});

test("leverage and drawdown breaches give critical alerts with an honest stop-copy note", () => {
  const s = strategy("lev", { maxLeverage: 25, series: { ...series(60, 0.001, 0.005), returns: [...series(50, 0.001, 0.005).returns, ...Array(10).fill(-0.06)] } });
  const risk = assessPortfolio({ holdings: [{ providerId: "btcc", strategyId: "lev", amountUsd: 10 }], accounts: [], strategies: [s], evaluations: rankStrategies([s], DEFAULT_POLICY, NOW), customProviders: [], policy: DEFAULT_POLICY, now: NOW });
  const lev = risk.alerts.find((a) => a.kind === "leverage");
  assert.equal(lev?.severity, "critical");
  assert.ok(lev?.recommendation.includes(STOP_COPY_NOTE));
  assert.ok(risk.alerts.some((a) => a.kind === "strategy_drawdown"));
});

test("deterioration detection compares recent behaviour with the strategy's own baseline", () => {
  const healthy = series(200, 0.002, 0.01).returns;
  assert.deepEqual(detectDeterioration(healthy, "daily"), []);
  const broken = [...healthy.slice(0, 160), ...Array.from({ length: 40 }, (_, i) => -0.01 + 0.05 * Math.sin(i))];
  const codes = detectDeterioration(broken, "daily").map((d) => d.code);
  assert.ok(codes.includes("volatility_jump"));
});

test("stale provider data and provider errors raise alerts", () => {
  const stale: ProviderAccount = { ...newProviderAccount(BUILT_IN_PROVIDERS[0], AT), status: "COPY_ACTIVE", lastSyncAt: "2026-10-01T00:00:00Z" };
  const broken: ProviderAccount = { ...newProviderAccount(BUILT_IN_PROVIDERS[1], AT), status: "ERROR" };
  assert.equal(effectiveStatus(stale, NOW, 168), "DATA_STALE");
  const risk = assessPortfolio({ holdings: [], accounts: [stale, broken], strategies: [], evaluations: [], customProviders: [], policy: DEFAULT_POLICY, now: NOW });
  assert.ok(risk.alerts.some((a) => a.kind === "provider_data_stale"));
  assert.ok(risk.alerts.some((a) => a.kind === "provider_error" && a.severity === "critical"));
});

// ---- provider status machine ------------------------------------------------

test("status transitions follow the documented path and require evidence", () => {
  let acct = newProviderAccount(BUILT_IN_PROVIDERS[0], AT);
  assert.equal(transitionStatus(acct, "COPY_ACTIVE", { at: AT, evidence: "user_attested", note: "skip ahead" }).ok, false, "cannot skip from DISCOVERED to COPY_ACTIVE");
  assert.equal(transitionStatus(acct, "ACCOUNT_LINKED", { at: AT, evidence: "user_attested", note: "" }).ok, false, "evidence note required");
  assert.equal(transitionStatus(acct, "DATA_STALE", { at: AT, evidence: "system", note: "x" }).ok, false, "derived state cannot be set");
  for (const [to, note] of [["ACCOUNT_LINKED", "signed in"], ["ACCOUNT_VERIFIED", "KYC done"]] as const) {
    const r = transitionStatus(acct, to, { at: AT, evidence: "user_attested", note });
    assert.ok(r.ok); acct = r.account;
  }
  assert.equal(transitionStatus(acct, "TRADER_SELECTED", { at: AT, evidence: "user_attested", note: "picked" }).ok, false, "must name the strategy");
  const sel = transitionStatus(acct, "TRADER_SELECTED", { at: AT, evidence: "user_attested", note: "picked", strategyId: "a" });
  assert.ok(sel.ok && sel.account.selectedStrategyId === "a");
  assert.ok(!allowedTransitions("TRADER_SELECTED").includes("COPY_ACTIVE"), "selection is not activation");
});

test("custom providers are always manual and cannot claim supported capabilities", () => {
  const p = createCustomProvider({ name: "My Broker", url: "https://example.com", markets: ["FX"], minAllocationUsd: 25, feeNotes: "" });
  assert.equal(p.integration, "manual");
  assert.ok(Object.values(p.capabilities).every((c) => c !== "supported"));
  for (const b of BUILT_IN_PROVIDERS) assert.ok(Object.values(b.capabilities).every((c) => c !== "supported"), `${b.name} has no verified adapter`);
});

// ---- validation & authorization -------------------------------------------

test("engine state validation rejects forged verification and capability claims", () => {
  const base = defaultEngineState();
  assert.equal(parseEngineState(base).ok, true);
  const forgedAccount = { ...newProviderAccount(BUILT_IN_PROVIDERS[0], AT), history: [{ status: "COPY_ACTIVE", at: AT, evidence: "official_api", note: "x" }] };
  assert.equal(parseEngineState({ ...base, providers: [forgedAccount] }).ok, false);
  const forgedProvider = { ...createCustomProvider({ name: "X", url: "https://x.example", markets: [], minAllocationUsd: null, feeNotes: "" }), capabilities: { research_profiles: "supported", read_account: "not_available", read_copy_status: "not_available", activate_copy: "supported", pause_copy: "not_available", place_orders: "not_available" } };
  assert.equal(parseEngineState({ ...base, customProviders: [forgedProvider] }).ok, false);
  assert.equal(parseEngineState({ ...base, strategies: [strategy("a"), strategy("a")] }).ok, false, "duplicate ids");
  assert.equal(parseEngineState({ ...base, strategies: [{ ...strategy("a"), profileUrl: "javascript:alert(1)" }] }).ok, false, "only https links");
});

test("workspace with engine round-trips; legacy workspaces without engine stay valid", () => {
  const engine = { ...defaultEngineState(), strategies: simulatedStrategies(NOW) };
  const ws = parseWorkspace({ traders: [], savedReviews: [], portfolioSnapshots: [], engine });
  assert.equal(ws.ok, true);
  assert.equal(parseWorkspace({ traders: [], savedReviews: [], portfolioSnapshots: [] }).ok, true);
  assert.equal(parseWorkspace({ traders: [], savedReviews: [], portfolioSnapshots: [], engine: { version: 2 } }).ok, false);
});

test("workspace API stores engine data only for the verified owner and rejects malformed engine payloads", async () => {
  let written: any;
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "owner-1" }), { status: 200 });
    written = JSON.parse(String(init.body));
    return new Response(JSON.stringify([{ updated_at: AT }]), { status: 201 });
  };
  const service = new CloudService({ url: "https://proj.supabase.co", key: "anon" }, fetchImpl);
  const engine = { ...defaultEngineState(), strategies: [strategy("a")] };
  const ok = await service.putWorkspace({ access: "jwt" }, JSON.stringify({ expectedUpdatedAt: null, workspace: { traders: [], savedReviews: [], portfolioSnapshots: [], engine } }));
  assert.equal(ok.status, 200);
  assert.equal(written.user_id, "owner-1");
  assert.equal(written.payload.engine.strategies[0].id, "a");
  const bad = await service.putWorkspace({ access: "jwt" }, JSON.stringify({ expectedUpdatedAt: null, workspace: { traders: [], savedReviews: [], portfolioSnapshots: [], engine: { ...engine, policy: { maxLeverage: "lots" } } } }));
  assert.equal(bad.status, 400);
  assert.equal((await new CloudService({ url: "https://proj.supabase.co", key: "anon" }, fetchImpl).getWorkspace({})).status, 401);
});

// ---- research import --------------------------------------------------------

test("CSV import validates and converts equity curves to returns", () => {
  const ok = parseSeriesCsv("date,equity\n2026-10-01,100\n2026-10-02,110\n2026-10-03,99", { source: "imported_csv", collectedAt: AT, basis: "gross" });
  assert.ok(ok.ok);
  if (ok.ok) { assert.deepEqual(ok.series.returns, [0.1, -0.1]); assert.equal(ok.series.frequency, "daily"); assert.equal(ok.series.verified, false); }
  assert.equal(parseSeriesCsv("date,return_pct\n2026-10-02,1\n2026-10-01,2\n2026-10-03,1", { source: "imported_csv", collectedAt: AT, basis: "gross" }).ok, false, "unsorted");
  assert.equal(parseSeriesCsv("date,return_pct\n2026-10-01,1\n2026-10-01,2\n2026-10-03,1", { source: "imported_csv", collectedAt: AT, basis: "gross" }).ok, false, "duplicate");
  assert.equal(parseSeriesCsv("date,return_pct\n2026-10-01,abc\n2026-10-02,2", { source: "imported_csv", collectedAt: AT, basis: "gross" }).ok, false);
  assert.equal(parseSeriesCsv("when,value\n1,2\n3,4", { source: "imported_csv", collectedAt: AT, basis: "gross" }).ok, false);
});

// ---- monitoring --------------------------------------------------------------

test("monitoring is idempotent, resolves cleared alerts, and writes an audit trail", () => {
  const s = strategy("lev", { maxLeverage: 25 });
  const account: ProviderAccount = { ...newProviderAccount(BUILT_IN_PROVIDERS[0], AT), status: "COPY_ACTIVE", allocatedUsd: 10, selectedStrategyId: "lev", lastSyncAt: AT };
  let state: EngineState = { ...defaultEngineState(), strategies: [s], providers: [account] };
  assert.equal(isMonitorDue(state, NOW), true);
  const first = runMonitoring(state, NOW, "manual");
  assert.ok(first.raised.some((a) => a.kind === "leverage"));
  assert.ok(first.reviewSuggested);
  assert.ok(first.summary.includes("Nothing has been changed on any platform"));
  const second = runMonitoring(first.state, new Date(NOW.getTime() + 60_000), "manual");
  assert.equal(second.raised.length, 0, "no duplicate alerts");
  assert.equal(isMonitorDue(second.state, new Date(NOW.getTime() + 3_600_000)), false);
  state = { ...second.state, strategies: [{ ...s, maxLeverage: 3 }] };
  const third = runMonitoring(state, new Date(NOW.getTime() + 120_000), "manual");
  assert.ok(third.resolved.some((a) => a.kind === "leverage"));
  assert.ok(third.state.audit.some((e) => e.action === "alert_resolved"));
  assert.ok(third.state.audit.filter((e) => e.action === "monitor_run").length === 3);
});

// ---- backtesting & paper --------------------------------------------------

test("backtest uses only past data (no look-ahead) and reports assumptions", () => {
  const sims = simulatedStrategies(NOW, 200);
  const base = runBacktest({ strategies: sims, accounts: [], customProviders: [], policy: DEFAULT_POLICY, planner: DEFAULT_PLANNER, config: { warmup: 60, rebalanceEvery: 20 } });
  assert.ok(base.results.length === 4);
  assert.ok(base.limitations.some((l) => l.includes("SIMULATED")));
  assert.ok(base.limitations.some((l) => l.includes("Survivorship")));
  // Alter only the FINAL period of every strategy. Decisions before it must be identical, so values up to
  // the previous period must match exactly.
  const altered = sims.map((s) => ({ ...s, series: { ...s.series!, returns: [...s.series!.returns.slice(0, -1), 0.5] } }));
  const changed = runBacktest({ strategies: altered, accounts: [], customProviders: [], policy: DEFAULT_POLICY, planner: DEFAULT_PLANNER, config: { warmup: 60, rebalanceEvery: 20 } });
  for (let i = 0; i < base.results.length; i++) {
    assert.deepEqual(changed.results[i].equity.slice(0, -1), base.results[i].equity.slice(0, -1), base.results[i].method);
  }
  const cash = base.results.find((r) => r.method === "cash")!;
  assert.equal(cash.finalValueUsd, 30);
});

test("paper portfolio is valued from returns after its start date", () => {
  const s = strategy("p", { series: { ...series(10, 0, 0), returns: Array(10).fill(0.01), dates: dailyDates(10) } });
  const pp = createPaperPortfolio({ id: "pp", name: "test", method: "equal", allocations: [{ strategyId: "p", amountUsd: 100 }], cashUsd: 10, startDate: s.series!.dates[4], createdAt: AT });
  const v = valuePaperPortfolio(pp, [s]);
  assert.equal(v.lines[0].periods, 5);
  assert.equal(v.lines[0].valueUsd, Math.round(100 * 1.01 ** 5 * 100) / 100);
  assert.equal(v.startUsd, 110);
});

test("workspace stays within the cloud byte budget: history is trimmed oldest-first, core data never dropped", () => {
  const sims = simulatedStrategies(NOW);
  const audit = Array.from({ length: 300 }, (_, i) => ({ id: "a" + i, at: AT, actor: "engine" as const, action: "monitor_run", detail: "x".repeat(900) }));
  const state: EngineState = { ...defaultEngineState(), strategies: sims, audit };
  const budget = 120_000;
  const r = compactToBudget(state, budget);
  assert.equal(r.ok, true);
  assert.ok(r.bytes <= budget);
  assert.equal(r.state.strategies.length, sims.length);
  assert.ok(r.state.audit.length < 300 && r.state.audit.at(-1)!.id === "a299", "newest audit events kept");
  assert.equal(compactToBudget(state, 10_000).ok, false, "refuses rather than dropping strategies");
});
