"use client";

import { useEffect, useState } from "react";
import { parseAccountEvidence, evidenceAmount, evidenceFreshness, type AccountEvidence } from "../../lib/account-evidence.ts";

export function AccountEvidencePanel() {
  const [rows, setRows] = useState<AccountEvidence[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setState("loading"); setRows([]);
    void (async () => {
      try {
        const response = await fetch("/api/v1/ledger/snapshots", { cache: "no-store", credentials: "same-origin", signal: controller.signal });
        if (!response.ok) throw Error("Unavailable");
        const records = parseAccountEvidence(await response.json());
        if (!controller.signal.aborted) { setRows(records); setNow(Date.now()); setState("ready"); }
      } catch { if (!controller.signal.aborted) setState("unavailable"); }
      finally { clearTimeout(timeout); }
    })();
    const onTimeout = () => { setRows([]); setState("unavailable"); };
    controller.signal.addEventListener("abort", onTimeout);
    return () => { controller.signal.removeEventListener("abort", onTimeout); controller.abort(); clearTimeout(timeout); };
  }, [revision]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  useEffect(() => { const reload = () => setRevision(x => x + 1); window.addEventListener("gem:account-evidence-changed", reload); return () => window.removeEventListener("gem:account-evidence-changed", reload); }, []);
  return <section aria-label="Saved account evidence">
    <div className="cc-section-head"><div><h2>Saved account evidence</h2><p>Owner-scoped balance observations. These do not establish a current exchange connection.</p></div><button className="cc-card-button" disabled={state === "loading"} onClick={() => setRevision(x => x + 1)}>Refresh account evidence</button></div>
    <div role="status">{state === "loading" ? "Loading account evidence…" : state === "unavailable" ? "Account evidence is unavailable. Your session or account record service may need attention. No balances are inferred." : rows.length === 0 ? "No saved account observations yet. A one-time API check does not save account history." : "Latest saved observations by account, source and currency."}</div>
    <div className="cc-step-grid">{rows.map(row => {
      const freshness = evidenceFreshness(row.capturedAt, now);
      return <article className="cc-performance-card" style={{ minWidth: 0, overflowWrap: "anywhere" }} key={JSON.stringify([row.connectionId,row.sourceKind,row.quoteCurrency])}>
        <h3>{row.sourceKind === "official_api" ? "Official API observation" : "Manual record — not exchange verified"}</h3>
        <p>Account reference: {row.connectionId.slice(0,8)}</p>
        <p>Captured: <time dateTime={row.capturedAt}>{new Date(row.capturedAt).toLocaleString()}</time></p>
        <p>Recorded: <time dateTime={row.recordedAt}>{new Date(row.recordedAt).toLocaleString()}</time></p>
        <p>{freshness === "recent" ? "Recently captured; recurring synchronization is not established." : freshness === "stale" ? "Stale observation — do not treat this as a current balance." : "Invalid future capture time — evidence cannot be treated as current."}</p>
        <dl><dt>Equity</dt><dd>{evidenceAmount(row.equityQuote,row.quoteCurrency)}</dd><dt>Available balance</dt><dd>{evidenceAmount(row.availableQuote,row.quoteCurrency)}</dd><dt>Reported realized PnL</dt><dd>{evidenceAmount(row.realizedPnlQuote,row.quoteCurrency)}</dd><dt>Reported unrealized PnL</dt><dd>{evidenceAmount(row.unrealizedPnlQuote,row.quoteCurrency)}</dd></dl>
        <p>Reported PnL is not reconciled daily net return. Fees, funding, cash flows, positions and fills require separate evidence.</p>
      </article>;
    })}</div>
  </section>;
}
