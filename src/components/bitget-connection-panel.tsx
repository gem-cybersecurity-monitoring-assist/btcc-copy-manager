"use client";

// Owner view of the saved read-only Bitget connection. Reads status and the
// last snapshot from the server; credentials never reach this component after
// submission and are never written to browser storage.
import { useCallback, useEffect, useState } from "react";

export const BITGET_CONNECTION_EVENT = "gem:bitget-connection-changed";

type Coin = { coin: string; equity: number | null; available: number | null; locked: number | null; usdValue: number | null };
type Position = {
  category: string; symbol: string; side: string; marginCoin: string | null; size: number | null;
  entryPrice: number | null; markPrice: number | null; liquidationPrice: number | null;
  leverage: number | null; marginMode: string | null; unrealizedPnl: number | null;
};
type Snapshot = {
  capturedAt: string;
  balances: { accountEquityUsd: number | null; usdtEquity: number | null; btcEquity: number | null; unrealizedPnlUsd: number | null; coins: Coin[] };
  positions: { status: "complete" | "partial" | "unavailable"; reason: string | null; categories: Record<string, string>; rows: Position[] };
};
export type BitgetConnectionView = {
  id: string; status: "READ_ONLY" | "ERROR" | "DISCONNECTED" | "VERIFIED" | "PAUSED";
  lastVerifiedAt: string | null; lastErrorCode: string | null; snapshot: Snapshot | null;
};
type LoadState = "loading" | "ready" | "signed-out" | "not-configured" | "unavailable";

const fmt = (value: number | null, digits = 2) =>
  value === null ? "Unknown" : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const usd = (value: number | null) =>
  value === null ? "Unknown" : value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

function validSnapshot(value: unknown): value is Snapshot {
  const s = value as Snapshot | null;
  return Boolean(s && typeof s.capturedAt === "string" && s.balances && Array.isArray(s.balances.coins) &&
    s.positions && Array.isArray(s.positions.rows) && typeof s.positions.status === "string");
}

