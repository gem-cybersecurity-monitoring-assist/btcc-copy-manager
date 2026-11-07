"use client";

import { useEffect, useState } from "react";
import { parseEngineState } from "../../lib/engine/state.ts";
import type { EngineState } from "../../lib/engine/types.ts";
import { STORAGE_KEYS } from "../../lib/workspace.ts";
import { assessCombinedDecision, type CombinedDecision } from "@/lib/combined-decision";
import type { LiquidityObservation } from "@/lib/liquidity";
import "./combined-decision-panel.css";

export function CombinedDecisionPanel() {
  const [report, setReport] = useState<CombinedDecision | null>(null);
  const [busy, setBusy] = useState(true);

  async function refresh() {
    setBusy(true);
    let engine: EngineState | null = null;
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.engine);
      if (saved) {
        const parsed = parseEngineState(JSON.parse(saved));
        if (parsed.ok) engine = parsed.value;
      }
    } catch { /* invalid local data never grants eligibility */ }
    let books: LiquidityObservation[] = [];
    let sentinelConnected = false;
    const results = await Promise.allSettled([
      fetch("/api/v1/market/liquidity", {cache:"no-store",signal:AbortSignal.timeout(9000)}),
      fetch("/api/v1/sentinel/health", {cache:"no-store",signal:AbortSignal.timeout(9000)}),
    ]);
    if (results[0].status === "fulfilled" && results[0].value.ok) {
      try {
        const data = await results[0].value.json() as {books?: LiquidityObservation[]};
        books = Array.isArray(data.books) ? data.books : [];
      } catch { /* no fabricated books */ }
    }
    if (results[1].status === "fulfilled" && results[1].value.ok) {
      try {
        const data = await results[1].value.json() as {connected?:boolean};
        sentinelConnected = data.connected === true;
      } catch { /* preserve unavailable state */ }
    }
    setReport(assessCombinedDecision(engine, books, sentinelConnected));
    setBusy(false);
  }
  useEffect(() => { void refresh(); }, []);

  return <section className="gem-decision" aria-label="Cross-source decision intelligence">
    <header className="gem-decision-head">
      <div><p className="gem-decision-overline">COORDINATED RISK ENGINE</p>
        <h2>Decision intelligence</h2>
        <p>One assessment combining trader evidence, portfolio risk, live spot liquidity and persistent service status.</p>
      </div>
      <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? "Checking…" : "Refresh assessment"}</button>
    </header>
    {report ? <>
      <div className="gem-decision-summary">
        <strong>{report.researchStatus === "EVIDENCE_AVAILABLE" ? "Market research available" : "Insufficient evidence"}</strong>
        <span>Automated exchange execution: not authorized</span>
      </div>
      <div className="gem-decision-checks">
        {report.checks.map(check => <article key={check.id}>
          <div className="gem-decision-check-head"><strong>{check.title}</strong>
            <span className={check.status === "observed" ? "observed" : check.status === "review" ? "review" : "blocked"}>
              {check.status === "observed" ? "Observed" : check.status === "review" ? "Review" : "Blocked"}
            </span>
          </div>
          <p>{check.detail}</p>
        </article>)}
      </div>
      <p className="gem-decision-foot">Assessed {new Date(report.observedAt).toLocaleString()}. These are read-only evidence checks, not a guarantee of performance. Annual economic indicators are displayed separately as lagging context and do not authorize trades.</p>
    </> : <p role="status" className="gem-decision-foot">Validating market and workspace evidence…</p>}
  </section>;
}
