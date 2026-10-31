"use client";
import { useCallback, useEffect, useState } from "react";
import { SIGNAL_SYMBOLS, type SignalInboxItem } from "../../../lib/signals/normalize.ts";
import { Notice, Pill } from "./ui.tsx";

type Response = { signal?: SignalInboxItem | null; error?: string; readOnly?: boolean; automaticExecution?: boolean };

export function SignalInboxTab() {
  const [symbol, setSymbol] = useState<(typeof SIGNAL_SYMBOLS)[number]>("BTC");
  const [signal, setSignal] = useState<SignalInboxItem | null>(null);
  const [message, setMessage] = useState("Choose a symbol and refresh to retrieve its latest read-only signal.");
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/signals?symbol=" + encodeURIComponent(symbol), { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as Response;
      if (!response.ok) throw new Error(data.error || "Signal request failed.");
      setSignal(data.signal ?? null); setMessage(data.error || (data.signal ? "" : "No signal is available for this symbol."));
      setCheckedAt(new Date().toISOString());
    } catch (error) { setSignal(null); setMessage(error instanceof Error ? error.message : "Could not retrieve the signal."); }
    finally { setBusy(false); }
  }, [symbol]);
  useEffect(() => { void refresh(); }, [refresh]);
  const freshnessLabel = signal?.freshness === "STALE" ? "Stale / review only"
    : signal?.freshness === "SOURCE_TIME_UNVERIFIED" ? "Source time unverified"
    : signal?.freshness === "FRESH_BY_MARKET_TIME" ? "Market data timestamp verified"
    : signal?.freshness === "FRESH_BY_SIGNAL_AND_MARKET_TIME" ? "Signal + market timestamps verified"
    : "Recent signal timestamp only";
  const freshnessTone = signal?.freshness === "STALE" ? "bad"
    : signal?.freshness === "SOURCE_TIME_UNVERIFIED" || signal?.freshness === "FRESH_BY_SIGNAL_TIME" ? "warn"
    : "good";
  return (
    <div className="engine-stack signal-inbox">
      <Notice tone="info"><strong>Read-only connection.</strong> Signals are fetched from the Crypto Signal Bot for review only. They are not copy-trading instructions, are not added to your strategy history, and cannot place orders or change allocations.</Notice>
      <div className="signal-toolbar">
        <label htmlFor="signal-symbol">Market symbol</label>
        <select id="signal-symbol" value={symbol} onChange={(event) => setSymbol(event.target.value as (typeof SIGNAL_SYMBOLS)[number])}>
          {SIGNAL_SYMBOLS.map((item) => <option key={item} value={item}>{item}/USDT</option>)}
        </select>
        <button type="button" onClick={() => void refresh()} disabled={busy}>{busy ? "Checking…" : "Refresh signal"}</button>
      </div>
      {message && <Notice tone={message.includes("unavailable") || message.includes("timed out") ? "warn" : "info"}>{message}</Notice>}
      {signal && (
        <article className="signal-card">
          <div className="signal-card-top"><div><p className="eyebrow">LATEST WORKER SIGNAL</p><h3>{signal.symbol}/USDT · {signal.side}</h3></div><Pill tone={freshnessTone}>{freshnessLabel}</Pill></div>
          <div className="signal-metrics">
            <div><span>Confidence</span><strong>{(signal.confidence * 100).toFixed(0)}%</strong></div>
            <div><span>Entry reference</span><strong>{signal.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
            <div><span>Stop loss</span><strong>{signal.stopLoss === null ? "Not supplied" : signal.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
            <div><span>Take profit</span><strong>{signal.takeProfit === null ? "Not supplied" : signal.takeProfit.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
          </div>
          <p><strong>Strategy:</strong> {signal.strategy}</p>
          <p><strong>Source:</strong> {signal.source === "PERSISTED_SIGNAL" ? "Saved Worker signal" : "Worker-derived EMA signal"}{signal.priceSource ? " · " + signal.priceSource : " · price source not supplied"}</p>
          <p><strong>Signal time:</strong> {signal.signalCreatedAt ? new Date(signal.signalCreatedAt).toLocaleString() : "Not supplied by Worker"}</p>
          <p><strong>Market data as of:</strong> {signal.marketDataAsOf ? new Date(signal.marketDataAsOf).toLocaleString() : "Not supplied by Worker"}</p>
          <p><strong>Expires:</strong> {signal.expiresAt ? new Date(signal.expiresAt).toLocaleString() : "No trustworthy expiry supplied"}</p>
          <p><strong>Event reference:</strong> <code>{signal.eventId}</code></p>
          <p><strong>Fetched:</strong> {signal.fetchedAt ? new Date(signal.fetchedAt).toLocaleString() : "Not supplied"}</p>
          {signal.freshness === "SOURCE_TIME_UNVERIFIED" && <Notice tone="warn">The current Worker response does not include the source market-snapshot timestamp. Its response time is not proof of market freshness. Treat this as research context only.</Notice>}
          {signal.freshness === "FRESH_BY_SIGNAL_TIME" && <Notice tone="warn">The signal creation time is recent, but the underlying market-snapshot time is not supplied. This is not a verified current market view.</Notice>}
          {signal.freshness === "STALE" && <Notice tone="warn">The Worker marked this signal stale or incomplete. It is shown for context only and is not decision-grade.</Notice>}
          {signal.provenanceStatus === "UNTRUSTED_PRICE_FALLBACK" && <Notice tone="warn">The Worker could not verify the price source. Do not use this entry reference.</Notice>}
          <div className="signal-readonly"><Pill tone="neutral">Read only</Pill><Pill tone="warn">Human review required</Pill><Pill tone="neutral">No automatic execution</Pill><Pill tone={signal.decisionGrade ? "good" : "warn"}>{signal.decisionGrade ? "Source timestamps passed" : "Not decision-grade"}</Pill></div>
        </article>
      )}
      <p className="field-hint">Last checked: {checkedAt ? new Date(checkedAt).toLocaleString() : "Not checked yet"}. This inbox does not save signals to your workspace.</p>
    </div>
  );
}
