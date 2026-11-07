"use client";

import { useEffect, useState } from "react";
import type { PublicMarketAsset } from "../lib/public-market.ts";

type Response = { status: string; source: string; assets: PublicMarketAsset[]; asOf: string | null; note: string };
const dollar = (value: number) => value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const compact = (value: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);

export function MarketOverview() {
  const [report, setReport] = useState<Response | null>(null);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/v1/market/overview", { cache: "no-store" });
      const data = await response.json() as Response;
      setReport(data);
    } catch {
      setReport({ status: "unavailable", source: "CoinGecko", assets: [], asOf: null, note: "Market price feed is unreachable." });
    } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <section className="cc-page">
    <div className="cc-section-head"><div><p className="cc-eyebrow">PUBLIC MARKET CONTEXT</p><h2>Market overview</h2><p className="cc-lead">Live spot references for market context, separate from exchange execution and order-book liquidity.</p></div><button className="cc-card-button" onClick={() => void refresh()} disabled={busy}>{busy ? "Loading…" : "Refresh market"}</button></div>
    {report?.status === "available" ? <div className="cc-step-grid">{report.assets.map(asset => <article key={asset.id} className="cc-performance-card">
      <h3>{asset.name} · {asset.symbol}</h3>
      <strong>{dollar(asset.priceUsd)}</strong>
      <p>24h change: {asset.change24hPct == null ? "Not reported" : asset.change24hPct.toFixed(2) + "%"}</p>
      <p>24h traded volume: {asset.volume24hUsd == null ? "Unavailable" : "$" + compact(asset.volume24hUsd)}</p>
      <p>Market capitalization: {asset.marketCapUsd == null ? "Unavailable" : "$" + compact(asset.marketCapUsd)}</p>
      <small>Last updated: {new Date(asset.updatedAt).toLocaleString()}</small>
    </article>)}</div> : <p role="status">{busy ? "Loading verified market observations…" : report?.note ?? "Checking public market data…"}</p>}
    <p className="cc-footnote">Source: CoinGecko public market data. Reference prices and traded volume do not establish exchange-specific spreads, order-book depth, fill prices or economic predictions.</p>
  </section>;
}
