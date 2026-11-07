"use client";

import { useEffect, useState } from "react";
import { readLocalWorkspace } from "../app/copy-trading/storage.ts";
import { summarizeRecordedEquity, type EquityChange } from "../../lib/performance.ts";

function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function PerformancePanel() {
  const [rows, setRows] = useState<EquityChange[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState("");
  function refresh() {
    const stored = readLocalWorkspace();
    setRows(summarizeRecordedEquity(stored.workspace.portfolioSnapshots));
    setCount(stored.workspace.portfolioSnapshots.length);
    setError(stored.error ?? "");
  }
  useEffect(() => { refresh(); }, []);
  return (
    <>
      <section className="cc-section-head">
        <div>
          <p className="cc-eyebrow">ACCOUNT INTELLIGENCE</p>
          <h2>Performance</h2>
          <p className="cc-lead">Recorded account equity by exchange, with clear source and reconciliation boundaries.</p>
        </div>
        <button className="cc-card-button" onClick={refresh}>Refresh records</button>
      </section>
      {error && <div className="cc-notice" role="alert">{error}</div>}
      <section className="cc-stats" aria-label="Performance data">
        <article>
          <span>Recorded equity snapshots</span>
          <strong>{count}</strong>
          <p>Locally stored, not authenticated exchange statements</p>
        </article>
        <article>
          <span>Verified net trading ROI</span>
          <strong className="cc-stat-word">Unavailable</strong>
          <p>Requires reconciled cash flows, fees and exchange history</p>
        </article>
        <article>
          <span>Exchange trade synchronization</span>
          <strong className="cc-stat-word">Not active</strong>
          <p>One-time access checks do not maintain trade history</p>
        </article>
      </section>
      {rows.length > 0 ? (
        <div className="cc-step-grid" aria-label="Observed changes">
          {rows.map((row) => (
            <article className="cc-performance-card" key={row.venue}>
              <h3>{row.venue}</h3>
              <p>{new Date(row.start.capturedAt).toLocaleDateString()} – {new Date(row.end.capturedAt).toLocaleDateString()}</p>
              <strong>{money(row.end.equity)}</strong>
              <p>Earlier recorded equity: {money(row.start.equity)}</p>
              <p>Unadjusted equity change: {money(row.changeUsd)} ({row.unadjustedChangePct.toFixed(2)}%)</p>
              <small>{row.warning}</small>
            </article>
          ))}
        </div>
      ) : (
        <section className="cc-position-card">
          <div>
            <h2>No comparable account history yet</h2>
            <p>At least two dated equity observations from one exchange are needed to compare balances. Verified trading returns require exchange-sourced fills and cash-flow reconciliation.</p>
            <a className="cc-button" href="/copy-trading">View account records</a>
          </div>
        </section>
      )}
      <section className="cc-notice">
        <div>
          <strong>Return evidence</strong>
          <p>This screen does not estimate or promise daily profit. It never treats deposits or changing wallet values as trading performance. Live account-performance monitoring will be shown once exchange history and owner authorization are available.</p>
        </div>
      </section>
    </>
  );
}
