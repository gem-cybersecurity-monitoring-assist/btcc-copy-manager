"use client";
// GEM Copy Trading Intelligence Engine: tabbed workspace for providers, research, scoring, allocation,
// risk, monitoring, simulation, and wallets. All state lives in the user's workspace (EngineState).
import { useEffect, useMemo, useRef, useState } from "react";
import { allProviders, allowedTransitions, createCustomProvider, effectiveStatus, newProviderAccount, STATUS_EVIDENCE_PROMPT, STATUS_LABELS, statusProvenance, transitionStatus } from "../../../lib/engine/providers.ts";
import { parseSeriesCsv, SOURCE_LABELS } from "../../../lib/engine/quality.ts";
import { isMonitorDue, runMonitoring } from "../../../lib/engine/monitoring.ts";
import { SAMPLE_PREFIX, simulatedStrategies } from "../../../lib/engine/sample-data.ts";
import { rankStrategies, type StrategyEvaluation } from "../../../lib/engine/scoring.ts";
import { ENGINE_LIMITS, newId } from "../../../lib/engine/state.ts";
import type { DataSource, EngineState, ProviderAccount, ProviderDefinition, ProviderStatus, Strategy } from "../../../lib/engine/types.ts";
import type { Trader } from "../../../lib/workspace.ts";
import { AllocationTab, IntelligenceTab, RiskTab } from "./AnalysisTabs.tsx";
import { LabTab, MonitoringTab, WalletsTab } from "./OpsTabs.tsx";
import { Notice, num, pct, Pill, usd, when, type EngineChange } from "./ui.tsx";

const TABS = [
  ["providers", "A · Providers"],
  ["opportunities", "B · Opportunities"],
  ["intelligence", "C · Strategy intelligence"],
  ["allocation", "D · Capital allocation"],
  ["risk", "E · Risk center"],
  ["monitoring", "F · Monitoring & audit"],
  ["lab", "G · Simulation lab"],
  ["wallets", "H · Wallets"],
] as const;
type TabId = (typeof TABS)[number][0];

const STATUS_TONE: Partial<Record<ProviderStatus, "good" | "warn" | "bad">> = { COPY_ACTIVE: "good", ACCOUNT_VERIFIED: "good", PAUSED: "warn", COPY_ACTIVATION_PENDING: "warn", DATA_STALE: "bad", ERROR: "bad", DISCONNECTED: "bad", NOT_SUPPORTED: "bad" };

export default function IntelligenceEngine({ engine, onChange, manualTraders }: { engine: EngineState; onChange: EngineChange; manualTraders: Trader[] }) {
  const [tab, setTab] = useState<TabId>("providers");
  const [now, setNow] = useState(() => new Date());
  const ranAuto = useRef(false);

  // Scheduled review: runs once per page load when the configured interval has elapsed.
  useEffect(() => {
    if (ranAuto.current) return;
    ranAuto.current = true;
    const t = new Date();
    if ((engine.strategies.length || engine.providers.length) && isMonitorDue(engine, t)) onChange(runMonitoring(engine, t, "scheduled").state);
  }, [engine, onChange]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const evaluations = useMemo(() => rankStrategies(engine.strategies, engine.policy, now, engine.weights), [engine.strategies, engine.policy, engine.weights, now]);
  const openAlerts = engine.alerts.filter((a) => !a.resolvedAt && !a.acknowledgedAt).length;

  return (
    <section id="engine" className="section-block engine" aria-label="Copy trading intelligence engine">
      <div className="section-heading"><div><p className="eyebrow">INTELLIGENCE ENGINE</p><h2>Multi-provider research, allocation &amp; risk</h2></div>
        <span className="section-note">{engine.strategies.length} strategies · {engine.providers.length} tracked providers · {openAlerts} open alert{openAlerts === 1 ? "" : "s"}</span></div>
      <Notice tone="info"><strong>What this engine does:</strong> scores the strategies you record, proposes small allocations within your limits, monitors risk across platforms, and keeps an audit trail. <strong>What it does not do:</strong> it does not move money, enroll you in copy trading, pause a trader, or read exchange accounts. Every platform action happens on the platform itself, and statuses you record are your confirmations, not GEM verifications. Scores and simulations are not predictions or guarantees.</Notice>
      <div className="engine-tabs" role="tablist" aria-label="Engine sections">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} aria-controls={`engine-panel-${id}`} id={`engine-tab-${id}`} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}{id === "risk" && openAlerts > 0 ? <span className="tab-badge">{openAlerts}</span> : null}</button>)}
      </div>
      <div role="tabpanel" id={`engine-panel-${tab}`} aria-labelledby={`engine-tab-${tab}`} className="engine-panel">
        {tab === "providers" && <ProvidersTab engine={engine} onChange={onChange} now={now} evaluations={evaluations} />}
        {tab === "opportunities" && <OpportunitiesTab engine={engine} onChange={onChange} evaluations={evaluations} manualTraders={manualTraders} now={now} />}
        {tab === "intelligence" && <IntelligenceTab engine={engine} onChange={onChange} evaluations={evaluations} />}
        {tab === "allocation" && <AllocationTab engine={engine} onChange={onChange} evaluations={evaluations} now={now} />}
        {tab === "risk" && <RiskTab engine={engine} onChange={onChange} evaluations={evaluations} now={now} />}
        {tab === "monitoring" && <MonitoringTab engine={engine} onChange={onChange} />}
        {tab === "lab" && <LabTab engine={engine} onChange={onChange} />}
        {tab === "wallets" && <WalletsTab />}
      </div>
    </section>
  );
}

