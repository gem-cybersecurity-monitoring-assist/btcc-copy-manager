"use client";

import { useCallback, useEffect, useState } from "react";
import { AUTOMATION_EVENT, inspectLocalAutomation, runLocalRiskReview } from "@/lib/browser-automation";
import { LiquidityPanel } from "@/components/liquidity-panel";
import { EconomyPanel } from "@/components/economy-panel";
import { TraderDiscoveryPanel } from "@/components/trader-discovery-panel";
import { CombinedDecisionPanel } from "@/components/combined-decision-panel";
import "./automation-center.css";

type BrowserState = ReturnType<typeof inspectLocalAutomation>;
type Service = { status: "checking" | "connected" | "unavailable"; message: string };
type OwnerConnections = { status: "checking" | "signed_out" | "unavailable" | "ready"; records: Array<{
  id: string; venue: string; status: string; lastVerifiedAt: string | null;
}>; limited: boolean };

const idle: BrowserState = { available: false, configured: false, strategyCount: 0, trackedProviders: 0,
  openAlerts: 0, intervalHours: 24, lastRunAt: null, summary: null, error: null };

function displayTime(value: string | null) {
  if (!value) return "No completed review";
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toLocaleString() : "Unknown";
}

export function AutomationCenter() {
  const [browser, setBrowser] = useState<BrowserState>(idle);
  const [ownerConnections, setOwnerConnections] = useState<OwnerConnections>({ status: "checking", records: [], limited: false });
  const [sentinel, setSentinel] = useState<Service>({ status: "checking", message: "Checking…" });
  const [agent, setAgent] = useState<Service>({ status: "checking", message: "Checking…" });
  const [market, setMarket] = useState<Service>({ status: "checking", message: "Checking…" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setBrowser(inspectLocalAutomation());
    setBusy(true);
    const checks = await Promise.allSettled([
      fetch("/api/v1/sentinel/health", { cache: "no-store" }),
      fetch("/api/agent", { cache: "no-store" }),
      fetch("/api/v1/market/overview", { cache: "no-store" }),
      fetch("/api/v1/ledger/connections", { cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(12_000) }),
    ]);
    const read = async (result: PromiseSettledResult<Response>): Promise<{ ok: boolean; body: Record<string, unknown> }> => {
      if (result.status !== "fulfilled") return { ok: false, body: {} };
      try { return { ok: result.value.ok, body: await result.value.json() as Record<string, unknown> }; }
      catch { return { ok: false, body: {} }; }
    };
    const [s, a, m, c] = await Promise.all(checks.map(read));
    const connectionCheck = checks[3];
    if (connectionCheck.status === "fulfilled" && connectionCheck.value.status === 401) {
      setOwnerConnections({ status: "signed_out", records: [], limited: false });
    } else if (connectionCheck.status === "fulfilled" && connectionCheck.value.ok) {
      try {
        const payload = c.body as {connections?: unknown; limited?: boolean};
        const records = Array.isArray(payload.connections) ? payload.connections.filter((x): x is OwnerConnections["records"][number] =>
          x && typeof x.id === "string" && typeof x.venue === "string" &&
          ["DISCONNECTED", "READ_ONLY", "VERIFIED", "PAUSED", "ERROR"].includes(x.status) &&
          (x.lastVerifiedAt === null || typeof x.lastVerifiedAt === "string")) : null;
        setOwnerConnections(records ? { status: "ready", records, limited: payload.limited === true } : { status: "unavailable", records: [], limited: false });
      } catch { setOwnerConnections({ status: "unavailable", records: [], limited: false }); }
    } else {
      setOwnerConnections({ status: "unavailable", records: [], limited: false });
    }
    setSentinel({ status: s.ok && s.body.connected === true ? "connected" : "unavailable",
      message: s.ok && s.body.connected === true ? "Service health verified" : "Persistent execution service not confirmed" });
    setAgent({ status: a.ok && a.body.configured === true && a.body.signedIn === true ? "connected" : "unavailable",
      message: a.ok && a.body.configured === true && a.body.signedIn === true ? "Agent available for signed-in session" : "In-app agent not active for this session" });
    setMarket({ status: m.ok && m.body.status === "available" ? "connected" : "unavailable",
      message: m.ok && m.body.status === "available" ? "Public reference prices available" : "Public market reference unavailable" });
    setBusy(false);
  }, []);

  useEffect(() => {
    void refresh();
    const update = () => setBrowser(inspectLocalAutomation());
    window.addEventListener(AUTOMATION_EVENT, update);
    window.addEventListener("storage", update);
    const timer = window.setInterval(update, 60_000);
    return () => { window.removeEventListener(AUTOMATION_EVENT, update); window.removeEventListener("storage", update); clearInterval(timer); };
  }, [refresh]);

  function runReview() {
    const result = runLocalRiskReview(true);
    setBrowser(inspectLocalAutomation());
    setNotice(result.status === "completed"
      ? `Risk review finished at ${displayTime(result.ranAt)}; ${result.alertCount} open alert(s).`
      : result.message);
  }

  return <main className="gem-auto-main">
    <header className="gem-auto-hero">
      <div>
        <span className="gem-auto-eyebrow">GEM / CONTROL CENTER</span>
        <h1>Automation</h1>
        <p>One view of risk reviews, trader intelligence, service connections, and action availability across your dashboards.</p>
      </div>
      <button disabled={busy} onClick={() => void refresh()}>{busy ? "Checking…" : "Refresh all"}</button>
    </header>

    <div className="gem-auto-metrics" aria-label="Automation status">
      <article><span>Tracked strategies</span><strong>{browser.strategyCount}</strong><small>Saved in this browser</small></article>
      <article><span>Tracked providers</span><strong>{browser.trackedProviders}</strong><small>Account statuses require verification</small></article>
      <article><span>Open risk alerts</span><strong>{browser.openAlerts}</strong><small>Last saved engine review</small></article>
      <article><span>Review interval</span><strong>{browser.intervalHours} h</strong><small>While the dashboard is active</small></article>
    </div>

    <section className="gem-auto-panel">
      <div className="gem-auto-heading"><div><span className="gem-auto-eyebrow">AUTOMATED WORKFLOW</span><h2>Portfolio risk reviews</h2></div>
        <span className={browser.configured ? "gem-auto-status good" : "gem-auto-status"}>{browser.configured ? "Saved engine loaded" : "No local engine data"}</span>
      </div>
      <p>Re-scores saved strategies, checks risk and deterioration, records alerts, and proposes a capital review when conditions change. This monitoring runs when the dashboard is open and due. It does not place trades or change exchange accounts.</p>
      <div className="gem-auto-last"><strong>Latest review</strong><span>{displayTime(browser.lastRunAt)}</span></div>
      {browser.summary && <p className="gem-auto-summary">{browser.summary}</p>}
      {browser.error && <p role="alert" className="gem-auto-warning">{browser.error}</p>}
      {notice && <p role="status" className="gem-auto-summary">{notice}</p>}
      <div className="gem-auto-actions">
        <button onClick={runReview} disabled={!browser.available || !browser.configured || (!browser.strategyCount && !browser.trackedProviders)}>Run risk review</button>
        <a href="/copy-trading?engine=monitoring">Alerts and audit</a>
        <a href="/copy-trading?engine=risk">Risk controls</a>
      </div>
    </section>

    <section className="gem-auto-panel" aria-label="Verified owner connection records">
      <div className="gem-auto-heading"><div><span className="gem-auto-eyebrow">SAVED ACCOUNT EVIDENCE</span><h2>Provider connection records</h2></div>
        <span className={ownerConnections.status === "ready" ? "gem-auto-status good" : "gem-auto-status"}>{ownerConnections.status === "ready" ? "Owner ledger read" : "Not verified"}</span>
      </div>
      <p>{ownerConnections.status === "checking" ? "Checking owner-scoped connection records…" :
        ownerConnections.status === "signed_out" ? "Sign in to see saved owner connection records. Browser-local provider counters are not proof of a verified account." :
        ownerConnections.status === "unavailable" ? "Owner connection records cannot be verified. Check your account session and dedicated ledger configuration." :
        ownerConnections.records.length ? "Saved statuses are not proof that an exchange session is currently active." :
        "No persisted provider connections are recorded for this owner. No balances, positions or monitoring can be inferred from browser settings."}</p>
      {ownerConnections.records.map(record => <p key={record.id} className="gem-auto-summary">
        <strong>{record.venue.toUpperCase()}</strong> — {record.status.replaceAll("_", " ")}.
        {record.lastVerifiedAt ? " Last checked: " + new Date(record.lastVerifiedAt).toLocaleString() + ". This may be stale." : " No verified check time recorded."}
      </p>)}
      {ownerConnections.limited && <p className="gem-auto-warning">Only the latest 25 connection records are shown.</p>}
      <div className="gem-auto-actions"><a href={ownerConnections.status === "signed_out" ? "/sign-in" : "/copy-center?view=providers"}>
        {ownerConnections.status === "signed_out" ? "Sign in" : "Review account connections"}</a></div>
    </section>

    <section className="gem-auto-panel">
      <div className="gem-auto-heading"><div><span className="gem-auto-eyebrow">SYSTEM CONNECTIVITY</span><h2>Engine services</h2></div></div>
      <div className="gem-auto-service-grid">
        <ServiceCard name="Sentinel backend" data={sentinel} detail="Required for persistent account data, server automation, and authorized native copy operations." />
        <ServiceCard name="In-app assistant" data={agent} detail="Interactive AI chat remains separate from deterministic risk reviews and requires a configured, authenticated session." />
        <ServiceCard name="Public market feed" data={market} detail="Reference prices only; not order-book liquidity, economics, or a copy-trading signal." />
      </div>
    </section>

    <CombinedDecisionPanel />
    <div className="gem-auto-liquidity"><LiquidityPanel /></div>
    <div className="gem-auto-liquidity"><EconomyPanel /></div>
    <div className="gem-auto-liquidity"><TraderDiscoveryPanel /></div>
    <section className="gem-auto-panel">
      <div className="gem-auto-heading"><div><span className="gem-auto-eyebrow">WORKFLOW ACCESS</span><h2>Trading intelligence and controls</h2></div></div>
      <div className="gem-auto-links">
        <a href="/copy-center?view=providers"><strong>Accounts</strong><small>Check supported venue connectivity</small></a>
        <a href="/copy-trading?engine=opportunities"><strong>Trader evaluation</strong><small>Research and compare recorded strategies</small></a>
        <a href="/copy-trading?engine=allocation"><strong>Allocation engine</strong><small>Compute capital proposals under risk limits</small></a>
        <a href="/copy-center?view=performance"><strong>Performance</strong><small>Observe equity history and live market context</small></a>
        <a href="/steel"><strong>BTCC browser controls</strong><small>Authenticated browser-session operations</small></a>
        <a href="/copy-trading?engine=monitoring"><strong>Monitoring history</strong><small>Review alerts, evidence and audit events</small></a>
      </div>
    </section>

    <p className="gem-auto-disclaimer">Dashboard reviews operate in the browser and stop when the site is closed. Continuous background execution, exchange-side stop-loss enforcement, 24/7 scheduling and autonomous funded orders are unavailable until the persistent authenticated backend and exchange integrations are proven operational. No website action here moves funds.</p>
  </main>;
}

function ServiceCard({ name, data, detail }: { name: string; data: Service; detail: string }) {
  return <article className="gem-auto-service">
    <div className="gem-auto-service-head"><strong>{name}</strong><span className={`gem-auto-status ${data.status === "connected" ? "good" : ""}`}>{data.status === "connected" ? "Connected" : data.status === "checking" ? "Checking" : "Not confirmed"}</span></div>
    <p>{data.message}</p><small>{detail}</small>
  </article>;
}
