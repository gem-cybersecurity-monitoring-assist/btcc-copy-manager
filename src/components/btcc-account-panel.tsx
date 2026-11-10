"use client";

// Owner view of BTCC: live adapter status (provider unavailable while the API is
// suspended) and owner-imported CSV data, always labelled "owner-imported, not live".
// CSV text is read in memory and posted once; nothing is kept in browser storage.
import { useCallback, useEffect, useState } from "react";

type Kind = "balances" | "positions" | "copy_history";
type Section = { kind: Kind; importedAt: string; fileName: string | null; rowCount: number; rows: Record<string, unknown>[] };
type Imports = { label: string; sections: Partial<Record<Kind, Section>> };
type Adapter =
  | { status: "provider_unavailable"; code: string; reason: string; noticeUrl: string; checkedAt: string; missing?: string[] }
  | { status: "available"; checkedAt: string; note: string; positions: Record<string, unknown>[] };

const KIND_LABEL: Record<Kind, string> = { balances: "Balances", positions: "Positions", copy_history: "Copy history" };
const COLUMNS: Record<Kind, Array<[string, string]>> = {
  balances: [["coin", "Coin"], ["total", "Total"], ["available", "Available"], ["locked", "Locked"], ["usdValue", "USD value"]],
  positions: [["symbol", "Symbol"], ["side", "Side"], ["size", "Size"], ["entryPrice", "Entry"], ["markPrice", "Mark"], ["leverage", "Leverage"], ["unrealizedPnl", "Unrealized PnL"]],
  copy_history: [["trader", "Trader"], ["symbol", "Symbol"], ["side", "Side"], ["size", "Size"], ["openedAt", "Opened"], ["closedAt", "Closed"], ["realizedPnl", "Realized PnL"], ["fee", "Fee"]],
};
const MAX_FILE = 512 * 1024;

function cell(key: string, value: unknown) {
  if (value === null || value === undefined) return "Unknown";
  if ((key === "openedAt" || key === "closedAt") && typeof value === "string") return new Date(value).toLocaleString();
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
  return String(value);
}

function ImportedTable({ section, onClear, busy }: { section: Section; onClear?: () => void; busy: boolean }) {
  const shown = section.rows.slice(0, 200);
  return (
    <div style={{ minWidth: 0 }}>
      <p>
        <span className="cc-pill cc-pill-muted">Owner-imported · not live</span>{" "}
        <strong>{KIND_LABEL[section.kind]}</strong>: {section.rowCount} row{section.rowCount === 1 ? "" : "s"}
        {section.fileName ? " from " + section.fileName : ""}, imported{" "}
        <time dateTime={section.importedAt}>{new Date(section.importedAt).toLocaleString()}</time>.
        {onClear && <> <button className="cc-text-button" disabled={busy} onClick={onClear}>Remove</button></>}
      </p>
      {section.rows.length === 0 ? <p>The imported file had no rows.</p> : (
        <div className="cc-data-table">
          <table>
            <caption>BTCC {KIND_LABEL[section.kind].toLowerCase()} (owner-imported, not live)</caption>
            <thead><tr>{COLUMNS[section.kind].map(([, label]) => <th scope="col" key={label}>{label}</th>)}</tr></thead>
            <tbody>{shown.map((row, index) => (
              <tr key={index}>{COLUMNS[section.kind].map(([key]) => <td key={key}>{cell(key, row[key])}</td>)}</tr>
            ))}</tbody>
          </table>
          {section.rows.length > shown.length && <p>Showing the first {shown.length} of {section.rows.length} rows.</p>}
        </div>
      )}
    </div>
  );
}

