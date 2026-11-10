"use client";
// C · Strategy intelligence, D · Capital allocation, E · Risk center.
import { useMemo, useState } from "react";
import { analyzeClusters, planAllocation, type AllocationPlan } from "../../../../lib/engine/allocation.ts";
import { createPaperPortfolio } from "../../../../lib/engine/backtest.ts";
import { findProvider } from "../../../../lib/engine/providers.ts";
import { assessPortfolio, holdingsFromAccounts, STOP_COPY_NOTE } from "../../../../lib/engine/risk.ts";
import { DEFAULT_WEIGHTS, rankStrategies, type StrategyEvaluation } from "../../../../lib/engine/scoring.ts";
import { DEFAULT_PLANNER, DEFAULT_POLICY, ENGINE_LIMITS, newId } from "../../../../lib/engine/state.ts";
import type { AllocationMethod, EngineState, RiskPolicy, ScoringWeights } from "../../../../lib/engine/types.ts";
import { Notice, num, NumberField, pct, Pill, usd, when, type EngineChange } from "./ui.tsx";

const METHOD_LABEL: Record<AllocationMethod, string> = { equal: "Equal", risk_adjusted: "Risk-adjusted (inverse volatility)", score_weighted: "Score-weighted" };

// ---- C · Strategy intelligence ---------------------------------------------