// ---- A · Providers -----------------------------------------------------------

function ProvidersTab({ engine, onChange, now, evaluations }: { engine: EngineState; onChange: EngineChange; now: Date; evaluations: StrategyEvaluation[] }) {
  const providers = allProviders(engine.customProviders);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", url: "https://", markets: "", minAllocationUsd: "", feeNotes: "" });
  const [message, setMessage] = useState("");

  function addCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !/^https:\/\/[^\s]+\.[^\s]+/.test(form.url)) { setMessage("Enter a name and the provider's official https:// address."); return; }
    const min = form.minAllocationUsd.trim() === "" ? null : Number(form.minAllocationUsd);
    if (min !== null && (!Number.isFinite(min) || min < 0)) { setMessage("Minimum allocation must be a non-negative number."); return; }
    const def = createCustomProvider({ name: form.name, url: form.url.trim(), markets: form.markets.split(",").map((m) => m.trim()).filter(Boolean).slice(0, 20), minAllocationUsd: min, feeNotes: form.feeNotes.slice(0, 500) });
    if (providers.some((p) => p.id === def.id)) { setMessage("A provider with this name already exists."); return; }
    if (engine.customProviders.length >= ENGINE_LIMITS.providers) { setMessage("Provider limit reached."); return; }
    onChange({ ...engine, customProviders: [...engine.customProviders, def] }, { action: "provider_added", detail: `Added manual provider ${def.name} (${def.url}).` });
    setForm({ name: "", url: "https://", markets: "", minAllocationUsd: "", feeNotes: "" });
    setAdding(false);
    setMessage(`${def.name} added as a manual provider.`);
  }

  return (
    <div className="engine-stack">
      <div className="engine-summary-grid">
        {providers.map((p) => {
          const account = engine.providers.find((a) => a.providerId === p.id) ?? null;
          return <ProviderCard key={p.id} def={p} account={account} engine={engine} onChange={onChange} now={now} evaluations={evaluations} />;
        })}
      </div>
      {message && <p className="form-message" role="status">{message}</p>}
      {adding ? (
        <form className="engine-form" onSubmit={addCustom}>
          <h3>Add a provider (manual)</h3>
          <p className="muted">Custom providers have no integration: you record every status and figure. Use only the provider&apos;s official address.</p>
          <label>Name<input required maxLength={80} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Official URL<input required type="url" maxLength={500} value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></label>
          <label>Markets (comma separated)<input maxLength={300} value={form.markets} onChange={(e) => setForm({ ...form, markets: e.target.value })} placeholder="crypto futures, FX" /></label>
          <label>Minimum copy amount (USD, if known)<input type="number" min="0" step="any" value={form.minAllocationUsd} onChange={(e) => setForm({ ...form, minAllocationUsd: e.target.value })} /></label>
          <label className="span-2">Fees / profit share notes<input maxLength={500} value={form.feeNotes} onChange={(e) => setForm({ ...form, feeNotes: e.target.value })} /></label>
          <div className="engine-actions"><button type="submit" className="primary-btn">Add provider</button><button type="button" className="secondary-btn" onClick={() => setAdding(false)}>Cancel</button></div>
        </form>
      ) : <button type="button" className="secondary-btn" onClick={() => setAdding(true)}>+ Add another provider</button>}
    </div>
  );
}