export function BtccAccountPanel({ mode = "accounts" }: { mode?: "accounts" | "positions" }) {
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "unavailable">("loading");
  const [adapter, setAdapter] = useState<Adapter | null>(null);
  const [imports, setImports] = useState<Imports | null>(null);
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [kind, setKind] = useState<Kind>("balances");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [details, setDetails] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connections/btcc", { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) { setState("signed-out"); return; }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) { setState("unavailable"); return; }
      setAdapter(data.adapter ?? null);
      setImports(data.imports ?? null);
      setStorageConfigured(data.storage?.configured !== false);
      setState("ready");
    } catch { setState("unavailable"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function checkProvider() {
    setBusy(true); setMessage(""); setDetails([]);
    try {
      const response = await fetch("/api/connections/btcc/check", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "The BTCC check failed.");
      setAdapter(data.adapter);
      setMessage(data.adapter?.status === "available" ? "BTCC responded to a read-only check." : "BTCC is still unavailable. See the reason below.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The BTCC check failed."); }
    finally { setBusy(false); }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setMessage(""); setDetails([]);
    try {
      if (file.size > MAX_FILE) throw new Error("The CSV file is larger than 512 KB. Export a shorter range.");
      const csv = await file.text();
      const response = await fetch("/api/connections/btcc/import", {
        method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, fileName: file.name, csv }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) {
        setDetails(Array.isArray(data.details) ? data.details.filter((d: unknown) => typeof d === "string").slice(0, 10) : []);
        throw new Error(typeof data.error === "string" ? data.error : "The import failed.");
      }
      setImports(data.imports ?? null);
      setFile(null);
      (event.target as HTMLFormElement).reset();
      setMessage(`Imported ${data.imported?.rowCount ?? 0} ${KIND_LABEL[kind].toLowerCase()} rows. They are shown as owner-imported, not live.`);
      if (data.ledgerRecorded) window.dispatchEvent(new Event("gem:account-evidence-changed"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "The import failed."); }
    finally { setBusy(false); }
  }

  async function clear(section: Kind) {
    if (!window.confirm(`Remove the imported BTCC ${KIND_LABEL[section].toLowerCase()}?`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/connections/btcc/import?kind=" + section, { method: "DELETE", cache: "no-store", credentials: "same-origin" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "Removal failed.");
      setImports(data.imports ?? null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Removal failed."); }
    finally { setBusy(false); }
  }

  const sections = imports?.sections ?? {};
  const visibleKinds: Kind[] = mode === "positions" ? ["positions", "copy_history"] : ["balances", "positions", "copy_history"];

  return (
    <section className="cc-settings-card" aria-label="BTCC account" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <div className="cc-section-head">
        <div>
          <h2>BTCC {mode === "positions" ? "positions and copy history" : "account"}</h2>
          <p className="cc-lead">Read-only. No trading, follows, transfers or withdrawals.</p>
        </div>
        {mode === "accounts" && state === "ready" && (
          <button className="cc-card-button" disabled={busy} onClick={() => void checkProvider()}>{busy ? "Checking…" : "Check BTCC API now"}</button>
        )}
      </div>
      <div role="status">
        {state === "loading" && <p>Loading BTCC status…</p>}
        {state === "signed-out" && <p>Sign in as the workspace owner to see BTCC data.</p>}
        {state === "unavailable" && <p>BTCC status could not be loaded. No BTCC data is shown or inferred.</p>}
        {message && <p>{message}</p>}
        {details.length > 0 && <ul>{details.map((d) => <li key={d}>{d}</li>)}</ul>}
      </div>
      {state === "ready" && adapter && (
        adapter.status === "provider_unavailable" ? (
          <div className="cc-notice">
            <span className="cc-notice-icon">i</span>
            <div>
              <strong><span className="cc-pill cc-pill-off">Provider unavailable</span> Live BTCC API</strong>
              <p>{adapter.reason} <a href={adapter.noticeUrl} target="_blank" rel="noreferrer">BTCC notice</a>. Checked <time dateTime={adapter.checkedAt}>{new Date(adapter.checkedAt).toLocaleString()}</time>.</p>
            </div>
          </div>
        ) : (
          <div>
            <p><span className="cc-pill cc-pill-safe">Live read-only</span> BTCC API responded at <time dateTime={adapter.checkedAt}>{new Date(adapter.checkedAt).toLocaleString()}</time>. {adapter.note}</p>
            {adapter.positions.length === 0 ? <p>BTCC reported no open positions.</p> : (
              <div className="cc-data-table"><table><caption>BTCC live positions</caption>
                <thead><tr>{COLUMNS.positions.filter(([k]) => k !== "markPrice").map(([, l]) => <th scope="col" key={l}>{l}</th>)}</tr></thead>
                <tbody>{adapter.positions.map((p, i) => <tr key={i}>{COLUMNS.positions.filter(([k]) => k !== "markPrice").map(([k]) => <td key={k}>{cell(k, p[k])}</td>)}</tr>)}</tbody>
              </table></div>
            )}
          </div>
        )
      )}
      {state === "ready" && visibleKinds.map((k) => sections[k]
        ? <ImportedTable key={k} section={sections[k]!} busy={busy} onClear={mode === "accounts" ? () => void clear(k) : undefined} />
        : mode === "accounts" ? <p key={k}>{KIND_LABEL[k]}: no owner import yet.</p> : null)}
      {state === "ready" && mode === "positions" && !sections.positions && !sections.copy_history && (
        <p>No BTCC positions or copy history imported. Import a CSV export in Accounts.</p>
      )}
      {state === "ready" && mode === "accounts" && (
        storageConfigured ? (
          <form className="cc-credential-form" onSubmit={(e) => void upload(e)}>
            <p className="cc-form-note">
              Import a CSV you exported from BTCC. It is stored for your account and always shown as owner-imported, not live.
              Do not upload files that contain passwords or API keys.
            </p>
            <label className="cc-field">File contains
              <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                <option value="balances">Balances</option>
                <option value="positions">Positions</option>
                <option value="copy_history">Copy history</option>
              </select>
            </label>
            <label className="cc-field">CSV file (max 512 KB)
              <input type="file" accept=".csv,text/csv" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <button className="cc-button" disabled={busy || !file}>{busy ? "Importing…" : "Import CSV"}</button>
          </form>
        ) : <p>CSV imports are unavailable until server storage is configured.</p>
      )}
    </section>
  );
}