export function IntelligenceTab({ engine, onChange, evaluations }: { engine: EngineState; onChange: EngineChange; evaluations: StrategyEvaluation[] }) {
  const [selected, setSelected] = useState<string | null>(evaluations[0]?.strategyId ?? null);
  const names = new Map(engine.strategies.map((s) => [s.id, s.name]));
  const clusters = useMemo(() => analyzeClusters(engine.strategies, engine.policy), [engine.strategies, engine.policy]);
  const ev = evaluations.find((e) => e.strategyId === selected) ?? evaluations[0];
  const withHistory = engine.strategies.filter((s) => s.series);
  const setWeight = (k: keyof ScoringWeights, v: number) => onChange({ ...engine, weights: { ...engine.weights, [k]: v } }, { action: "weights_changed", detail: `${k} weight → ${v}` });

  if (!evaluations.length) return <Notice tone="info">Add strategies in Opportunities to compare them here.</Notice>;
  return (
    <div className="engine-stack">
      <div className="table-wrap"><table>
        <thead><tr><th>Strategy</th><th>Score</th><th>Net total</th><th>Net ann.</th><th>Volatility</th><th>Max DD</th><th>DD length</th><th>Sharpe</th><th>Sortino</th><th>Win rate</th><th>Avg win / loss</th><th>Profit factor</th><th>Periods</th></tr></thead>
        <tbody>{evaluations.map((e) => <tr key={e.strategyId} className={e.strategyId === ev?.strategyId ? "row-selected" : ""}>
          <td><button type="button" className="link-btn" onClick={() => setSelected(e.strategyId)}>{names.get(e.strategyId)}</button>{e.simulated && <> <Pill tone="sim">SIM</Pill></>}</td>
          <td><span className="score">{e.score}</span></td><td>{pct(e.net?.totalReturnPct)}</td><td>{pct(e.net?.annualizedReturnPct)}</td><td>{pct(e.net?.volatilityPct)}</td>
          <td>{pct(e.net?.maxDrawdownPct)}</td><td>{e.net ? `${e.net.maxDrawdownDurationPeriods}p` : "—"}</td><td>{num(e.net?.sharpe)}</td><td>{num(e.net?.sortino)}</td><td>{pct(e.net?.winRatePct)}</td>
          <td>{e.net?.avgWinPct !== null && e.net ? `${num(e.net.avgWinPct)} / ${num(e.net.avgLossPct)}%` : "—"}</td><td>{num(e.net?.profitFactor)}</td><td>{e.net?.points ?? 0}</td>
        </tr>)}</tbody>
      </table></div>
      <p className="footnote">Net figures deduct the recorded profit share (high-water mark) and an estimated cost drag of 0.02%/day or 0.1%/week for fees, funding and slippage. Gross figures are in the detail view.</p>

      {ev && <article className="engine-card wide">
        <div className="engine-card-head"><div><h3>Why {names.get(ev.strategyId)} scored {ev.score}</h3><span className="cell-sub">Grade {ev.grade} · data confidence {Math.round(ev.confidence * 100)}% · {ev.eligible ? "eligible under your policy" : "not eligible"}</span></div>{ev.simulated && <Pill tone="sim">SIMULATED DATA</Pill>}</div>
        <div className="table-wrap"><table className="compact-table"><thead><tr><th>Component</th><th>Weight</th><th>Points</th><th>Evidence</th></tr></thead>
          <tbody>{ev.components.map((c) => <tr key={c.key}><td>{c.label}</td><td>{c.weight}</td><td>{c.points === null ? <Pill tone="warn">missing (0)</Pill> : Math.round(c.points)}</td><td className="wrap">{c.explanation}</td></tr>)}</tbody></table></div>
        {ev.penalties.length > 0 && <><strong>Penalties</strong><ul className="engine-steps">{ev.penalties.map((p) => <li key={p}>{p}</li>)}</ul></>}
        {ev.ineligibleReasons.length > 0 && <><strong>Why it is not eligible</strong><ul className="engine-steps">{ev.ineligibleReasons.map((p) => <li key={p}>{p}</li>)}</ul></>}
        {ev.missing.length > 0 && <p className="cell-sub wrap">Missing data: {ev.missing.join(", ")}.</p>}
        {ev.flags.length > 0 && <><strong>Data-quality flags</strong><ul className="engine-steps">{ev.flags.map((f) => <li key={f.code}><Pill tone={f.severity === "critical" ? "bad" : f.severity === "warning" ? "warn" : "neutral"}>{f.severity}</Pill> {f.message}</li>)}</ul></>}
        <strong>What could invalidate this ranking</strong><ul className="engine-steps">{ev.invalidators.map((p) => <li key={p}>{p}</li>)}</ul>
        {ev.gross && ev.net && <p className="cell-sub">Gross total {pct(ev.gross.totalReturnPct)} vs estimated net {pct(ev.net.totalReturnPct)}; worst period {pct(ev.net.worstPeriodPct)}; best {pct(ev.net.bestPeriodPct)}.</p>}
      </article>}

      <article className="engine-card wide">
        <h3>Correlation &amp; shared risk</h3>
        <p className="muted">Strategies that move together count as one risk source even on different platforms. Linked when returns correlate at ≥ {engine.policy.correlationThreshold} or, without shared history, when most traded assets overlap.</p>
        {withHistory.length >= 2 ? <div className="table-wrap"><table className="compact-table matrix"><thead><tr><th />{withHistory.map((s) => <th key={s.id} title={s.name}>{s.name.slice(0, 14)}</th>)}</tr></thead>
          <tbody>{withHistory.map((a) => <tr key={a.id}><th title={a.name}>{a.name.slice(0, 18)}</th>{withHistory.map((b) => {
            if (a.id === b.id) return <td key={b.id}>1</td>;
            const p = clusters.pairs.find((x) => (x.a === a.id && x.b === b.id) || (x.a === b.id && x.b === a.id));
            const v = p?.correlation;
            return <td key={b.id} className={v !== null && v !== undefined && v >= engine.policy.correlationThreshold ? "corr-high" : ""}>{v === null || v === undefined ? "n/a" : v.toFixed(2)}</td>;
          })}</tr>)}</tbody></table></div> : <p className="cell-sub">Need return history for at least two strategies.</p>}
        <strong>Risk clusters</strong>
        <ul className="engine-steps">{clusters.clusters.map((c, i) => <li key={i}>{c.map((id) => names.get(id)).join(" + ")}{c.length > 1 ? <> <Pill tone="warn">shared risk</Pill> <span className="cell-sub">{clusters.pairs.filter((p) => p.linked && c.includes(p.a) && c.includes(p.b)).map((p) => p.reason).join(" ")}</span></> : null}</li>)}</ul>
      </article>

      <article className="engine-card wide">
        <h3>Scoring weights</h3>
        <p className="muted">Configurable. Missing components score zero rather than average, so thin evidence cannot rank highly.</p>
        <div className="engine-form compact">{(Object.keys(DEFAULT_WEIGHTS) as (keyof ScoringWeights)[]).map((k) => <NumberField key={k} label={k.replace(/([A-Z])/g, " $1").toLowerCase()} value={engine.weights[k]} min={0} max={100} onChange={(v) => setWeight(k, v)} />)}</div>
        <button type="button" className="review-btn" onClick={() => onChange({ ...engine, weights: { ...DEFAULT_WEIGHTS } }, { action: "weights_reset", detail: "Scoring weights reset to defaults." })}>Reset weights</button>
      </article>
    </div>
  );
}

// ---- D · Capital allocation ------------------------------------------------