function ProviderCard({ def, account, engine, onChange, now, evaluations }: { def: ProviderDefinition; account: ProviderAccount | null; engine: EngineState; onChange: EngineChange; now: Date; evaluations: StrategyEvaluation[] }) {
  const [to, setTo] = useState<ProviderStatus | "">("");
  const [note, setNote] = useState("");
  const [strategyId, setStrategyId] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const strategies = engine.strategies.filter((s) => s.providerId === def.id);
  const status = account ? effectiveStatus(account, now, engine.policy.staleAfterHours) : null;

  const save = (next: ProviderAccount, action: string, detail: string) => onChange({ ...engine, providers: engine.providers.map((a) => (a.providerId === def.id ? next : a)) }, { action, detail });

  function track() {
    onChange({ ...engine, providers: [...engine.providers, newProviderAccount(def, new Date().toISOString())] }, { action: "provider_tracked", detail: `Started tracking ${def.name}.` });
  }
  function untrack() {
    if (!account) return;
    if (!window.confirm(`Stop tracking ${def.name} in GEM? This removes its status history and recorded amounts from GEM only; nothing changes on ${def.name}.`)) return;
    onChange({ ...engine, providers: engine.providers.filter((a) => a.providerId !== def.id) }, { action: "provider_untracked", detail: `Stopped tracking ${def.name}.` });
  }
  function applyTransition(e: React.FormEvent) {
    e.preventDefault();
    if (!account || !to) return;
    const r = transitionStatus(account, to, { at: new Date().toISOString(), evidence: "user_attested", note, strategyId: strategyId || null });
    if (!r.ok) { setError(r.error); return; }
    save(r.account, "status_changed", `${def.name}: ${STATUS_LABELS[account.status]} → ${STATUS_LABELS[to]} (user-attested: ${note.trim()})`);
    setTo(""); setNote(""); setError("");
  }
  function updateFigures(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!account) return;
    const f = new FormData(e.currentTarget);
    const read = (k: string) => { const v = String(f.get(k) ?? "").trim(); return v === "" ? null : Number(v); };
    const capital = read("capital"), allocated = read("allocated") ?? 0, min = read("min"), cost = read("cost") ?? 0;
    if ([capital ?? 0, allocated, min ?? 0, cost].some((v) => !Number.isFinite(v) || v < 0)) { setError("Amounts must be non-negative numbers."); return; }
    if (allocated > 0 && !account.selectedStrategyId) { setError("Record which trader you copy (Trader selected) before recording an allocated amount."); return; }
    const at = new Date().toISOString();
    save({ ...account, availableCapital: capital === null ? null : { amount: capital, currency: "USD", observedAt: at, evidence: "user_attested" }, allocatedUsd: allocated, minAllocationUsd: min, fixedCostUsd: cost, lastSyncAt: at, notes: String(f.get("notes") ?? "").slice(0, 1000) },
      "provider_figures_updated", `${def.name}: available ${capital ?? "unknown"}, allocated ${allocated}, minimum ${min ?? "unknown"}, fixed cost ${cost} (user-entered).`);
    setError("");
  }

  const selected = account?.selectedStrategyId ? engine.strategies.find((s) => s.id === account.selectedStrategyId) : null;
  const selectedEval = selected ? evaluations.find((e) => e.strategyId === selected.id) : null;
  return (
    <article className="engine-card">
      <div className="engine-card-head">
        <div><h3>{def.name}</h3><span className="cell-sub">{def.platformType.replace("_", " ")} · {def.markets.join(", ") || "markets not recorded"}</span></div>
        {status ? <Pill tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABELS[status]}</Pill> : <Pill>Not tracked</Pill>}
      </div>
      <p className="cell-sub">Integration: <strong>{def.integration === "guided_native" ? "Guided native workflow" : def.integration === "manual" ? "Manual" : def.integration}</strong> · Activation and pausing happen on {def.name}.</p>
      <div className="engine-links"><a href={def.url} target="_blank" rel="noreferrer">Official site ↗</a>{def.copyUrl !== def.url && <a href={def.copyUrl} target="_blank" rel="noreferrer">Copy trading ↗</a>}</div>
      {account && <>
        <p className="cell-sub">{statusProvenance(account)} Last update {when(account.lastSyncAt)}.</p>
        <dl className="engine-dl">
          <div><dt>Available</dt><dd>{account.availableCapital ? usd(account.availableCapital.amount) : "unknown"}</dd></div>
          <div><dt>Allocated</dt><dd>{usd(account.allocatedUsd)}</dd></div>
          <div><dt>Minimum</dt><dd>{account.minAllocationUsd === null ? "unknown" : usd(account.minAllocationUsd)}</dd></div>
          <div><dt>Trader</dt><dd>{selected ? <>{selected.name}{selectedEval && <span className="cell-sub">score {selectedEval.score}{selectedEval.eligible ? "" : " · fails policy"}</span>}</> : "none"}</dd></div>
        </dl>
        {status === "DATA_STALE" && <Notice tone="bad">Figures are older than {engine.policy.staleAfterHours} hours. Open {def.name} and update them.</Notice>}
        <form className="engine-inline-form" onSubmit={applyTransition}>
          <label>Record a status change<select value={to} onChange={(e) => { setTo(e.target.value as ProviderStatus); setError(""); }}><option value="">Choose…</option>{allowedTransitions(account.status).map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></label>
          {to && STATUS_EVIDENCE_PROMPT[to] && <p className="field-hint">Only record this if: {STATUS_EVIDENCE_PROMPT[to]}</p>}
          {to === "TRADER_SELECTED" && <label>Trader / strategy<select required value={strategyId} onChange={(e) => setStrategyId(e.target.value)}><option value="">Choose…</option>{strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{!strategies.length && <span className="field-hint">Add the trader in Opportunities first.</span>}</label>}
          {to && <label>What you saw on {def.name}<input maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. My copy trading page lists the trader as active" /></label>}
          {to && <button type="submit" className="primary-btn">Record status</button>}
        </form>
        {error && <p className="form-message error" role="alert">{error}</p>}
        <button type="button" className="review-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide details" : "Update figures, guide & history"}</button>
        {open && <div className="engine-stack">
          <form className="engine-form compact" onSubmit={updateFigures}>
            <label>Available capital (USD)<input name="capital" type="number" min="0" step="any" defaultValue={account.availableCapital?.amount ?? ""} /></label>
            <label>Allocated to copying (USD)<input name="allocated" type="number" min="0" step="any" defaultValue={account.allocatedUsd || ""} /></label>
            <label>Minimum copy amount (USD)<input name="min" type="number" min="0" step="any" defaultValue={account.minAllocationUsd ?? ""} /></label>
            <label>Fixed cost per allocation (USD)<input name="cost" type="number" min="0" step="any" defaultValue={account.fixedCostUsd || ""} /></label>
            <label className="span-2">Notes<input name="notes" maxLength={1000} defaultValue={account.notes} /></label>
            <div className="engine-actions"><button type="submit" className="primary-btn">Save figures I see on {def.name} now</button></div>
          </form>
          <div><strong>Activation guide</strong><ol className="engine-steps">{def.activationSteps.map((s) => <li key={s}>{s}</li>)}</ol></div>
          <div><strong>How to pause</strong><ul className="engine-steps">{def.pauseSteps.map((s) => <li key={s}>{s}</li>)}</ul></div>
          <div><strong>Capabilities</strong><ul className="engine-caps">{Object.entries(def.capabilities).map(([k, v]) => <li key={k}><span>{k.replace(/_/g, " ")}</span><Pill tone={v === "supported" ? "good" : "neutral"}>{v.replace("_", " ")}</Pill></li>)}</ul></div>
          <div><strong>Limitations</strong><ul className="engine-steps">{def.limitations.map((s) => <li key={s}>{s}</li>)}</ul><p className="cell-sub">Fees: {def.feeNotes || "not recorded"}</p></div>
          <div><strong>Status history</strong><ul className="engine-history">{[...account.history].reverse().slice(0, 12).map((h, i) => <li key={i}><span>{when(h.at)}</span> {STATUS_LABELS[h.status]} <span className="cell-sub">{h.evidence === "user_attested" ? "you confirmed" : h.evidence}: {h.note}</span></li>)}</ul></div>
          <button type="button" className="danger-btn" onClick={untrack}>Stop tracking in GEM</button>
        </div>}
      </>}
      {!account && <button type="button" className="primary-btn" onClick={track}>Track {def.name}</button>}
    </article>
  );
}

