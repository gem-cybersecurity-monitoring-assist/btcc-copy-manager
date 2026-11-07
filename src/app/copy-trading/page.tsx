"use client";

import "./styles.css";
import CloudAccountPanel from "./CloudAccountPanel";
import { downloadBackup, downloadFile, readLocalWorkspace, writeLocalWorkspace } from "./storage.ts";
import IntelligenceEngine from "./engine/IntelligenceEngine.tsx";
import { appendAudit, compactToBudget, defaultEngineState } from "../../../lib/engine/state.ts";
import type { EngineState } from "../../../lib/engine/types.ts";
import { isWorkspaceEmpty, LIMITS, parseBackupText, toCsv, traderKey, workspaceCounts, type Snapshot, type Trader, type Workspace } from "../../../lib/workspace.ts";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const exchanges = [
  { name: "BTCC", url: "https://www.btcc.com/", action: "Open BTCC", detail: "Sign in directly, then open Copy / Futures Copy Trading to review traders and configure copying." },
  { name: "Bitget", url: "https://www.bitget.com/", action: "Open Bitget", detail: "Sign in directly and use Bitget's native copy-trading interface for enrollment and settings." },
  { name: "MetaTrader 5", url: "https://www.metatrader5.com/", action: "Open MT5", detail: "Use your broker's MT5 terminal for account and strategy access. No MT5 account is connected here." },
];

const VENUES = ["BTCC", "Bitget", "MT5", "Other"];
const MAX_IMPORT_BYTES = 750_000;

function scoreTrader(t: Trader) {
  // Transparent screening heuristic only, not a prediction or financial advice.
  const riskPenalty = Math.min(t.drawdown, 40) * 1.4;
  const historyBonus = t.trades >= 150 ? 8 : t.trades >= 75 ? 4 : 0;
  const returnScore = Math.max(-10, Math.min(t.roi, 30)) * 0.8;
  const winScore = Math.max(0, Math.min(t.winRate, 70) - 40) * 0.35;
  return Math.round(Math.max(0, Math.min(100, 45 + returnScore + winScore + historyBonus - riskPenalty)));
}