export function AllocationTab({ engine, onChange, evaluations, now, startWithSimulated = false }: { engine: EngineState; onChange: EngineChange; evaluations: StrategyEvaluation[]; now: Date; startWithSimulated?: boolean }) {
  // Real mode: simulated strategies are never included in allocations.
  const includeSim = false;
  void startWithSimulated;
  const [message, setMessage] = useState("");
  const planner = engine.planner;
  const names = new Map(engine.strategies.map((s) => [s.id, s.name]));
  const evals = useMemo(() => (includeSim ? rankStrategies(engine.strategies, engine.policy, now, engine.weights, { allowSimulated: true }) : evaluations), [includeSim, engine.strategies, engine.policy, engine.weights, now, evaluations]);
  const plans = useMemo(() => Object.fromEntries((["equal", "risk_adjusted", "score_weighted"] as AllocationMethod[]).map((m) => [m, planAllocation({ strategies: engine.strategies, evaluations: evals, accounts: engine.providers, customProviders: engine.customProviders, policy: engine.policy, planner, method: m })])) as Record<AllocationMethod, AllocationPlan>, [engine, evals, planner]);
  const plan = plans[planner.method];
  const setPlanner = (patch: Partial<typeof planner>) => onChange({ ...engine, planner: { ...planner, ...patch } }, { action: "planner_changed", detail: JSON.stringify(patch) });
  const usesSim = includeSim && plan.allocations.some((a) => a.strategyId.startsWith("sim-"));

  function savePaper() {
    if (engine.paperPortfolios.length >= ENGINE_LIMITS.paperPortfolios) return setMessage("Paper portfolio limit reached; delete one in the Backtest lab.");
    const latest = engine.strategies.flatMap((s) => s.series?.dates.slice(-1) ?? []).sort().at(-1) ?? now.toISOString().slice(0, 10);
    const pp = createPaperPortfolio({ id: newId("paper"), name: `${METHOD_LABEL[plan.method]} · ${now.toISOString().slice(0, 10)}${usesSim ? " · SIM" : ""}`, method: plan.method, allocations: plan.allocations, cashUsd: plan.reserveUsd + plan.unallocatedUsd, startDate: latest, createdAt: now.toISOString() });
    onChange({ ...engine, paperPortfolios: [...engine.paperPortfolios, pp] }, { action: "paper_created", detail: `Paper portfolio "${pp.name}" with ${pp.positions.length} positions, starting after ${latest}.` });
    setMessage("Saved as a paper portfolio. It is valued in the Backtest lab as new history is recorded; no money moves.");
  }

  return (
    <div className="engine-stack">
      <div className="engine-form compact">
        <NumberField label="Total capital to plan (USD)" value={planner.totalCapitalUsd} max={1e9} onChange={(v) => setPlanner({ totalCapitalUsd: v })} />
        <NumberField label="Cash reserve (%)" value={planner.reservePct} max={100} onChange={(v) => setPlanner({ reservePct: v })} />
        <NumberField label="Max per provider (USD, 0 = no $ cap)" value={planner.maxPerProviderUsd} onChange={(v) => setPlanner({ maxPerProviderUsd: v })} />
        <label>Method<select value={planner.method} onChange={(e) => setPlanner({ method: e.target.value as AllocationMethod })}>{Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="check"><input type="checkbox" checked={planner.allowUnknownMinimum} onChange={(e) => setPlanner({ allowUnknownMinimum: e.target.checked })} /> Allow providers whose minimum is unknown</label>
        
      </div>
      {usesSim && <Notice tone="bad"><strong>SIMULATED.</strong> This proposal uses generated data to demonstrate the engine. It is not a recommendation for real money.</Notice>}
      <div className="engine-kpis">
        <div><span>Investable</span><strong>{usd(plan.investableUsd)}</strong></div>
        <div><span>Proposed</span><strong>{usd(plan.allocatedUsd)}</strong></div>
        <div><span>Held unallocated</span><strong>{usd(plan.unallocatedUsd)}</strong></div>
        <div><span>Reserve</span><strong>{usd(plan.reserveUsd)}</strong></div>
        <div><span>Stress loss*</span><strong>{usd(plan.stressLossUsd)}</strong></div>
        <div><span>Est. fixed costs</span><strong>{usd(plan.estCostsUsd)}</strong></div>
      </div>
      <p className="footnote">*Loss if every proposed allocation repeated its worst recorded drawdown at the same time. Not a maximum: real losses can be larger.</p>
      {plan.warnings.map((w) => <Notice key={w} tone="warn">{w}</Notice>)}
      <div className="table-wrap"><table>
        <thead><tr><th>Strategy</th><th>Provider</th><th>Proposed</th><th>% of capital</th><th>Minimum</th><th>Why</th><th>Next step</th></tr></thead>
        <tbody>
          {!plan.allocations.length && <tr><td colSpan={7} className="empty-cell">No allocation proposed. Keeping capital unallocated is a valid outcome when nothing meets your requirements.</td></tr>}
          {plan.allocations.map((a) => { const p = findProvider(a.providerId, engine.customProviders); return <tr key={a.strategyId}>
            <td><strong>{names.get(a.strategyId)}</strong></td><td>{p?.name}</td><td>{usd(a.amountUsd)}</td><td>{pct(a.weightPct)}</td><td>{a.minimumUsd === null ? "unknown" : usd(a.minimumUsd)}</td>
            <td className="wrap">{a.reasons.join(" ")}</td><td>{p && <a className="exchange-link-inline" href={p.copyUrl} target="_blank" rel="noreferrer">Set up on {p.name} ↗</a>}</td>
          </tr>; })}
        </tbody>
      </table></div>
      {plan.rejected.length > 0 && <details className="engine-details"><summary>Not allocated ({plan.rejected.length}) and why</summary><ul className="engine-steps">{plan.rejected.map((r) => <li key={r.strategyId}><strong>{names.get(r.strategyId)}</strong>: {r.reasons.join(" ")}</li>)}</ul></details>}
      <h3>Method comparison (same assumptions)</h3>
      <div className="table-wrap"><table className="compact-table"><thead><tr><th>Method</th><th>Positions</th><th>Proposed</th><th>Unallocated</th><th>Stress loss</th><th>Largest position</th></tr></thead>
        <tbody>{(Object.keys(plans) as AllocationMethod[]).map((m) => <tr key={m} className={m === planner.method ? "row-selected" : ""}><td>{METHOD_LABEL[m]}</td><td>{plans[m].allocations.length}</td><td>{usd(plans[m].allocatedUsd)}</td><td>{usd(plans[m].unallocatedUsd)}</td><td>{usd(plans[m].stressLossUsd)}</td><td>{usd(plans[m].allocations[0]?.amountUsd ?? 0)}</td></tr>)}</tbody></table></div>
      <div className="engine-actions"><button type="button" className="secondary-btn" onClick={savePaper} disabled={!plan.allocations.length}>Track this proposal as a paper portfolio</button></div>
      {message && <p className="form-message" role="status">{message}</p>}
      <Notice tone="info">GEM does not deposit, transfer, or allocate funds. To act on a proposal, open each provider, set the maximum copy amount to the proposed figure, confirm there, then record the status and allocated amount in Providers.</Notice>
    </div>
  );
}

// ---- E · Risk center --------------------------------------------------------

const POLICY_FIELDS: [keyof RiskPolicy, string, number, number][] = [
  ["maxPerProviderPct", "Max per provider (%)", 0, 100], ["maxPerStrategyPct", "Max per strategy (%)", 0, 100], ["maxClusterPct", "Max per correlated cluster (%)", 0, 100], ["maxAssetPct", "Max per asset (%)", 0, 100],
  ["maxStrategyDrawdownPct", "Max strategy drawdown (%)", 0, 100], ["maxPortfolioDrawdownPct", "Max portfolio stress loss (%)", 0, 100], ["maxLeverage", "Max leverage (x)", 1, 500], ["minHistoryPoints", "Min history (periods)", 0, 400],
  ["minConfidence", "Min data confidence (0–1)", 0, 1], ["maxProfitSharePct", "Max profit share (%)", 0, 100], ["maxCostPct", "Max fixed cost (% of amount)", 0, 100], ["staleAfterHours", "Data stale after (hours)", 1, 8760],
  ["correlationThreshold", "Correlation link threshold", 0.01, 1], ["minScore", "Minimum score", 0, 100],
];

export function RiskTab({ engine, onChange, evaluations, now }: { engine: EngineState; onChange: EngineChange; evaluations: StrategyEvaluation[]; now: Date }) {
  const risk = useMemo(() => assessPortfolio({ holdings: holdingsFromAccounts(engine.providers), accounts: engine.providers, strategies: engine.strategies, evaluations, customProviders: engine.customProviders, policy: engine.policy, now, capitalBaseUsd: engine.planner.totalCapitalUsd }), [engine, evaluations, now]);
  const open = engine.alerts.filter((a) => !a.resolvedAt);
  const setPolicy = (k: keyof RiskPolicy, v: number) => onChange({ ...engine, policy: { ...engine.policy, [k]: k === "minHistoryPoints" ? Math.round(v) : v } }, { action: "policy_changed", detail: `${k} → ${v}` });
  const ack = (key: string) => onChange({ ...engine, alerts: engine.alerts.map((a) => (a.key === key && !a.resolvedAt ? { ...a, acknowledgedAt: new Date().toISOString() } : a)) }, { action: "alert_acknowledged", detail: key });
  const live = new Set(risk.alerts.map((a) => a.key));
  const notYetRecorded = risk.alerts.filter((a) => !open.some((o) => o.key === a.key));

  const ExposureTable = ({ title, rows }: { title: string; rows: typeof risk.byProvider }) => (
    <div><strong>{title}</strong>{rows.length ? <ul className="exposure-list">{rows.map((r) => <li key={r.key}><span>{r.label}</span><span className="bar"><i style={{ width: `${Math.min(r.pct, 100)}%` }} className={r.breached ? "over" : ""} /></span><span>{usd(r.amountUsd)} · {pct(r.pct)}{r.breached ? <> <Pill tone="bad">over {r.limitPct}%</Pill></> : ""}</span></li>)}</ul> : <p className="cell-sub">Nothing to show.</p>}</div>
  );

  return (
    <div className="engine-stack">
      <Notice tone="info">Exposure uses the amounts you recorded as allocated in Providers, measured against your planned capital ({usd(engine.planner.totalCapitalUsd)}). {STOP_COPY_NOTE}</Notice>
      <div className="engine-kpis">
        <div><span>Recorded allocated</span><strong>{usd(risk.totalUsd)}</strong></div>
        <div><span>Stress loss</span><strong>{usd(risk.stressLossUsd)} ({pct(risk.stressLossPct)})</strong></div>
        <div><span>Limit</span><strong>{pct(engine.policy.maxPortfolioDrawdownPct)}</strong></div>
        <div><span>Open alerts</span><strong>{open.length}</strong></div>
      </div>
      <div className="engine-two-col">
        <ExposureTable title="By provider" rows={risk.byProvider} />
        <ExposureTable title="By strategy" rows={risk.byStrategy} />
        <ExposureTable title="By asset (across providers)" rows={risk.byAsset} />
        <ExposureTable title="Correlated clusters" rows={risk.byCluster} />
      </div>
      <h3>Alerts</h3>
      {notYetRecorded.length > 0 && <Notice tone="warn">{notYetRecorded.length} condition(s) detected since the last review. Run a review in Monitoring to record them in the audit trail.</Notice>}
      {!open.length && !notYetRecorded.length && <p className="cell-sub">No open alerts.</p>}
      <ul className="alert-list">
        {[...open.map((a) => ({ ...a, recorded: true })), ...notYetRecorded.map((a) => ({ ...a, createdAt: now.toISOString(), acknowledgedAt: null, resolvedAt: null, recorded: false }))].map((a) => (
          <li key={a.key} className={`alert alert-${a.severity}${a.acknowledgedAt ? " acked" : ""}`}>
            <div><Pill tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "neutral"}>{a.severity}</Pill> <strong>{a.message}</strong></div>
            <p>{a.recommendation}</p>
            <span className="cell-sub">{a.recorded ? `Raised ${when(a.createdAt)}` : "Detected now (not yet recorded)"}{a.acknowledgedAt ? ` · acknowledged ${when(a.acknowledgedAt)}` : ""}{a.recorded && !live.has(a.key) ? " · condition no longer detected; resolves at next review" : ""}</span>
            {a.recorded && !a.acknowledgedAt && <button type="button" className="review-btn" onClick={() => ack(a.key)}>Acknowledge</button>}
          </li>
        ))}
      </ul>
      <h3>Risk policy</h3>
      <div className="engine-form compact">{POLICY_FIELDS.map(([k, label, min, max]) => <NumberField key={k} label={label} value={engine.policy[k] as number} min={min} max={max} onChange={(v) => setPolicy(k, v)} />)}</div>
      <button type="button" className="review-btn" onClick={() => window.confirm("Reset the risk policy and planner to defaults?") && onChange({ ...engine, policy: { ...DEFAULT_POLICY }, planner: { ...DEFAULT_PLANNER } }, { action: "policy_reset", detail: "Risk policy and planner reset to defaults." })}>Reset to defaults</button>
    </div>
  );
}
