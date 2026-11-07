"use client";

import { useCallback, useEffect, useState } from "react";
import type { Opportunity } from "@/lib/opportunities";

type ScannerResponse = {
  watchlist?: Opportunity[];
  scannedAt?: string;
  market?: { state?: string };
  execution?: string;
};

export function OpportunitiesDashboard() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scannedAt, setScannedAt] = useState<string | null>(null);
  const [market, setMarket] = useState("UNKNOWN");

  const refresh = useCallback(async (method: "GET" | "POST" = "GET") => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/v1/opportunities", { method, cache: "no-store" });
      if (!response.ok) throw new Error("Opportunity information is unavailable.");
      const data = await response.json() as ScannerResponse;
      if (!Array.isArray(data.watchlist)) throw new Error("Opportunity feed returned an invalid response.");
      setItems(data.watchlist);
      setMarket(data.market?.state ?? "UNKNOWN");
      setScannedAt(typeof data.scannedAt === "string" && Number.isFinite(Date.parse(data.scannedAt)) ? data.scannedAt : null);
    } catch (cause) {
      setItems([]);
      setMarket("UNKNOWN");
      setScannedAt(null);
      setError(cause instanceof Error ? cause.message : "Unable to refresh verified opportunities.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return <main className="opportunities-page">
    <header className="opportunities-header">
      <div>
        <p className="eyebrow">GEM / Trader intelligence</p>
        <h1>Opportunities</h1>
        <p className="subtle">Compare verified trader candidates across supported feeds. Unverified trader statistics are not presented as current opportunities.</p>
      </div>
      <button className="button" onClick={() => void refresh("POST")} disabled={loading}>{loading ? "Checking…" : "Refresh opportunities"}</button>
    </header>
    <section className="op-summary" aria-label="Opportunity status">
      <div><span>Verified candidates</span><strong>{items.length}</strong></div>
      <div><span>Market confirmation</span><strong className="caution">{market}</strong></div>
      <div><span>Latest check</span><strong>{scannedAt ? new Date(scannedAt).toLocaleTimeString() : "Unavailable"}</strong></div>
      <div><span>Trading actions</span><strong>NOT CONNECTED</strong></div>
    </section>
    {error && <p role="alert" className="op-error">{error}</p>}
    {!loading && items.length === 0 && <section className="op-empty" role="status">
      <h2>No verified trader opportunities</h2>
      <p>Trader discovery has not returned any authenticated candidates. You can connect a supported account, review your saved trader records, or inspect public market references without placing an order.</p>
      <div className="op-empty-actions">
        <a href="/copy-center?view=providers" className="button">Accounts</a>
        <a href="/copy-trading" className="button secondary">Trader records</a>
        <a href="/copy-center?view=performance" className="button secondary">Market &amp; performance</a>
      </div>
    </section>}
    <section className="op-grid" aria-label="Verified trader candidates">
      {items.map(item => <article className="op-card" key={item.id}>
        <div className="op-card-head">
          <div><span className="op-symbol">{item.symbol}</span> <span className={`direction ${item.direction.toLowerCase()}`}>{item.direction}</span><p className="subtle">{item.trader} · {item.followers.toLocaleString()} followers</p></div>
          <div className="op-score"><strong>{item.score}</strong><span>score</span></div>
        </div>
        <div className="op-stats">
          <div><span>30d ROI</span><strong>{item.roi30d}%</strong></div><div><span>Win rate</span><strong>{item.winRate}%</strong></div>
          <div><span>Drawdown</span><strong>{item.maxDrawdown}%</strong></div><div><span>Leverage</span><strong>{item.leverage}×</strong></div>
        </div>
        <div className="op-status"><span className={`badge badge-${item.risk.toLowerCase()}`}>{item.risk} RISK</span><span className={`badge badge-${item.market.toLowerCase()}`}>{item.market}</span><span className="freshness">{item.freshness}</span></div>
        <button className="why-button" onClick={() => setExpanded(expanded === item.id ? null : item.id)} aria-expanded={expanded === item.id}>Why this score?<span aria-hidden="true">{expanded === item.id ? "−" : "+"}</span></button>
        {expanded === item.id && <div className="evidence"><p className="eyebrow">Candidate evidence</p><ul>{item.rationale.map((reason, index) => <li key={index}>{reason}</li>)}</ul><small>Source: {item.source}{item.degraded ? " · limited confidence" : ""}</small></div>}
      </article>)}
    </section>
    <p className="op-footnote">Source verification, liquidity confidence and risk limits are mandatory before any candidate becomes actionable. This page never places trades.</p>
  </main>;
}
