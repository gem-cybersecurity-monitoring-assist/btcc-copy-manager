"use client";

import { useCallback, useEffect, useState } from "react";
import { SIGNAL_INBOX_SYMBOLS, type SignalInboxItem, type SignalInboxSymbol } from "../../../lib/signal-inbox.ts";
import { Notice, Pill } from "./ui.tsx";

type ApiResponse = { signal?: SignalInboxItem; error?: string };

const statusLabel = {
  REVIEW_REQUIRED: "Human review required",
  STALE_REVIEW: "Source needs checking",
  BLOCKED_FALLBACK: "Blocked: fallback price",
} as const;

export function SignalInboxTab() {
  const [symbol, setSymbol] = useState<SignalInboxSymbol>("BTC");
  const [signal, setSignal] = useState<SignalInboxItem | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/signals?symbol=${encodeURIComponent(symbol)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as ApiResponse;
      if (!response.ok || !payload.signal) throw new Error(payload.error || "The signal could not be loaded.");
      setSignal(payload.signal);
    } catch (caught) {
      setSignal(null);
      setError(caught instanceof Error ? caught.message : "The signal could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="engine-stack">
      <Notice tone="info">
        <strong>Read-only signal preview.</strong> Signals are observations from the Crypto Signal Bot, not verified trading instructions. This inbox does not place orders, activate copy trading, change allocations, or connect exchange accounts.
      </Notice>
      <div className="engine-actions">
        <label className="inline">Asset
          <select value={symbol} onChange={(event) => setSymbol(event.target.value as SignalInboxSymbol)}>
            {SIGNAL_INBOX_SYMBOLS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <button className="secondary-btn" type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Checking…" : "Refresh signal"}
        </button>
      </div>

      {loading && <p className="muted" role="status">Checking the read-only signal feed…</p>}
      {error && <Notice tone="bad">{error}</Notice>}
      {!loading && !error && signal && (
        <article className="engine-card wide" aria-label={`${signal.symbol} signal preview`}>
          <div className="engine-card-head">
            <div>
              <p className="eyebrow">CRYPTO SIGNAL BOT · {signal.sourceKind === "PERSISTED_SIGNAL" ? "SAVED SIGNAL" : "DERIVED SIGNAL"}</p>
              <h3>{signal.symbol} · {signal.side}</h3>
            </div>
            <Pill tone={signal.reviewState === "BLOCKED_FALLBACK" ? "bad" : "warn"}>{statusLabel[signal.reviewState]}</Pill>
          </div>
          <dl className="engine-dl">
            <div><dt>Confidence</dt><dd>{(signal.confidence * 100).toFixed(0)}%</dd></div>
            <div><dt>Reference price</dt><dd>{signal.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 6 })}</dd></div>
            <div><dt>Price source</dt><dd>{signal.priceSource ?? "Not supplied"}</dd></div>
            <div><dt>Strategy</dt><dd>{signal.strategy}</dd></div>
            <div><dt>Stop loss</dt><dd>{signal.stopLoss === null ? "Not supplied" : signal.stopLoss.toLocaleString()}</dd></div>
            <div><dt>Take profit</dt><dd>{signal.takeProfit === null ? "Not supplied" : signal.takeProfit.toLocaleString()}</dd></div>
            <div><dt>Signal created</dt><dd>{signal.createdAt ? new Date(signal.createdAt).toLocaleString() : "Not supplied"}</dd></div>
            <div><dt>Response received</dt><dd>{signal.responseAt ? new Date(signal.responseAt).toLocaleString() : "Not supplied"}</dd></div>
          </dl>
          {signal.reviewState === "BLOCKED_FALLBACK" ? (
            <Notice tone="bad">The Worker supplied a static fallback price. Do not use this signal for decisions. It is shown only to make the data-quality problem visible.</Notice>
          ) : (
            <Notice tone="warn">This feed does not provide a trustworthy market-data timestamp linked to this signal. Treat it as informational only; human review is required.</Notice>
          )}
        </article>
      )}
      {!loading && !error && !signal && <p className="muted">No signal has been loaded yet. Choose an asset and refresh.</p>}
    </div>
  );
}
