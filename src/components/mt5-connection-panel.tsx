"use client";

// Owner view of the MT5 investor (read-only) connection. Shows the saved
// login/server and bridge status. With no bridge configured it shows
// "not connected" and no figures. The password is sent once and never kept here.
import { useCallback, useEffect, useState } from "react";

type Snapshot = {
  capturedAt: string;
  account: { currency: string | null; leverage: number | null; balance: number | null; equity: number | null; margin: number | null; freeMargin: number | null; profit: number | null };
  positions: Array<{ ticket: string; symbol: string; side: string; volume: number | null; openPrice: number | null; currentPrice: number | null; profit: number | null }>;
};
type Connection = {
  status: "PAUSED" | "READ_ONLY" | "ERROR" | "DISCONNECTED" | "VERIFIED";
  account: { login: string; server: string } | null;
  credentialsSaved: boolean; lastVerifiedAt: string | null; lastErrorCode: string | null;
  snapshot: Snapshot | null;
};

const amount = (v: number | null, currency?: string | null) => v === null ? "Unknown" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }) + (currency ? " " + currency : "");

export function Mt5ConnectionPanel({ mode = "accounts" }: { mode?: "accounts" | "positions" }) {
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "not-configured" | "unavailable">("loading");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [bridge, setBridge] = useState<{ configured: boolean; reason: string | null }>({ configured: false, reason: null });
  const [login, setLogin] = useState("");
  const [server, setServer] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections/mt5", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) { setState("signed-out"); return; }
      const data = await response.json().catch(() => ({}));
      if (data.bridge) setBridge({ configured: data.bridge.configured === true, reason: typeof data.bridge.reason === "string" ? data.bridge.reason : null });
      if (data.code === "connection_storage_not_configured") { setState("not-configured"); return; }
      if (!response.ok || data.ok !== true) { setState("unavailable"); return; }
      setConnection(data.connection ?? null);
      setState("ready");
    } catch { setState("unavailable"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function send(method: "POST" | "DELETE", path: string, body?: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method, cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "The request failed.");
      if ("connection" in data) setConnection(data.connection ?? null);
      setMessage(typeof data.message === "string" ? data.message : "Done.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request failed.");
      void load();
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  const saved = connection && connection.status !== "DISCONNECTED" && connection.account;
  const snapshot = saved && connection.status === "READ_ONLY" ? connection.snapshot : null;

  return (
    <section className="cc-settings-card" aria-label="MetaTrader 5 investor connection" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <div className="cc-section-head">
        <div>
          <h2>MetaTrader 5 {mode === "positions" ? "positions" : "account"}</h2>
          <p className="cc-lead">Investor (read-only) login. No trading, deposits or withdrawals.</p>
        </div>
      </div>
      <div role="status">
        {state === "loading" && <p>Loading MT5 status…</p>}
        {state === "signed-out" && <p>Sign in as the workspace owner to manage MT5.</p>}
        {state === "unavailable" && <p>MT5 status could not be loaded. No MT5 data is shown or inferred.</p>}
        {state === "not-configured" && <p>Saved connections are not configured on this server yet. No MT5 data is shown.</p>}
        {message && <p>{message}</p>}
      </div>
      {(state === "ready" || state === "not-configured") && !bridge.configured && (
        <div className="cc-notice">
          <span className="cc-notice-icon">i</span>
          <div>
            <strong><span className="cc-pill cc-pill-off">Not connected</span> MT5 bridge</strong>
            <p>{bridge.reason ?? "No MT5 bridge is configured."}</p>
          </div>
        </div>
      )}
      {state === "ready" && saved && (
        <p>
          <span className={"cc-pill " + (snapshot ? "cc-pill-safe" : "cc-pill-muted")}>{snapshot ? "Live read-only" : connection.status === "ERROR" ? "Needs attention" : "Saved · not connected"}</span>{" "}
          Login {connection.account!.login} on {connection.account!.server}.{" "}
          {connection.credentialsSaved ? "Investor password stored encrypted on the server." : "No investor password stored."}
          {connection.status === "ERROR" && connection.lastErrorCode ? " Last error: " + connection.lastErrorCode + "." : ""}
          {mode === "accounts" && <> <button className="cc-text-button" disabled={busy} onClick={() => { if (window.confirm("Delete the saved MT5 investor password?")) void send("DELETE", "/api/connections/mt5"); }}>Disconnect</button></>}
          {bridge.configured && <> <button className="cc-text-button" disabled={busy} onClick={() => void send("POST", "/api/connections/mt5/refresh", "{}")}>Refresh</button></>}
        </p>
      )}
      {snapshot && (
        <>
          {mode === "accounts" && (
            <div className="cc-stats">
              <article><span>Balance</span><strong>{amount(snapshot.account.balance, snapshot.account.currency)}</strong><p>Read <time dateTime={snapshot.capturedAt}>{new Date(snapshot.capturedAt).toLocaleString()}</time></p></article>
              <article><span>Equity</span><strong>{amount(snapshot.account.equity, snapshot.account.currency)}</strong><p>Reported by MT5</p></article>
              <article><span>Free margin</span><strong>{amount(snapshot.account.freeMargin, snapshot.account.currency)}</strong><p>Leverage {snapshot.account.leverage ?? "unknown"}</p></article>
            </div>
          )}
          {snapshot.positions.length === 0 ? <p>MT5 reported no open positions.</p> : (
            <div className="cc-data-table"><table><caption>MT5 open positions</caption>
              <thead><tr><th scope="col">Ticket</th><th scope="col">Symbol</th><th scope="col">Side</th><th scope="col">Volume</th><th scope="col">Open</th><th scope="col">Current</th><th scope="col">Profit</th></tr></thead>
              <tbody>{snapshot.positions.map((p) => <tr key={p.ticket}><td>{p.ticket}</td><th scope="row">{p.symbol}</th><td>{p.side}</td><td>{amount(p.volume)}</td><td>{amount(p.openPrice)}</td><td>{amount(p.currentPrice)}</td><td>{amount(p.profit)}</td></tr>)}</tbody>
            </table></div>
          )}
        </>
      )}
      {state === "ready" && mode === "positions" && !snapshot && <p>No MT5 positions are shown until a bridge is connected.</p>}
      {state === "ready" && mode === "accounts" && (
        <form className="cc-credential-form" onSubmit={(e) => { e.preventDefault(); void send("POST", "/api/connections/mt5", JSON.stringify({ login, server, investorPassword: password })); }}>
          <p className="cc-form-note">
            Use the MT5 <strong>investor</strong> password (read-only), never the master password. It is encrypted on the GEM server and never stored in this browser.
            {!bridge.configured && " Saving now keeps it ready; nothing is read until a bridge is chosen."}
          </p>
          <label className="cc-field">Login
            <input inputMode="numeric" autoComplete="off" pattern="\d{4,12}" value={login} onChange={(e) => setLogin(e.target.value.trim())} required />
          </label>
          <label className="cc-field">Server
            <input autoComplete="off" placeholder="e.g. Bitget-MT5-LIVE1" value={server} onChange={(e) => setServer(e.target.value.trim())} maxLength={64} required />
          </label>
          <label className="cc-field">Investor password
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} required />
          </label>
          <button className="cc-button" disabled={busy}>{busy ? "Saving…" : saved ? "Replace investor login" : "Save investor login"}</button>
        </form>
      )}
    </section>
  );
}
