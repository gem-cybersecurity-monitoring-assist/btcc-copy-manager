"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditEvent } from "@/lib/types";
import type { LiveConfigurationStatus, LiveDirection, LiveOrderIntent, PreparedLiveOrder } from "@/lib/live-types";
import { PwaRegister } from "./pwa-register";
import { OpportunitiesDashboard } from "./opportunities-dashboard";
import { AutonomyDashboard } from "./autonomy-dashboard";

type View = "overview" | "live" | "positions" | "connection" | "audit" | "opportunities" | "autonomy";
type PositionPayload = { positions?: Array<Record<string, unknown>>; error?: string; [key: string]: unknown };

const nav: { id: View; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "live", label: "Live order", icon: "↗" },
  { id: "positions", label: "Positions", icon: "◫" },
  { id: "connection", label: "Connection", icon: "⛓" },
  { id: "audit", label: "Audit log", icon: "≡" },
  { id: "opportunities", label: "Opportunities", icon: "◈" },
  { id: "autonomy", label: "AI Copy Manager", icon: "✧" }
];

const initialStatus: LiveConfigurationStatus = {
  ready: false, executionEnabled: false, adapterMode: "disabled", missing: [], blockers: ["Checking deployment configuration…"],
  policy: { maxLeverage: 5, maxOrderNotionalUsdt: 10, stopLossRequired: true, withdrawals: false }
};

