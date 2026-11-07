"use client";

import { useEffect, useState } from "react";
import type { LiquidityObservation } from "@/lib/liquidity";
import "./liquidity-panel.css";

type Report = { status: string; books: LiquidityObservation[]; note: string; retrievedAt: string | null };
const compact = (value: number) => Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
const precise = (value: number) => Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);

export function LiquidityPanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/v1/market/liquidity", { cache: "no-store" });
      const payload = await response.json() as Report;
      setReport(payload);
    } catch {
      setReport({ status: "unavailable", books: [], retrievedAt: null, note: "Public spot order books could not be retrieved." });
    } finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <section className="gem-liquidity" aria-label="Market liquidity intelligence">
    <header className="gem-liquidity-head">
      <div><span className="gem-liquidity-overline">LIVE MARKET EVIDENCE</span><h2>Liquidity &amp; spreads</h2><p>Public spot order-book depth from Bitget and Kraken, independent of copied traders.</p></div>
      <button type="button" onClick={() => void refresh()} disabled={loading}>{loading ? "Checking…" : "Refresh depth"}</button>
    </header>
    {report?.books.length ? <div className="gem-liquidity-grid">
      {report.books.map(book => <article key={book.provider+book.symbol}>
        <div className="gem-liquidity-card-head"><strong>{book.symbol} · {book.provider}</strong><span>{book.quoteCurrency} spot</span></div>
        <div className="gem-liquidity-price"><span>Bid / Ask</span><strong>{precise(book.bid)} / {precise(book.ask)}</strong></div>
        <div className="gem-liquidity-row"><span>Spread</span><strong>{book.spreadBps.toFixed(2)} bps</strong></div>
        <div className="gem-liquidity-row"><span>Bid depth · {book.levels} levels</span><strong>{compact(book.bidDepthQuote)} {book.quoteCurrency}</strong></div>
        <div className="gem-liquidity-row"><span>Ask depth · {book.levels} levels</span><strong>{compact(book.askDepthQuote)} {book.quoteCurrency}</strong></div>
        <div className="gem-liquidity-row"><span>Quoted depth imbalance</span><strong>{book.depthImbalancePct.toFixed(1)}%</strong></div>
        <small>Source quote: {new Date(book.sourceTimestamp).toLocaleTimeString()}</small>
      </article>)}
    </div> : <p role="status" className="gem-liquidity-empty">{loading ? "Loading source-verified order books…" : "Verified liquidity observations are unavailable. No execution assumptions are made."}</p>}
    {report?.books.length ? <p className="gem-liquidity-footnote">Showing {report.books.length} of 4 requested spot books. Missing or stale feeds are omitted.</p> : null}
    <p className="gem-liquidity-footnote">Liquidity metrics describe the best ten quoted levels per side, not guaranteed fill size or exchange copy-trading futures depth. USD and USDT values are kept separate. Quotes can change immediately.</p>
  </section>;
}
