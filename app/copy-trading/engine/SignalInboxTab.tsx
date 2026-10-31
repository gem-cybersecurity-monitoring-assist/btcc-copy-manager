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
  const freshnessLabel = signal?.freshness === "STALE" ? "Stale signal" : signal?.freshness === "SOURCE_TIME_UNVERIFIED" ? "Source time unverified" : signal?.freshness === "FRESH_MARKET_DATA" ? "Fresh market snapshot" : "Recent signal timestamp";
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
          <div className="signal-card-top"><div><p className="eyebrow">LATEST WORKER SIGNAL</p><h3>{signal.symbol}/USDT · {signal.side}</h3></div><Pill tone={signal.freshness === "STALE" ? "bad" : signal.freshness === "SOURCE_TIME_UNVERIFIED" ? "warn" : "neutral"}>{freshnessLabel}</Pill></div>
          <div className="signal-metrics">
            <div><span>Confidence</span><strong>{(signal.confidence * 100).toFixed(0)}%</strong></div>
            <div><span>Entry reference</span><strong>{signal.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
            <div><span>Stop loss</span><strong>{signal.stopLoss === null ? "Not supplied" : signal.stopLoss.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
            <div><span>Take profit</span><strong>{signal.takeProfit === null ? "Not supplied" : signal.takeProfit.toLocaleString(undefined, { maximumFractionDigits: 8 })}</strong></div>
          </div>
          <p><strong>Strategy:</strong> {signal.strategy}</p>
          <p><strong>Source:</strong> {signal.source === "PERSISTED_SIGNAL" ? "Saved Worker signal" : "Worker-derived EMA signal"}{signal.priceSource ? " · " + signal.priceSource : ""}</p>
          <p><strong>Signal time:</strong> {signal.signalCreatedAt ? new Date(signal.signalCreatedAt).toLocaleString() : "Not supplied by Worker"}</p>
          <p><strong>Market data as of:</strong> {signal.marketDataAsOf ? new Date(signal.marketDataAsOf).toLocaleString() : "Not supplied by Worker"}</p>
          <p><strong>Fetched:</strong> {signal.fetchedAt ? new Date(signal.fetchedAt).toLocaleString() : "Not supplied"}</p>
          {signal.freshness === "SOURCE_TIME_UNVERIFIED" && <Notice tone="warn">The Worker does not provide the source market-snapshot timestamp for this derived signal. Its response time is not proof of market freshness. Treat this as research context only.</Notice>}
          {signal.freshness === "STALE" && <Notice tone="warn">This saved signal is older than 15 minutes. Do not rely on it as a current market view.</Notice>}
          {signal.source === "PERSISTED_SIGNAL" && <p className="field-hint">The Worker supplied a signal creation time, but not the underlying market-snapshot time. This timestamp alone does not prove the quoted price is current.</p>}
          {signal.freshness === "FRESH_MARKET_DATA" && <Notice tone="info">The Worker reports a recent matching live market snapshot. This remains research context and still requires your review.</Notice>}
          <div className="signal-readonly"><Pill tone="neutral">Read only</Pill><Pill tone="warn">Review required</Pill><Pill tone="neutral">No automatic execution</Pill></div>
        </article>
      )}
      <p className="field-hint">Last checked: {checkedAt ? new Date(checkedAt).toLocaleString() : "Not checked yet"}. This inbox does not save signals to your workspace.</p>
    </div>
  );
}