function now() { return new Date().toISOString(); }
function audit(action: string, detail: string, outcome: AuditEvent["outcome"] = "INFO"): AuditEvent { return { id: crypto.randomUUID(), at: now(), action, detail, outcome }; }
function numeric(value: string) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function money(value: number) { return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`; }
function Badge({ state }: { state: string }) { return <span className={`badge badge-${state.toLowerCase().replaceAll(" ", "-")}`}>{state}</span>; }
function Metric({ label, value, tone = "" }: { label: string; value: string; tone?: string }) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong></div>; }

export function ManagerShell() {
  const [view, setView] = useState<View>("overview");
  const [status, setStatus] = useState<LiveConfigurationStatus>(initialStatus);
  const [paused, setPaused] = useState(false);
  const [notice, setNotice] = useState("");
  const [events, setEvents] = useState<AuditEvent[]>([audit("Live control room opened", "Live execution status requested; no order was submitted.")]);

  const refreshStatus = useCallback(async () => {
    try { const response = await fetch("/api/v1/live/status", { cache: "no-store" }); setStatus(await response.json() as LiveConfigurationStatus); }
    catch { setNotice("Could not read the deployment configuration."); }
  }, []);
  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => { try { const saved = localStorage.getItem("btcc-live-audit-v2"); if (saved) setEvents(JSON.parse(saved)); } catch { /* safe empty ledger */ } }, []);
  useEffect(() => { localStorage.setItem("btcc-live-audit-v2", JSON.stringify(events.slice(0, 100))); }, [events]);

  function record(action: string, detail: string, outcome: AuditEvent["outcome"] = "INFO") { setEvents((current) => [audit(action, detail, outcome), ...current]); }
  async function setKillSwitch(next: boolean) {
    const response = await fetch("/api/v1/live/kill-switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: next }) });
    if (!response.ok) { setNotice("Emergency control could not be changed."); return; }
    setPaused(next); record(next ? "Live submissions paused" : "Live submissions armed", next ? "Emergency stop blocks new orders from this browser." : "Live submissions re-armed; each order still requires confirmation.", next ? "BLOCK" : "PASS");
    setNotice(next ? "New live submissions are paused." : "Live submissions are armed.");
  }

  return <div className="app-shell"><PwaRegister />
    <aside className="sidebar" aria-label="Main navigation"><div className="brand"><span className="brand-mark">GM</span><div><strong>Live Manager</strong><small>BTCC execution control</small></div></div><nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}<button type="button" onClick={() => window.location.assign("/copy-trading")}><span>◇</span>Copy Center</button></nav><div className="side-status"><span className={`status-dot ${status.ready && !paused ? "" : "blocked"}`}/><div><strong>{paused ? "Emergency stop" : status.ready ? "Live ready" : "Activation blocked"}</strong><small>{status.ready ? "Two-step execution" : "Connector setup required"}</small></div></div></aside>
    <main><header className="topbar"><div><p className="eyebrow">GEM Enterprise / Live finance workspace</p><h1>{nav.find((item) => item.id === view)?.label}</h1></div><div className="top-actions"><Badge state={status.ready ? "LIVE READY" : "SETUP REQUIRED"}/><button className={`button ${paused ? "" : "danger-button"}`} onClick={() => void setKillSwitch(!paused)}>{paused ? "Re-arm live" : "Emergency stop"}</button></div></header>
      <div className="mobile-nav" aria-label="Mobile navigation">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}<button type="button" onClick={() => window.location.assign("/copy-trading")}><span>◇</span><small>Copy Center</small></button></div>
      {notice && <div className="notice" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
      {view === "overview" && <Overview status={status} paused={paused} goLive={() => setView("live")} goConnection={() => setView("connection")}/>} 
      {view === "live" && <LiveOrder status={status} paused={paused} record={record}/>} 
      {view === "positions" && <Positions status={status} record={record}/>} 
      {view === "connection" && <Connection status={status} refresh={refreshStatus}/>} 
      {view === "audit" && <Audit events={events}/>} 
      {view === "opportunities" && <OpportunitiesDashboard />}
      {view === "autonomy" && <AutonomyDashboard />}
    </main>
  </div>;
}

function Overview({ status, paused, goLive, goConnection }: { status: LiveConfigurationStatus; paused: boolean; goLive: () => void; goConnection: () => void }) {
  return <div className="page-grid"><section className="hero-card"><div><p className="eyebrow">Execution posture</p><div className="title-line"><h2>BTCC live futures control</h2><Badge state={paused ? "PAUSED" : status.ready ? "ARMED" : "BLOCKED"}/></div><p className="subtle">This version prepares and submits real BTCC futures orders only after the connector, trade permissions, limits, and exact two-step confirmation pass.</p></div><div className={`score ${status.ready && !paused ? "score-low" : "score-critical"}`}><span>Activation</span><strong>{status.ready && !paused ? "ON" : "OFF"}</strong><small>{status.blockers.length} blocker{status.blockers.length === 1 ? "" : "s"}</small></div></section>
    <section className="metric-grid"><Metric label="Execution mode" value={status.ready ? "BTCC LIVE" : "DISABLED"}/><Metric label="Maximum leverage" value={`${status.policy.maxLeverage}×`}/><Metric label="Maximum order notional" value={money(status.policy.maxOrderNotionalUsdt)}/><Metric label="Withdrawals" value="NOT IMPLEMENTED"/></section>
    <section className="panel span-2"><div className="panel-head"><div><p className="eyebrow">Live activation</p><h2>{status.ready ? "The order console is ready" : "Finish the connector configuration"}</h2></div><button className="button" onClick={status.ready ? goLive : goConnection}>{status.ready ? "Open live order" : "View activation steps"}</button></div>{status.blockers.length > 0 ? <ul className="flag-list">{status.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="subtle">Credentials are present, the live flag is enabled, and deterministic limits will be applied to every order.</p>}</section>
    <section className="panel"><p className="eyebrow">Native copy trading</p><h2>Managed inside BTCC</h2><p className="subtle">BTCC documents futures order APIs, but no current follow/unfollow copy-trader endpoint was found. Existing native copy enrollment must still be changed inside BTCC.</p></section>
    <section className="panel"><p className="eyebrow">Live API execution</p><h2>Built for real orders</h2><ol className="steps"><li>Prepare exact symbol, size, price, leverage, SL and TP.</li><li>Pass deterministic limits.</li><li>Review the final notional and margin.</li><li>Type the execution phrase and submit.</li></ol></section></div>;
}

function Field({ label, value, setValue, type = "text", suffix }: { label: string; value: string; setValue: (value: string) => void; type?: "text" | "number"; suffix?: string }) { return <label className="field"><span>{label}</span><div className="input-wrap"><input type={type} value={value} onChange={(event) => setValue(event.target.value)} step={type === "number" ? "any" : undefined}/>{suffix && <em>{suffix}</em>}</div></label>; }

function LiveOrder({ status, paused, record }: { status: LiveConfigurationStatus; paused: boolean; record: (action: string, detail: string, outcome?: AuditEvent["outcome"]) => void }) {
  const [symbol, setSymbol] = useState("BTCUSDT"); const [direction, setDirection] = useState<LiveDirection>("LONG");
  const [volume, setVolume] = useState("0.0001"); const [price, setPrice] = useState(""); const [leverage, setLeverage] = useState(String(status.policy.maxLeverage));
  const [stopLoss, setStopLoss] = useState(""); const [takeProfit, setTakeProfit] = useState(""); const [prepared, setPrepared] = useState<PreparedLiveOrder | null>(null);
  const [phrase, setPhrase] = useState(""); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  function intent(): LiveOrderIntent { return { idempotencyKey: `${Date.now()}-${crypto.randomUUID()}`, symbol: symbol.trim(), direction, volume: numeric(volume), referencePrice: numeric(price), leverage: numeric(leverage), stopLoss: numeric(stopLoss), takeProfit: numeric(takeProfit) }; }
  async function prepare() { setBusy(true); setMessage(""); setPrepared(null); const response = await fetch("/api/v1/live/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(intent()) }); const data = await response.json(); setBusy(false); if (!response.ok) { setMessage(data.error || "Preparation failed."); record("Live order blocked", data.error || "Preparation failed.", "BLOCK"); return; } setPrepared(data); record("Live order prepared", `${direction} ${volume} ${symbol}; awaiting exact confirmation.`, "PASS"); }
  async function execute() { if (!prepared || phrase !== prepared.confirmationPhrase) return; setBusy(true); setMessage(""); const response = await fetch("/api/v1/live/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmationToken: prepared.confirmationToken, confirmationPhrase: phrase }) }); const data = await response.json(); setBusy(false); if (!response.ok) { setMessage(data.error || "Execution failed."); record("Live execution rejected", data.error || "Execution failed.", "BLOCK"); return; } setMessage(`Order submitted at ${new Date(data.submittedAt).toLocaleTimeString()}.`); record("LIVE ORDER SUBMITTED", `${direction} ${volume} ${symbol}; idempotency ${data.idempotencyKey}.`, "PASS"); setPrepared(null); setPhrase(""); }
  return <div className="page-grid review-grid"><section className="panel span-2"><div className="panel-head"><div><p className="eyebrow">Real funds and real position</p><h2>Prepare a live BTCC futures order</h2></div><Badge state={paused ? "PAUSED" : status.ready ? "LIVE" : "BLOCKED"}/></div><div className="critical-callout">Use the exact product name returned by BTCC’s symbol list. Preparing does not submit; the final button does.</div><div className="form-grid live-form"><Field label="Exact BTCC API symbol" value={symbol} setValue={setSymbol}/><label className="field"><span>Direction</span><select value={direction} onChange={(event) => setDirection(event.target.value as LiveDirection)}><option value="LONG">Long / Buy</option><option value="SHORT">Short / Sell</option></select></label><Field label="Volume" type="number" value={volume} setValue={setVolume}/><Field label="Reference price" type="number" suffix="USDT" value={price} setValue={setPrice}/><Field label="Leverage" type="number" suffix="×" value={leverage} setValue={setLeverage}/><Field label="Stop-loss price" type="number" suffix="USDT" value={stopLoss} setValue={setStopLoss}/><Field label="Take-profit price" type="number" suffix="USDT" value={takeProfit} setValue={setTakeProfit}/></div><div className="form-actions"><button className="button" disabled={busy || paused || !status.ready} onClick={() => void prepare()}>{busy ? "Checking…" : "Prepare live order"}</button></div>{message && <div className="notice inline"><span>{message}</span></div>}</section>
    <section className="panel span-2"><p className="eyebrow">Second execution step</p>{prepared ? <><h2>Review the final live instruction</h2><div className="metric-grid confirm-grid"><Metric label="Notional" value={money(prepared.notionalUsdt)}/><Metric label="Estimated margin" value={money(prepared.estimatedMarginUsdt)}/><Metric label="Stop exposure" value={money(prepared.estimatedStopLossUsdt)}/><Metric label="Expires" value={new Date(prepared.expiresAt).toLocaleTimeString()}/></div><Field label={`Type: ${prepared.confirmationPhrase}`} value={phrase} setValue={setPhrase}/><button className="button danger-button execute-button" disabled={busy || paused || phrase !== prepared.confirmationPhrase} onClick={() => void execute()}>Submit real BTCC order</button></> : <p className="subtle">A signed two-minute execution token will appear here after the connector and order pass all checks.</p>}</section></div>;
}

function Positions({ status, record }: { status: LiveConfigurationStatus; record: (action: string, detail: string, outcome?: AuditEvent["outcome"]) => void }) {
  const [payload, setPayload] = useState<PositionPayload | null>(null); const [busy, setBusy] = useState(false);
  async function sync() { setBusy(true); const response = await fetch("/api/v1/live/positions", { cache: "no-store" }); const data = await response.json() as PositionPayload; setPayload(data); setBusy(false); record("Position sync", response.ok ? "Live BTCC position list refreshed." : data.error || "Sync failed.", response.ok ? "PASS" : "BLOCK"); }
  return <section className="panel"><div className="panel-head"><div><p className="eyebrow">Exchange truth</p><h2>Live BTCC positions</h2></div><button className="button" disabled={busy || !status.ready} onClick={() => void sync()}>{busy ? "Syncing…" : "Sync positions"}</button></div>{payload?.error && <div className="critical-callout">{payload.error}</div>}{payload?.positions?.length ? <div className="position-list">{payload.positions.map((position, index) => <article key={String(position.id || index)}><strong>{String(position.symbol || "Unknown symbol")}</strong><span>Volume {String(position.volume || 0)}</span><span>P&amp;L {String(position.profit || 0)}</span><Badge state={Number(position.status) === 1 ? "OPEN" : "CLOSED"}/></article>)}</div> : <p className="subtle">{status.ready ? "Press Sync positions to request the live account state." : "Complete the live connector before synchronizing positions."}</p>}</section>;
}

function Connection({ status, refresh }: { status: LiveConfigurationStatus; refresh: () => Promise<void> }) {
  const requirements = [["BTCC_API_BASE_URL", "Current trading REST base URL supplied by BTCC."], ["BTCC_API_KEY", "Trade-enabled API access key."], ["BTCC_SECRET_KEY", "Signing secret; server only."], ["BTCC_USERNAME", "Account login identifier; server only."], ["BTCC_PASSWORD", "Account password required by the documented login endpoint; server only."], ["BTCC_ACCOUNT_ID", "Authorized futures account ID."], ["LIVE_CONFIRMATION_SECRET", "Independent random secret for two-minute confirmation tokens."], ["BTCC_LIVE_EXECUTION", "Set exactly to true after every value above is verified."]];
  return <div className="page-grid"><section className="panel span-2"><div className="panel-head"><div><p className="eyebrow">Server-side connector</p><h2>Live activation checklist</h2></div><button className="button secondary" onClick={() => void refresh()}>Recheck configuration</button></div><p className="subtle">Do not paste credentials into chat. Add them through the deployment project’s encrypted environment settings, then redeploy.</p></section><section className="panel span-2 capability-list">{requirements.map(([name, detail]) => <div className="capability" key={name}><div><strong>{name}</strong><p>{detail}</p></div><Badge state={name === "BTCC_LIVE_EXECUTION" ? status.executionEnabled ? "READY" : "MISSING" : status.missing.includes(name) ? "MISSING" : "READY"}/></div>)}</section><section className="panel"><p className="eyebrow">Permission requirement</p><h2>Trade-enabled key</h2><p className="subtle">Your previously described read-only API key can synchronize data if BTCC permits it, but it cannot execute a live order. A trade-enabled key is a real activation requirement.</p></section><section className="panel"><p className="eyebrow">Permanent exclusion</p><h2>No withdrawal route</h2><p className="subtle">The application contains no withdrawal, transfer, deposit-address, or withdrawal-address API implementation.</p></section></div>;
}

function Audit({ events }: { events: AuditEvent[] }) { return <section className="panel audit-panel"><div className="panel-head"><div><p className="eyebrow">Local execution ledger</p><h2>Audit history</h2></div><Badge state="LOCAL"/></div><div className="audit-list">{events.map((item) => <article key={item.id}><span className={`audit-dot ${item.outcome.toLowerCase()}`}/><div><div className="audit-title"><strong>{item.action}</strong><Badge state={item.outcome}/></div><p>{item.detail}</p><time>{new Date(item.at).toLocaleString()}</time></div></article>)}</div></section>; }