// ---- B · Opportunities -------------------------------------------------------

const emptyStrategyForm = { providerId: "btcc", name: "", externalId: "", profileUrl: "", assets: "", style: "", maxLeverage: "", profitSharePct: "", minCopyUsd: "", roiPct: "", periodDays: "90", maxDrawdownPct: "", winRatePct: "", trades: "", source: "provider_profile" as DataSource, csv: "", basis: "gross" as "gross" | "net" };

function OpportunitiesTab({ engine, onChange, evaluations, manualTraders, now }: { engine: EngineState; onChange: EngineChange; evaluations: StrategyEvaluation[]; manualTraders: Trader[]; now: Date }) {
  const [form, setForm] = useState(emptyStrategyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const providers = allProviders(engine.customProviders);
  const byId = new Map(engine.strategies.map((s) => [s.id, s]));
  const hasSample = engine.strategies.some((s) => s.id.startsWith(SAMPLE_PREFIX));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = (v: string) => (v.trim() === "" ? null : Number(v));
    const lev = n(form.maxLeverage), share = n(form.profitSharePct), min = n(form.minCopyUsd);
    if (!form.name.trim()) return setMessage("Enter the trader or strategy name.");
    if ([lev, share, min].some((v) => v !== null && (!Number.isFinite(v) || v < 0)) || (share !== null && share > 100) || (lev !== null && lev > 500)) return setMessage("Leverage, profit share, and minimum must be valid non-negative numbers.");
    if (form.profileUrl && !/^https:\/\//.test(form.profileUrl)) return setMessage("Profile link must start with https://.");
    const at = new Date().toISOString();
    const id = editing ?? newId("strat");
    const existing = editing ? byId.get(editing) : undefined;
    let series = existing?.series ?? null;
    const warnings: string[] = [];
    if (form.csv.trim()) {
      const parsed = parseSeriesCsv(form.csv, { source: "imported_csv", collectedAt: at, basis: form.basis, maxPoints: ENGINE_LIMITS.seriesPoints });
      if (!parsed.ok) return setMessage(`History not saved: ${parsed.error}`);
      series = parsed.series;
      warnings.push(...parsed.warnings);
    }
    const values: Record<string, number> = {};
    for (const k of ["roiPct", "periodDays", "maxDrawdownPct", "winRatePct", "trades"] as const) {
      const v = n(form[k]);
      if (v !== null) {
        if (!Number.isFinite(v) || (k !== "roiPct" && v < 0) || ((k === "maxDrawdownPct" || k === "winRatePct") && v > 100) || (k === "trades" && !Number.isInteger(v))) return setMessage(`Check ${k}.`);
        values[k] = v;
      }
    }
    const observations = [...(existing?.observations ?? [])];
    if (Object.keys(values).length) observations.push({ id: newId("obs"), strategyId: id, source: form.source, method: form.source === "provider_profile" ? "Transcribed from the provider's trader profile" : "Entered by user", collectedAt: at, confidence: form.source === "provider_profile" ? 0.7 : 0.5, verified: false, sourceUrl: form.profileUrl || null, values });
    const strategy: Strategy = { id, providerId: form.providerId, name: form.name.trim().slice(0, 120), externalId: form.externalId.trim().slice(0, 120), profileUrl: form.profileUrl.trim() || null, assets: form.assets.split(",").map((a) => a.trim().toUpperCase()).filter(Boolean).slice(0, 30), style: form.style.trim().slice(0, 80), maxLeverage: lev, profitSharePct: share, minCopyUsd: min, series, observations: observations.slice(-ENGINE_LIMITS.observationsPerStrategy), createdAt: existing?.createdAt ?? at };
    if (!editing && engine.strategies.length >= ENGINE_LIMITS.strategies) return setMessage("Strategy limit reached.");
    const points = engine.strategies.filter((s) => s.id !== id).reduce((a, s) => a + (s.series?.returns.length ?? 0), 0) + (series?.returns.length ?? 0);
    if (points > ENGINE_LIMITS.totalPoints) return setMessage(`Total history would exceed ${ENGINE_LIMITS.totalPoints} points; remove older strategies first.`);
    onChange({ ...engine, strategies: editing ? engine.strategies.map((s) => (s.id === id ? strategy : s)) : [...engine.strategies, strategy] }, { action: editing ? "strategy_updated" : "strategy_added", detail: `${strategy.name} on ${strategy.providerId}${series ? ` with ${series.returns.length} periods (${series.source})` : ""}${Object.keys(values).length ? `; summary from ${form.source}` : ""}.` });
    setForm(emptyStrategyForm); setEditing(null);
    setMessage(`${strategy.name} saved.${warnings.length ? " " + warnings.join(" ") : ""}`);
  }

  function edit(s: Strategy) {
    const o = s.observations.at(-1)?.values ?? {};
    const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
    setEditing(s.id);
    setForm({ ...emptyStrategyForm, providerId: s.providerId, name: s.name, externalId: s.externalId, profileUrl: s.profileUrl ?? "", assets: s.assets.join(", "), style: s.style, maxLeverage: str(s.maxLeverage), profitSharePct: str(s.profitSharePct), minCopyUsd: str(s.minCopyUsd), roiPct: str(o.roiPct), periodDays: str(o.periodDays), maxDrawdownPct: str(o.maxDrawdownPct), winRatePct: str(o.winRatePct), trades: str(o.trades) });
    setMessage(`Editing ${s.name}. New summary figures are added as a new dated observation; leave the history box empty to keep the existing history.`);
  }

  function remove(s: Strategy) {
    if (!window.confirm(`Remove ${s.name} from the engine? Its history and score record are deleted from GEM.`)) return;
    onChange({ ...engine, strategies: engine.strategies.filter((x) => x.id !== s.id), providers: engine.providers.map((a) => (a.selectedStrategyId === s.id ? { ...a, selectedStrategyId: null } : a)) }, { action: "strategy_removed", detail: s.name });
  }

  function loadSample() {
    const sample = simulatedStrategies(new Date());
    onChange({ ...engine, strategies: [...engine.strategies.filter((s) => !s.id.startsWith(SAMPLE_PREFIX)), ...sample] }, { action: "sample_loaded", detail: `Loaded ${sample.length} SIMULATED strategies for testing.` });
    setMessage("Loaded 6 simulated strategies. They are labelled SIM, are excluded from real allocations, and can be used in the Simulation lab.");
  }
  function removeSample() {
    onChange({ ...engine, strategies: engine.strategies.filter((s) => !s.id.startsWith(SAMPLE_PREFIX)), providers: engine.providers.map((a) => (a.selectedStrategyId?.startsWith(SAMPLE_PREFIX) ? { ...a, selectedStrategyId: null } : a)) }, { action: "sample_removed", detail: "Removed simulated strategies." });
  }
  function importTraders() {
    const at = new Date().toISOString();
    const existing = new Set(engine.strategies.map((s) => `${s.providerId}::${s.name.toLowerCase()}`));
    const venueToProvider: Record<string, string> = { BTCC: "btcc", Bitget: "bitget", MT5: "mt5" };
    const added: Strategy[] = manualTraders.filter((t) => venueToProvider[t.venue] && !existing.has(`${venueToProvider[t.venue]}::${t.name.toLowerCase()}`)).map((t) => {
      const id = newId("strat");
      const days = Number.parseInt(t.period, 10);
      return { id, providerId: venueToProvider[t.venue], name: t.name, externalId: "", profileUrl: null, assets: [], style: "", maxLeverage: null, profitSharePct: null, minCopyUsd: null, series: null, createdAt: at,
        observations: [{ id: newId("obs"), strategyId: id, source: "user_entered", method: "Imported from the trader comparison table", collectedAt: at, confidence: 0.5, verified: false, sourceUrl: null, values: { roiPct: t.roi, maxDrawdownPct: t.drawdown, winRatePct: t.winRate, trades: t.trades, ...(Number.isFinite(days) ? { periodDays: days } : {}) } }] };
    });
    if (!added.length) return setMessage("No new BTCC/Bitget/MT5 trader records to import.");
    onChange({ ...engine, strategies: [...engine.strategies, ...added].slice(0, ENGINE_LIMITS.strategies) }, { action: "traders_imported", detail: `Imported ${added.length} trader record(s) as summary-only strategies.` });
    setMessage(`Imported ${added.length} trader record(s). Add each one's return history and fees to make it eligible for allocation.`);
  }

  return (
    <div className="engine-stack">
      <Notice tone="info"><strong>Research sources.</strong> Live: none — no provider exposes a verified data feed to GEM yet. Available now: figures you transcribe from official trader profiles, return/equity history you import as CSV, and clearly labelled simulated data for testing. Social posts or tips are leads only; record them here after checking the trader on the official platform.</Notice>
      <div className="engine-actions">
        <button type="button" className="secondary-btn" onClick={importTraders} disabled={!manualTraders.length}>Import from trader comparison ({manualTraders.length})</button>
        {hasSample ? <button type="button" className="secondary-btn" onClick={removeSample}>Remove simulated sample</button> : <button type="button" className="secondary-btn" onClick={loadSample}>Load simulated sample (testing)</button>}
      </div>
      <div className="table-wrap"><table>
        <thead><tr><th>Rank</th><th>Strategy</th><th>Score</th><th>Net ann.</th><th>Max DD</th><th>Sortino</th><th>Data</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {!evaluations.length && <tr><td colSpan={9} className="empty-cell">No strategies yet. Add a trader you reviewed on BTCC, Bitget, or MT5 below, or load the simulated sample to see how the engine works.</td></tr>}
          {evaluations.map((e, i) => {
            const s = byId.get(e.strategyId)!;
            const prov = providers.find((p) => p.id === s.providerId);
            return <tr key={s.id}>
              <td>{i + 1}</td>
              <td><strong>{s.name}</strong>{e.simulated && <> <Pill tone="sim">SIMULATED</Pill></>}<span className="cell-sub">{prov?.name ?? s.providerId} · {s.assets.join(", ") || "assets?"}{s.profileUrl && <> · <a href={s.profileUrl} target="_blank" rel="noreferrer">profile ↗</a></>}</span></td>
              <td><span className="score">{e.score}</span> <span className="cell-sub">grade {e.grade}</span></td>
              <td>{pct(e.net?.annualizedReturnPct)}</td>
              <td>{pct(e.net?.maxDrawdownPct ?? s.observations.at(-1)?.values.maxDrawdownPct)}</td>
              <td>{num(e.net?.sortino)}</td>
              <td>{Math.round(e.confidence * 100)}%<span className="cell-sub">{s.series ? SOURCE_LABELS[s.series.source] : s.observations.at(-1) ? SOURCE_LABELS[s.observations.at(-1)!.source] : "none"}</span></td>
              <td>{e.eligible ? <Pill tone="good">Eligible</Pill> : <Pill tone="bad">Not eligible</Pill>}<span className="cell-sub wrap">{e.ineligibleReasons[0] ?? ""}</span></td>
              <td><div className="row-actions"><button type="button" className="review-btn" onClick={() => edit(s)} aria-label={`Edit ${s.name}`}>Edit</button><button type="button" className="danger-btn" onClick={() => remove(s)} aria-label={`Remove ${s.name}`}>Remove</button></div></td>
            </tr>;
          })}
        </tbody>
      </table></div>
      <form className="engine-form" onSubmit={submit}>
        <h3>{editing ? "Update strategy" : "Record a trader / strategy"}</h3>
        <p className="muted">Copy the figures from the trader&apos;s official profile. History (CSV) is what makes a strategy eligible: drawdown duration, volatility, risk ratios, and correlation all need it.</p>
        <label>Provider<select value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })}>{providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Trader / strategy name<input required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label>Profile ID<input maxLength={120} value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} /></label>
        <label>Profile link (https)<input type="url" maxLength={500} value={form.profileUrl} onChange={(e) => setForm({ ...form, profileUrl: e.target.value })} /></label>
        <label>Assets traded<input maxLength={300} value={form.assets} onChange={(e) => setForm({ ...form, assets: e.target.value })} placeholder="BTC, ETH" /></label>
        <label>Style<input maxLength={80} value={form.style} onChange={(e) => setForm({ ...form, style: e.target.value })} placeholder="trend, scalping, grid…" /></label>
        <label>Max leverage (x)<input type="number" min="0" step="any" value={form.maxLeverage} onChange={(e) => setForm({ ...form, maxLeverage: e.target.value })} /></label>
        <label>Profit share (%)<input type="number" min="0" max="100" step="any" value={form.profitSharePct} onChange={(e) => setForm({ ...form, profitSharePct: e.target.value })} /></label>
        <label>Minimum copy (USD)<input type="number" min="0" step="any" value={form.minCopyUsd} onChange={(e) => setForm({ ...form, minCopyUsd: e.target.value })} /></label>
        <fieldset className="span-3"><legend>Profile summary (optional, dated observation)</legend>
          <label>ROI (%)<input type="number" step="any" value={form.roiPct} onChange={(e) => setForm({ ...form, roiPct: e.target.value })} /></label>
          <label>Over days<input type="number" min="0" step="1" value={form.periodDays} onChange={(e) => setForm({ ...form, periodDays: e.target.value })} /></label>
          <label>Max drawdown (%)<input type="number" min="0" max="100" step="any" value={form.maxDrawdownPct} onChange={(e) => setForm({ ...form, maxDrawdownPct: e.target.value })} /></label>
          <label>Win rate (%)<input type="number" min="0" max="100" step="any" value={form.winRatePct} onChange={(e) => setForm({ ...form, winRatePct: e.target.value })} /></label>
          <label>Trades<input type="number" min="0" step="1" value={form.trades} onChange={(e) => setForm({ ...form, trades: e.target.value })} /></label>
          <label>Source<select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value as DataSource })}><option value="provider_profile">Transcribed from official profile</option><option value="user_entered">My own estimate</option></select></label>
        </fieldset>
        <fieldset className="span-3"><legend>Return history (CSV)</legend>
          <label className="span-2">Paste CSV with a header <code>date,return_pct</code> (period % return) or <code>date,equity</code>; dates YYYY-MM-DD, oldest first
            <textarea rows={4} value={form.csv} onChange={(e) => setForm({ ...form, csv: e.target.value })} placeholder={"date,return_pct\n2026-09-01,0.8\n2026-09-02,-0.3"} /></label>
          <label>Returns are<select value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as "gross" | "net" })}><option value="gross">Gross (before profit share)</option><option value="net">Net (already after fees)</option></select></label>
          <label>…or load a .csv file<input type="file" accept=".csv,text/csv" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > 200_000) { setMessage("CSV is too large (max 200 KB)."); return; }
            const text = await f.text();
            setForm((old) => ({ ...old, csv: text }));
          }} /></label>
        </fieldset>
        <div className="engine-actions"><button type="submit" className="primary-btn">{editing ? "Save changes" : "Add strategy"}</button>{editing && <button type="button" className="secondary-btn" onClick={() => { setEditing(null); setForm(emptyStrategyForm); setMessage(""); }}>Cancel</button>}</div>
      </form>
      {message && <p className="form-message" role="status">{message}</p>}
      <p className="footnote">Evaluated {when(now.toISOString())}. Figures are as recorded; GEM does not fetch them from providers.</p>
    </div>
  );
}