/** Current local time formatted for <input type="datetime-local">. */
function localDateTimeValue(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const emptyTraderForm = { name: "", venue: "BTCC", period: "90 days", roi: "", drawdown: "", winRate: "", trades: "", leverage: "Unknown" };
const emptySnapshotForm = () => ({ venue: "BTCC", capturedAt: localDateTimeValue(), equity: "", available: "", unrealizedPnl: "0", note: "" });

export default function CopyTradingPage() {
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState("All");
  const [capital, setCapital] = useState("100");
  const [riskCap, setRiskCap] = useState("10");
  const [saved, setSaved] = useState<string[]>([]);
  const [manualTraders, setManualTraders] = useState<Trader[]>([]);
  const [form, setForm] = useState(emptyTraderForm);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formMessage, setFormMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotForm, setSnapshotForm] = useState(emptySnapshotForm);
  const [snapshotMessage, setSnapshotMessage] = useState("");
  const [storageNotice, setStorageNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [engine, setEngine] = useState<EngineState>(defaultEngineState);
  const backupInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const { workspace, dropped, error } = readLocalWorkspace();
    setManualTraders(workspace.traders);
    setSaved(workspace.savedReviews);
    setSnapshots(workspace.portfolioSnapshots);
    setEngine(workspace.engine ?? defaultEngineState());
    if (error) setStorageNotice(error);
    else if (dropped > 0) setStorageNotice(`${dropped} unreadable browser record(s) were skipped. Valid records were loaded; export a backup to keep a clean copy.`);
    setLoaded(true);
  }, []);

  const currentWorkspace = useCallback((): Workspace => ({ traders: manualTraders, savedReviews: saved, portfolioSnapshots: snapshots, engine }), [manualTraders, saved, snapshots, engine]);

  /** Single write path: update state and browser storage together, and surface storage failures. */
  const persist = useCallback((next: Workspace): string | null => {
    setManualTraders(next.traders);
    setSaved(next.savedReviews);
    setSnapshots(next.portfolioSnapshots);
    setEngine(next.engine ?? defaultEngineState());
    const error = writeLocalWorkspace(next);
    setStorageNotice(error ?? "");
    return error;
  }, []);

  function toggleSaved(name: string) {
    const next = saved.includes(name) ? saved.filter((n) => n !== name) : [...saved, name];
    persist({ ...currentWorkspace(), savedReviews: next });
  }

  function exportBackup() {
    downloadBackup(currentWorkspace());
    setBackupMessage(`Backup exported with ${workspaceCounts(currentWorkspace())}. Keep the file somewhere private; it contains your review notes and balances.`);
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setBackupMessage("Backup file is too large (maximum 750 KB). Your current records were not changed."); return; }
    try {
      const parsed = parseBackupText(await file.text());
      if (!parsed.ok) { setBackupMessage(`${parsed.error} Your current records were not changed.`); return; }
      const current = currentWorkspace();
      if (!isWorkspaceEmpty(current) && !window.confirm(`Replace this browser's ${workspaceCounts(current)} with the backup's ${workspaceCounts(parsed.value)}?\n\nExport a backup first if you want to keep the current records.`)) {
        setBackupMessage("Import cancelled. Your current records were not changed.");
        return;
      }
      setEditingKey(null);
      setForm(emptyTraderForm);
      setFormMessage("");
      setSnapshotMessage("");
      const error = persist(parsed.value);
      setBackupMessage(error ?? `Restored ${workspaceCounts(parsed.value)}.`);
    } catch {
      setBackupMessage("The file could not be read. Your current records were not changed.");
    }
  }

  function addSnapshot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const equity = Number(snapshotForm.equity);
    const available = Number(snapshotForm.available);
    const unrealizedPnl = Number(snapshotForm.unrealizedPnl);
    const capturedAt = new Date(snapshotForm.capturedAt);
    if (!snapshotForm.capturedAt || Number.isNaN(capturedAt.getTime()) || ![equity, available, unrealizedPnl].every(Number.isFinite) || equity < 0 || available < 0 || available > equity) {
      setSnapshotMessage("Check the values: equity and available balance must be non-negative, and available balance cannot exceed equity.");
      return;
    }
    if (capturedAt.getTime() > Date.now() + 5 * 60_000) { setSnapshotMessage("The observation time cannot be in the future."); return; }
    const snapshot: Snapshot = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, venue: snapshotForm.venue, capturedAt: capturedAt.toISOString(), equity, available, unrealizedPnl, note: snapshotForm.note.trim().slice(0, 1000), source: "User-entered; not independently verified" };
    const next = [snapshot, ...snapshots].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const error = persist({ ...currentWorkspace(), portfolioSnapshots: next });
    setSnapshotForm(emptySnapshotForm());
    setSnapshotMessage(error ?? "Portfolio snapshot saved in this browser. This is not live-synced exchange data.");
  }

  function removeSnapshot(snapshot: Snapshot) {
    if (!window.confirm(`Delete the ${snapshot.venue} snapshot from ${new Date(snapshot.capturedAt).toLocaleString()}? This cannot be undone unless you have a backup.`)) return;
    const error = persist({ ...currentWorkspace(), portfolioSnapshots: snapshots.filter((s) => s.id !== snapshot.id) });
    setSnapshotMessage(error ?? "Snapshot deleted from this browser.");
  }

  function exportSnapshotCsv() {
    const csv = toCsv(["exchange", "captured_at", "equity_usdt", "available_usdt", "unrealized_pnl_usdt", "note", "source"], snapshots.map((s) => [s.venue, s.capturedAt, s.equity, s.available, s.unrealizedPnl, s.note, s.source]));
    downloadFile("gem-copy-center-portfolio-snapshots.csv", csv, "text/csv;charset=utf-8;");
    setSnapshotMessage(`Exported ${snapshots.length} portfolio snapshots to CSV.`);
  }

  function exportTraderCsv() {
    const csv = toCsv(["name", "venue", "period", "roi_percent", "max_drawdown_percent", "win_rate_percent", "trade_count", "leverage", "source"], manualTraders.map((t) => [t.name, t.venue, t.period, t.roi, t.drawdown, t.winRate, t.trades, t.leverage, t.history]));
    downloadFile("gem-copy-center-traders.csv", csv, "text/csv;charset=utf-8;");
    setBackupMessage(`Exported ${manualTraders.length} user-entered trader records to CSV.`);
  }

  function saveManualTrader(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roi = Number(form.roi), drawdown = Number(form.drawdown), winRate = Number(form.winRate), trades = Number(form.trades);
    const name = form.name.trim();
    if (!name || name.length > 200 || [form.roi, form.drawdown, form.winRate, form.trades].some((v) => v.trim() === "") || ![roi, drawdown, winRate, trades].every(Number.isFinite) || drawdown < 0 || drawdown > 100 || winRate < 0 || winRate > 100 || trades < 0 || !Number.isInteger(trades)) {
      setFormMessage("Check the trader name and numbers. Drawdown and win rate must be 0–100; trade count must be a whole number.");
      return;
    }
    const trader: Trader = { name, venue: form.venue, period: form.period, roi, drawdown, winRate, trades, leverage: form.leverage, profitShare: "Check venue terms", history: "User-entered", note: "Manually entered from the exchange UI; not independently verified." };
    const key = traderKey(trader);
    const replacing = manualTraders.some((t) => traderKey(t) === key);
    if (replacing && editingKey !== key && !window.confirm(`A ${trader.venue} record named "${trader.name}" already exists. Replace it with these values?`)) return;
    const next = [...manualTraders.filter((t) => traderKey(t) !== key && traderKey(t) !== editingKey), trader];
    const error = persist({ ...currentWorkspace(), traders: next });
    setForm(emptyTraderForm);
    setEditingKey(null);
    setFormMessage(error ?? (replacing || editingKey ? "Trader record updated in this browser." : "Saved in this browser. Values are user-entered and have not been independently verified."));
  }

  function editTrader(t: Trader) {
    setEditingKey(traderKey(t));
    setForm({ name: t.name, venue: VENUES.includes(t.venue) ? t.venue : "Other", period: t.period, roi: String(t.roi), drawdown: String(t.drawdown), winRate: String(t.winRate), trades: String(t.trades), leverage: t.leverage });
    setFormMessage(`Editing ${t.name} (${t.venue}). Save to update, or cancel.`);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function cancelEdit() {
    setEditingKey(null);
    setForm(emptyTraderForm);
    setFormMessage("");
  }

  function removeTrader(t: Trader) {
    if (!window.confirm(`Delete the ${t.venue} trader record "${t.name}"? This cannot be undone unless you have a backup.`)) return;
    const key = traderKey(t);
    const next = manualTraders.filter((m) => traderKey(m) !== key);
    const stillUsed = next.some((m) => m.name === t.name);
    const error = persist({ ...currentWorkspace(), traders: next, savedReviews: stillUsed ? saved : saved.filter((n) => n !== t.name) });
    if (editingKey === key) cancelEdit();
    setFormMessage(error ?? `Deleted ${t.name} (${t.venue}).`);
  }

  /** Engine updates: user actions are written to the engine audit trail before persisting. */
  const updateEngine = useCallback((next: EngineState, audit?: { action: string; detail: string }) => {
    const withAudit = audit ? appendAudit(next, { at: new Date().toISOString(), actor: "user", ...audit }) : next;
    // Keep the whole workspace within the cloud upload limit (with headroom for the request wrapper).
    const rest = new TextEncoder().encode(JSON.stringify({ ...currentWorkspace(), engine: null })).byteLength;
    const budget = LIMITS.maxBytes - rest - 2_000;
    const compacted = compactToBudget(withAudit, budget);
    if (!compacted.ok) {
      setStorageNotice(`That change was not saved: the workspace would exceed the ${Math.round(LIMITS.maxBytes / 1000)} KB backup/cloud limit. Remove unused strategies, return history, or portfolio snapshots first.`);
      return;
    }
    const error = persist({ ...currentWorkspace(), engine: compacted.state });
    if (!error && compacted.trimmed) setStorageNotice(`To stay within the ${Math.round(LIMITS.maxBytes / 1000)} KB workspace limit, the oldest audit events, resolved alerts, and score snapshots were trimmed.`);
  }, [currentWorkspace, persist]);

  const restoreFromCloud = useCallback((workspace: Workspace) => {
    setEditingKey(null);
    setForm(emptyTraderForm);
    setFormMessage("");
    setSnapshotMessage("");
    return persist(workspace);
  }, [persist]);

  const traders = useMemo(() => [...manualTraders]
    .filter((t) => venue === "All" || t.venue === venue)
    .filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => scoreTrader(b) - scoreTrader(a)), [query, venue, manualTraders]);

  const allocation = Math.max(0, Number(capital) || 0);
  const perTrader = Math.max(0, Number(riskCap) || 0);
  const allocationAmount = Math.min(allocation, allocation * Math.min(perTrader, 100) / 100);

  return (
    <main className="copy-shell">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">G</span><span>GEM <span className="muted">/ Copy Center</span></span></a>
        <span className="mode-pill"><i /> Planning mode · No trades executed</span>
      </header>

      {loaded && <IntelligenceEngine engine={engine} onChange={updateEngine} manualTraders={manualTraders} />}

      <CloudAccountPanel getLocalWorkspace={currentWorkspace} onRestore={restoreFromCloud} />
      {storageNotice && <p className="storage-notice" role="alert">{storageNotice}</p>}

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">COPY TRADING WORKSPACE</p>
          <h1>Your copy-trading journey,<br /><span>one clear view.</span></h1>
          <p className="hero-text">Compare traders, plan allocations, and keep your exchange actions in your own hands. Sign-ins and copy-trade setup happen on the exchange itself.</p>
          <div className="hero-actions">
            <a className="primary-btn" href="#exchanges">Connect your workflow <span>↗</span></a>
            <a className="secondary-btn" href="#engine">Open intelligence engine</a>
          </div>
        </div>
        <div className="hero-panel">
          <div className="panel-top"><span>WORKSPACE STATUS</span><span className="status-dot">● LOCAL PREVIEW</span></div>
          <div className="metric-large">Not connected <span>—</span></div>
          <p className="muted">No exchange account or live balance is connected.</p>
          <div className="panel-divider" />
          <div className="panel-row"><span>Exchanges connected by API</span><strong>0</strong></div>
          <div className="panel-row"><span>Providers tracked manually</span><strong>{engine.providers.length}</strong></div>
          <div className="panel-row"><span>Strategies under evaluation</span><strong>{engine.strategies.length}</strong></div>
          <div className="panel-row"><span>Live orders sent by this app</span><strong>0</strong></div>
        </div>
      </section>

      <section id="exchanges" className="section-block">
        <div className="section-heading"><div><p className="eyebrow">01 / EXCHANGE ACCESS</p><h2>Choose where you copy</h2></div><span className="section-note">Official exchange sign-in stays external</span></div>
        <div className="exchange-grid">
          {exchanges.map((exchange) => <article className="exchange-card" key={exchange.name}>
            <div className="exchange-icon">{exchange.name === "BTCC" ? "B" : exchange.name === "Bitget" ? "₿" : "M"}</div>
            <div className="exchange-title-row"><h3>{exchange.name}</h3><span className="external-label">External</span></div>
            <p>{exchange.detail}</p>
            <a href={exchange.url} target="_blank" rel="noreferrer" className="exchange-link">{exchange.action} <span>↗</span></a>
          </article>)}
        </div>
        <p className="safety-note"><strong>Security:</strong> Never enter exchange passwords, 2FA codes, API secrets, wallet seed phrases, or private keys into this dashboard. Confirm trader selection, allocation, and stop-loss settings on the exchange before starting a copy relationship.</p>
      </section>

      <section id="traders" className="section-block">
        <div className="section-heading"><div><p className="eyebrow">02 / RESEARCH & SCREENING</p><h2>Trader comparison</h2></div><span className="demo-label">{manualTraders.length} recorded · Not exchange-verified</span></div>
        <div className="demo-toggle-row"><span className="footnote">Only your recorded profiles appear here. Scores are screening estimates, not verified live exchange performance.</span><a href="/copy-center?view=providers" className="review-btn">View accounts</a></div>
        <div className="data-tools">
          <div><strong>Move your records between devices</strong><span>Stored in this browser · Export a backup file or use cloud upload above to move records</span></div>
          <div className="data-tool-actions">
            <button type="button" className="review-btn" onClick={exportBackup}>Export backup</button>
            <button type="button" className="review-btn" onClick={() => backupInput.current?.click()}>Import backup</button>
            <button type="button" className="review-btn" onClick={exportTraderCsv} disabled={manualTraders.length === 0}>Export trader CSV</button>
            <input ref={backupInput} type="file" accept="application/json,.json" aria-label="Import GEM Copy Center backup" onChange={importBackup} hidden />
          </div>
          {backupMessage && <p className="form-message" role="status">{backupMessage}</p>}
        </div>
        <div className="filters">
          <input aria-label="Search traders" placeholder="Search trader name…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="Filter exchange" value={venue} onChange={(e) => setVenue(e.target.value)}><option>All</option>{VENUES.map((v) => <option key={v}>{v}</option>)}</select>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Trader / venue</th><th>Period</th><th>ROI*</th><th>Max drawdown*</th><th>Win rate*</th><th>Trades*</th><th>Risk screen</th><th>Actions</th></tr></thead>
          <tbody>{traders.length === 0 && <tr><td colSpan={8} className="empty-cell">{!loaded ? "Loading records…" : manualTraders.length === 0 ? "No trader records yet. Add a profile you reviewed on the exchange using the form below." : "No traders match the current search or exchange filter."}</td></tr>}
          {traders.map((t) => <tr key={(t.history === "Demo data" ? "demo:" : "user:") + traderKey(t)}>
            <td><strong>{t.name}</strong><span className="cell-sub">{t.venue} · {t.history}</span></td>
            <td>{t.period}</td><td className={t.roi >= 0 ? "positive" : "negative"}>{t.roi.toFixed(1)}%</td><td>{t.drawdown.toFixed(1)}%</td><td>{t.winRate}%</td><td>{t.trades}</td>
            <td><span className="score">{scoreTrader(t)}/100</span><span className="cell-sub">{t.leverage} leverage</span></td>
            <td><div className="row-actions"><button type="button" className={saved.includes(t.name) ? "saved-btn" : "review-btn"} aria-pressed={saved.includes(t.name)} onClick={() => toggleSaved(t.name)}>{saved.includes(t.name) ? "Saved ✓" : "Save review"}</button>
              {t.history !== "Demo data" && <><button type="button" className="review-btn" onClick={() => editTrader(t)} aria-label={`Edit ${t.name}`}>Edit</button><button type="button" className="danger-btn" onClick={() => removeTrader(t)} aria-label={`Delete ${t.name}`}>Delete</button></>}</div></td>
          </tr>)}</tbody>
        </table></div>
        <p className="footnote">*Demo rows are illustrative; user-entered rows are transcribed by you and not independently verified. The score is a simple screening heuristic, not a forecast. Real evaluation must include verified history, fees, funding, profit share, slippage, leverage, data freshness, and drawdown across different market conditions.</p>
        <div className="manual-entry-card">
          <p className="eyebrow">ADD A REAL PROFILE FROM YOUR EXCHANGE</p><h3>Record a trader for comparison</h3>
          <p className="muted">Open the trader profile on BTCC or Bitget, then transcribe the displayed figures here. This does not connect to the exchange or start copying.</p>
          <form ref={formRef} className="manual-entry-form" onSubmit={saveManualTrader}>
            <label>Trader name<input required maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name or profile ID" /></label>
            <label>Exchange<select value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })}>{VENUES.map((v) => <option key={v}>{v}</option>)}</select></label>
            <label>History period<select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}><option>30 days</option><option>90 days</option><option>180 days</option><option>365 days</option><option>Unknown</option></select></label>
            <label>ROI (%)<input required type="number" step="any" value={form.roi} onChange={(e) => setForm({ ...form, roi: e.target.value })} placeholder="e.g. 8.5" /></label>
            <label>Max drawdown (%)<input required type="number" min="0" max="100" step="any" value={form.drawdown} onChange={(e) => setForm({ ...form, drawdown: e.target.value })} placeholder="e.g. 12" /></label>
            <label>Win rate (%)<input required type="number" min="0" max="100" step="any" value={form.winRate} onChange={(e) => setForm({ ...form, winRate: e.target.value })} placeholder="e.g. 55" /></label>
            <label>Trade count<input required type="number" min="0" step="1" value={form.trades} onChange={(e) => setForm({ ...form, trades: e.target.value })} placeholder="e.g. 120" /></label>
            <label>Leverage profile<select value={form.leverage} onChange={(e) => setForm({ ...form, leverage: e.target.value })}><option>Unknown</option><option>Low</option><option>Low–moderate</option><option>Moderate</option><option>High</option></select></label>
            <button type="submit" className="primary-btn">{editingKey ? "Update trader profile" : "Save trader profile"}</button>
            {editingKey && <button type="button" className="secondary-btn" onClick={cancelEdit}>Cancel edit</button>}
          </form>
          {formMessage && <p className="form-message" role="status">{formMessage}</p>}
        </div>
      </section>

      <section className="section-block portfolio-ledger">
        <div className="section-heading"><div><p className="eyebrow">03 / PORTFOLIO TRACKING</p><h2>Portfolio snapshot ledger</h2></div><span className="demo-label">{snapshots.length} saved snapshots</span></div>
        <p className="muted ledger-intro">Record the balances you see after signing in to each exchange. These are timestamped manual observations, not a live account connection or tax statement.</p>
        <form className="snapshot-form" onSubmit={addSnapshot}>
          <label>Exchange<select value={snapshotForm.venue} onChange={(e) => setSnapshotForm({ ...snapshotForm, venue: e.target.value })}><option>BTCC</option><option>Bitget</option><option>MT5</option><option>MetaMask</option><option>Phantom</option><option>Other</option></select></label>
          <label>Observed at<input required type="datetime-local" value={snapshotForm.capturedAt} onChange={(e) => setSnapshotForm({ ...snapshotForm, capturedAt: e.target.value })} /></label>
          <label>Account equity (USDT equivalent)<input required type="number" min="0" step="any" value={snapshotForm.equity} onChange={(e) => setSnapshotForm({ ...snapshotForm, equity: e.target.value })} placeholder="e.g. 250" /></label>
          <label>Available balance (USDT equivalent)<input required type="number" min="0" step="any" value={snapshotForm.available} onChange={(e) => setSnapshotForm({ ...snapshotForm, available: e.target.value })} placeholder="e.g. 180" /></label>
          <label>Unrealized P&amp;L (USDT equivalent)<input required type="number" step="any" value={snapshotForm.unrealizedPnl} onChange={(e) => setSnapshotForm({ ...snapshotForm, unrealizedPnl: e.target.value })} /></label>
          <label>Note (optional)<input maxLength={1000} value={snapshotForm.note} onChange={(e) => setSnapshotForm({ ...snapshotForm, note: e.target.value })} placeholder="Account type or context" /></label>
          <button type="submit" className="primary-btn">Save snapshot</button>
        </form>
        {snapshotMessage && <p className="form-message" role="status">{snapshotMessage}</p>}
        <div className="ledger-toolbar"><span className="footnote">Manual entries only · values in USDT-equivalent terms</span><button className="review-btn" onClick={exportSnapshotCsv} type="button" disabled={snapshots.length === 0}>Export snapshot CSV</button></div>
        <div className="table-wrap"><table><thead><tr><th>Observed at</th><th>Exchange</th><th>Equity</th><th>Available</th><th>Unrealized P&amp;L</th><th>Note / source</th><th>Actions</th></tr></thead>
          <tbody>{snapshots.length === 0 && <tr><td colSpan={7} className="empty-cell">{loaded ? "No portfolio snapshots yet. Record the balances you see on the exchange using the form above." : "Loading records…"}</td></tr>}
          {snapshots.map((s) => <tr key={s.id}><td>{new Date(s.capturedAt).toLocaleString()}</td><td>{s.venue}</td><td>{s.equity.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td>{s.available.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td className={s.unrealizedPnl >= 0 ? "positive" : "negative"}>{s.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td><td><strong>{s.note || "—"}</strong><span className="cell-sub">{s.source}</span></td><td><button type="button" className="danger-btn" onClick={() => removeSnapshot(s)} aria-label={`Delete snapshot from ${new Date(s.capturedAt).toLocaleString()}`}>Delete</button></td></tr>)}</tbody>
        </table></div>
      </section>

      <section className="section-block planner">
        <div><p className="eyebrow">04 / ALLOCATION PLANNER</p><h2>Set a planning limit</h2><p className="muted">Use this calculator to think through a cap before configuring the exchange. It does not move funds or change exchange settings.</p></div>
        <div className="planner-card">
          <label htmlFor="capital">Capital you are considering (USDT)</label>
          <input id="capital" inputMode="decimal" type="number" min="0" value={capital} onChange={(e) => setCapital(e.target.value)} />
          <label htmlFor="risk-cap">Maximum allocation to one trader (%)</label>
          <input id="risk-cap" inputMode="decimal" type="number" min="0" max="100" value={riskCap} onChange={(e) => setRiskCap(e.target.value)} />
          <div className="planner-result"><span>Illustrative per-trader cap</span><strong>{allocationAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</strong></div>
          <p className="footnote">Planning estimate only. It is not a loss limit and does not guarantee the amount you can lose will stay within this cap.</p>
        </div>
      </section>

      <section className="section-block checklist">
        <div><p className="eyebrow">05 / BEFORE YOU COPY</p><h2>Quick risk checklist</h2></div>
        <ul>
          <li><span>01</span><div><strong>Check the full history</strong><p>Look at 30/90/180-day performance, worst drawdown, and performance during different market conditions.</p></div></li>
          <li><span>02</span><div><strong>Understand the cost</strong><p>Include trading fees, funding, slippage, and any copy-trading profit share before comparing net returns.</p></div></li>
          <li><span>03</span><div><strong>Limit exposure</strong><p>Set a small initial allocation and check leverage, margin mode, open positions, and liquidation risk.</p></div></li>
          <li><span>04</span><div><strong>Know how to stop</strong><p>Find the exchange's native stop-copy and position-close options before activating copy trading.</p></div></li>
        </ul>
      </section>

      <footer className="footer"><span>GEM Copy Center · Working preview</span><span>Browser-local records · Manual account snapshots · No trade execution</span></footer>
    </main>
  );
}