export function BitgetConnectionPanel({ mode = "accounts", onStatus }: {
  mode?: "accounts" | "positions";
  onStatus?: (connection: BitgetConnectionView | null) => void;
}) {
  const [state, setState] = useState<LoadState>("loading");
  const [connection, setConnection] = useState<BitgetConnectionView | null>(null);
  const [busy, setBusy] = useState<"" | "refresh" | "disconnect">("");
  const [message, setMessage] = useState("");
  const [missing, setMissing] = useState<string[]>([]);

  const apply = useCallback((raw: unknown) => {
    const c = raw as BitgetConnectionView | null;
    const next = c && typeof c.id === "string" ? { ...c, snapshot: validSnapshot(c.snapshot) ? c.snapshot : null } : null;
    setConnection(next);
    onStatus?.(next);
  }, [onStatus]);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/connections/bitget", { cache: "no-store", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (response.status === 401) { setState("signed-out"); apply(null); return; }
      if (data.code === "connection_storage_not_configured") {
        setMissing(Array.isArray(data.missing) ? data.missing.filter((x: unknown) => typeof x === "string") : []);
        setState("not-configured"); apply(null); return;
      }
      if (!response.ok || data.ok !== true) { setState("unavailable"); return; }
      apply(data.connection);
      setState("ready");
    } catch {
      setState("unavailable");
    }
  }, [apply]);

  useEffect(() => {
    void load();
    const listener = () => void load();
    window.addEventListener(BITGET_CONNECTION_EVENT, listener);
    return () => window.removeEventListener(BITGET_CONNECTION_EVENT, listener);
  }, [load]);

  async function act(kind: "refresh" | "disconnect") {
    if (kind === "disconnect" && !window.confirm("Disconnect Bitget? The encrypted credentials will be deleted from the server. Past balance observations stay in your history.")) return;
    setBusy(kind); setMessage("");
    try {
      const response = await fetch(kind === "refresh" ? "/api/connections/bitget/refresh" : "/api/connections/bitget", {
        method: kind === "refresh" ? "POST" : "DELETE",
        cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: kind === "refresh" ? "{}" : undefined,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "The request failed.");
      apply(data.connection);
      setMessage(kind === "refresh"
        ? "Re-verified as read-only and refreshed from Bitget."
        : "Bitget disconnected. Stored credentials were deleted.");
      window.dispatchEvent(new Event("gem:account-evidence-changed"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request failed.");
      void load();
    } finally {
      setBusy("");
    }
  }

  const live = connection && connection.status !== "DISCONNECTED";
  const snapshot = live ? connection.snapshot : null;

  return (
    <section className="cc-settings-card" aria-label="Bitget read-only connection" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <div className="cc-section-head">
        <div>
          <h2>Bitget {mode === "positions" ? "positions" : "account"}</h2>
          <p className="cc-lead">Official Bitget API · read-only key · no trading, transfers or withdrawals.</p>
        </div>
        {live && (
          <div className="cc-modal-actions">
            <button className="cc-card-button" disabled={busy !== ""} onClick={() => void act("refresh")}>
              {busy === "refresh" ? "Re-verifying…" : "Re-verify & refresh"}
            </button>
            {mode === "accounts" && (
              <button className="cc-text-button" disabled={busy !== ""} onClick={() => void act("disconnect")}>
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
          </div>
        )}
      </div>

      <div role="status">
        {state === "loading" && <p>Loading Bitget connection…</p>}
        {state === "signed-out" && <p>Sign in as the workspace owner to see Bitget balances.</p>}
        {state === "unavailable" && <p>The Bitget connection status could not be loaded. No balances are shown or inferred.</p>}
        {state === "not-configured" && (
          <p>
            Saved connections are not configured on this server yet{missing.length ? " (missing: " + missing.join(", ") + ")" : ""}.
            No balances are shown. The one-time verification in Accounts still works.
          </p>
        )}
        {state === "ready" && !live && (
          <p>
            <span className="cc-pill cc-pill-off">Not connected</span>{" "}
            No Bitget data is shown. {mode === "accounts" ? "Open Bitget below and save a read-only connection." : "Connect Bitget in Accounts to see live positions."}
          </p>
        )}
        {state === "ready" && live && connection.status === "ERROR" && (
          <p>
            <span className="cc-pill cc-pill-off">Needs attention</span>{" "}
            {connection.lastErrorCode === "not_read_only"
              ? "Bitget reported that this key is no longer read-only. It was deleted and is not used. Save a new read-only key."
              : "The last refresh failed (" + (connection.lastErrorCode ?? "unknown") + "). Figures below, if any, are from the last successful read."}
          </p>
        )}
        {message && <p>{message}</p>}
      </div>

      {snapshot && (
        <>
          <p>
            <span className="cc-pill cc-pill-safe">Live read-only</span>{" "}
            Read from Bitget at <time dateTime={snapshot.capturedAt}>{new Date(snapshot.capturedAt).toLocaleString()}</time>. Use Re-verify &amp; refresh for current figures.
          </p>
          {mode === "accounts" && (
            <>
              <div className="cc-stats">
                <article><span>Account equity (USD)</span><strong>{usd(snapshot.balances.accountEquityUsd)}</strong><p>Bitget UTA aggregate</p></article>
                <article><span>USDT equity</span><strong>{fmt(snapshot.balances.usdtEquity)}</strong><p>Reported by Bitget</p></article>
                <article><span>Unrealized PnL (USD)</span><strong>{usd(snapshot.balances.unrealizedPnlUsd)}</strong><p>Not reconciled net return</p></article>
              </div>
              {snapshot.balances.coins.length > 0 ? (
                <div className="cc-data-table">
                  <table>
                    <caption>Balances by coin</caption>
                    <thead><tr><th scope="col">Coin</th><th scope="col">Equity</th><th scope="col">Available</th><th scope="col">Locked</th><th scope="col">USD value</th></tr></thead>
                    <tbody>{snapshot.balances.coins.map((coin) => (
                      <tr key={coin.coin}><th scope="row">{coin.coin}</th><td>{fmt(coin.equity, 8)}</td><td>{fmt(coin.available, 8)}</td><td>{fmt(coin.locked, 8)}</td><td>{usd(coin.usdValue)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <p>Bitget reported no non-zero coin balances.</p>}
            </>
          )}
          {snapshot.positions.status === "unavailable" ? (
            <p><span className="cc-pill cc-pill-muted">Positions unavailable</span> {snapshot.positions.reason ?? "Bitget positions could not be read."} Positions are not shown as zero.</p>
          ) : (
            <>
              {snapshot.positions.status === "partial" && (
                <p><span className="cc-pill cc-pill-muted">Partial</span> Some position categories could not be read: {Object.entries(snapshot.positions.categories).filter(([, v]) => v !== "ok").map(([k]) => k).join(", ")}.</p>
              )}
              {snapshot.positions.rows.length === 0 ? (
                <p>Bitget reported no open positions{snapshot.positions.status === "partial" ? " in the categories that could be read" : ""}.</p>
              ) : (
                <div className="cc-data-table">
                  <table>
                    <caption>Open positions</caption>
                    <thead><tr><th scope="col">Symbol</th><th scope="col">Side</th><th scope="col">Size</th><th scope="col">Entry</th><th scope="col">Mark</th><th scope="col">Leverage</th><th scope="col">Unrealized PnL</th></tr></thead>
                    <tbody>{snapshot.positions.rows.map((p) => (
                      <tr key={p.category + p.symbol + p.side}><th scope="row">{p.symbol}</th><td>{p.side}</td><td>{fmt(p.size, 8)}</td><td>{fmt(p.entryPrice, 8)}</td><td>{fmt(p.markPrice, 8)}</td><td>{p.leverage === null ? "Unknown" : p.leverage + "×"}</td><td>{fmt(p.unrealizedPnl)} {p.marginCoin ?? ""}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
