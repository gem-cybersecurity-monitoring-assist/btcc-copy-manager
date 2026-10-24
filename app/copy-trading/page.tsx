"use client";

import "./styles.css";

import { useEffect, useMemo, useRef, useState } from "react";

type Trader = {
  name: string;
  venue: string;
  period: string;
  roi: number;
  drawdown: number;
  winRate: number;
  trades: number;
  leverage: string;
  profitShare: string;
  history: string;
  note: string;
};

const demoTraders: Trader[] = [
  { name: "Steady BTC", venue: "BTCC", period: "90 days", roi: 12.4, drawdown: 6.8, winRate: 61, trades: 184, leverage: "Low–moderate", profitShare: "Check venue terms", history: "Demo data", note: "Illustrative profile; replace with verified observations." },
  { name: "Trend Rider", venue: "Bitget", period: "90 days", roi: 24.1, drawdown: 18.7, winRate: 48, trades: 96, leverage: "High", profitShare: "Check venue terms", history: "Demo data", note: "Higher return is paired with materially higher drawdown." },
  { name: "Balanced Swing", venue: "BTCC", period: "180 days", roi: 16.2, drawdown: 9.1, winRate: 57, trades: 231, leverage: "Moderate", profitShare: "Check venue terms", history: "Demo data", note: "Longer illustrative history; still needs source verification." },
];

const exchanges = [
  { name: "BTCC", url: "https://www.btcc.com/", action: "Open BTCC", detail: "Sign in directly, then open Copy / Futures Copy Trading to review traders and configure copying." },
  { name: "Bitget", url: "https://www.bitget.com/", action: "Open Bitget", detail: "Sign in directly and use Bitget's native copy-trading interface for enrollment and settings." },
  { name: "MetaTrader 5", url: "https://www.metatrader5.com/", action: "Open MT5", detail: "Use your broker's MT5 terminal for account and strategy access. No MT5 account is connected here." },
];

function scoreTrader(t: Trader) {
  // Transparent screening heuristic only, not a prediction or financial advice.
  const riskPenalty = Math.min(t.drawdown, 40) * 1.4;
  const historyBonus = t.trades >= 150 ? 8 : t.trades >= 75 ? 4 : 0;
  const returnScore = Math.max(-10, Math.min(t.roi, 30)) * 0.8;
  const winScore = Math.max(0, Math.min(t.winRate, 70) - 40) * 0.35;
  return Math.round(Math.max(0, Math.min(100, 45 + returnScore + winScore + historyBonus - riskPenalty)));
}

export default function CopyTradingPage() {
  const [query, setQuery] = useState("");
  const [venue, setVenue] = useState("All");
  const [capital, setCapital] = useState("100");
  const [riskCap, setRiskCap] = useState("10");
  const [saved, setSaved] = useState<string[]>([]);
  const [manualTraders, setManualTraders] = useState<Trader[]>([]);
  const [showDemo, setShowDemo] = useState(true);
  const [form, setForm] = useState({ name: "", venue: "BTCC", period: "90 days", roi: "", drawdown: "", winRate: "", trades: "", leverage: "Unknown" });
  const [formMessage, setFormMessage] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const backupInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const storedTraders = localStorage.getItem("gem-copy-center-traders-v1");
      const storedSaved = localStorage.getItem("gem-copy-center-saved-v1");
      if (storedTraders) setManualTraders(JSON.parse(storedTraders) as Trader[]);
      if (storedSaved) setSaved(JSON.parse(storedSaved) as string[]);
    } catch { /* Ignore invalid local browser data and keep the dashboard usable. */ }
  }, []);

  function toggleSaved(name: string) {
    setSaved((old) => {
      const next = old.includes(name) ? old.filter((n) => n !== name) : [...old, name];
      try { localStorage.setItem("gem-copy-center-saved-v1", JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
      return next;
    });
  }

  function exportBackup() {
    const payload = { schema: "gem-copy-center-backup-v1", exportedAt: new Date().toISOString(), traders: manualTraders, savedReviews: saved };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "gem-copy-center-backup.json";
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage("Backup exported. Keep the file somewhere private; it contains your saved review notes.");
  }

  async function importBackup(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { schema?: string; traders?: Trader[]; savedReviews?: string[] };
      if (parsed.schema !== "gem-copy-center-backup-v1" || !Array.isArray(parsed.traders) || !Array.isArray(parsed.savedReviews)) {
        throw new Error("This file is not a supported GEM Copy Center backup.");
      }
      const valid = parsed.traders.every((t) => t && typeof t.name === "string" && t.name.trim() && typeof t.venue === "string" && typeof t.period === "string" && Number.isFinite(t.roi) && Number.isFinite(t.drawdown) && t.drawdown >= 0 && t.drawdown <= 100 && Number.isFinite(t.winRate) && t.winRate >= 0 && t.winRate <= 100 && Number.isInteger(t.trades) && t.trades >= 0 && typeof t.leverage === "string" && typeof t.history === "string");
      if (!valid || !parsed.savedReviews.every((name) => typeof name === "string")) {
        throw new Error("Backup validation failed. Your current records were not changed.");
      }
      setManualTraders(parsed.traders);
      setSaved(parsed.savedReviews);
      localStorage.setItem("gem-copy-center-traders-v1", JSON.stringify(parsed.traders));
      localStorage.setItem("gem-copy-center-saved-v1", JSON.stringify(parsed.savedReviews));
      setBackupMessage(`Restored ${parsed.traders.length} trader records and ${parsed.savedReviews.length} review bookmarks in this browser.`);
    } catch (error) {
      setBackupMessage(error instanceof Error ? error.message : "Import failed. Your current records were not changed.");
    } finally {
      event.target.value = "";
    }
  }

  function exportTraderCsv() {
    const headers = ["name", "venue", "period", "roi_percent", "max_drawdown_percent", "win_rate_percent", "trade_count", "leverage", "source"];
    const rows = manualTraders.map((t) => [t.name, t.venue, t.period, t.roi, t.drawdown, t.winRate, t.trades, t.leverage, t.history]);
    const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\\r\\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "gem-copy-center-traders.csv";
    link.click();
    URL.revokeObjectURL(url);
    setBackupMessage(`Exported ${manualTraders.length} user-entered trader records to CSV.`);
  }

  function addManualTrader(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const roi = Number(form.roi), drawdown = Number(form.drawdown), winRate = Number(form.winRate), trades = Number(form.trades);
    if (!form.name.trim() || ![roi, drawdown, winRate, trades].every(Number.isFinite) || drawdown < 0 || drawdown > 100 || winRate < 0 || winRate > 100 || trades < 0 || !Number.isInteger(trades)) {
      setFormMessage("Check the trader name and numbers. Drawdown and win rate must be 0–100; trade count must be a whole number.");
      return;
    }
    const trader: Trader = { name: form.name.trim(), venue: form.venue, period: form.period, roi, drawdown, winRate, trades, leverage: form.leverage, profitShare: "Check venue terms", history: "User-entered", note: "Manually entered from the exchange UI; not independently verified." };
    const next = [...manualTraders.filter((t) => !(t.name.toLowerCase() === trader.name.toLowerCase() && t.venue === trader.venue)), trader];
    setManualTraders(next);
    try { localStorage.setItem("gem-copy-center-traders-v1", JSON.stringify(next)); } catch { /* Storage may be disabled. */ }
    setForm({ name: "", venue: "BTCC", period: "90 days", roi: "", drawdown: "", winRate: "", trades: "", leverage: "Unknown" });
    setFormMessage("Saved in this browser. Values are user-entered and have not been independently verified.");
  }

  const traders = useMemo(() => [...(showDemo ? demoTraders : []), ...manualTraders]
    .filter((t) => venue === "All" || t.venue === venue)
    .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => scoreTrader(b) - scoreTrader(a)), [query, venue, manualTraders, showDemo]);

  const allocation = Math.max(0, Number(capital) || 0);
  const perTrader = Math.max(0, Number(riskCap) || 0);
  const allocationAmount = Math.min(allocation, allocation * Math.min(perTrader, 100) / 100);

  return (
    <main className="copy-shell">
      <header className="topbar">
        <a className="brand" href="/"><span className="brand-mark">G</span><span>GEM <span className="muted">/ Copy Center</span></span></a>
        <span className="mode-pill"><i /> Planning mode · No trades executed</span>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">COPY TRADING WORKSPACE</p>
          <h1>Your copy-trading journey,<br /><span>one clear view.</span></h1>
          <p className="hero-text">Compare traders, plan allocations, and keep your exchange actions in your own hands. Sign-ins and copy-trade setup happen on the exchange itself.</p>
          <div className="hero-actions">
            <a className="primary-btn" href="#exchanges">Connect your workflow <span>↗</span></a>
            <a className="secondary-btn" href="#traders">Review trader scores</a>
          </div>
        </div>
        <div className="hero-panel">
          <div className="panel-top"><span>WORKSPACE STATUS</span><span className="status-dot">● LOCAL PREVIEW</span></div>
          <div className="metric-large">Not connected <span>—</span></div>
          <p className="muted">No exchange account or live balance is connected.</p>
          <div className="panel-divider" />
          <div className="panel-row"><span>Connected exchanges</span><strong>0</strong></div>
          <div className="panel-row"><span>Verified live traders</span><strong>0</strong></div>
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
        <div className="section-heading"><div><p className="eyebrow">02 / RESEARCH & SCREENING</p><h2>Trader comparison</h2></div><span className="demo-label">{manualTraders.length} user-entered · {showDemo ? "demo visible" : "demo hidden"}</span></div>
        {showDemo && <div className="demo-warning"><strong>Demo only.</strong> These trader names and statistics are examples to demonstrate the comparison UI. They are not live exchange results and must not be used to choose a real trader. <button onClick={() => setShowDemo(false)} aria-label="Dismiss demo notice">Dismiss</button></div>}
        <div className="demo-toggle-row"><button className="review-btn" onClick={() => setShowDemo((v) => !v)}>{showDemo ? "Hide demo rows" : "Show demo rows"}</button><span className="footnote">Manually entered trader stats are stored only in this browser.</span></div>
        <div className="data-tools">
          <div><strong>Move your records between devices</strong><span>Local browser storage only · No cloud account yet</span></div>
          <div className="data-tool-actions">
            <button className="review-btn" onClick={exportBackup}>Export backup</button>
            <button className="review-btn" onClick={() => backupInput.current?.click()}>Import backup</button>
            <button className="review-btn" onClick={exportTraderCsv}>Export CSV</button>
            <input ref={backupInput} type="file" accept="application/json,.json" aria-label="Import GEM Copy Center backup" onChange={importBackup} hidden />
          </div>
          {backupMessage && <p className="form-message" role="status">{backupMessage}</p>}
        </div>
        <div className="filters">
          <input aria-label="Search traders" placeholder="Search trader name…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="Filter exchange" value={venue} onChange={(e) => setVenue(e.target.value)}><option>All</option><option>BTCC</option><option>Bitget</option></select>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>Trader / venue</th><th>Period</th><th>ROI*</th><th>Max drawdown*</th><th>Win rate*</th><th>Trades*</th><th>Risk screen</th><th>Review</th></tr></thead>
          <tbody>{traders.map((t) => <tr key={t.name}>
            <td><strong>{t.name}</strong><span className="cell-sub">{t.venue} · {t.history}</span></td>
            <td>{t.period}</td><td className={t.roi >= 0 ? "positive" : "negative"}>{t.roi.toFixed(1)}%</td><td>{t.drawdown.toFixed(1)}%</td><td>{t.winRate}%</td><td>{t.trades}</td>
            <td><span className="score">{scoreTrader(t)}/100</span><span className="cell-sub">{t.leverage} leverage</span></td>
            <td><button className={saved.includes(t.name) ? "saved-btn" : "review-btn"} onClick={() => toggleSaved(t.name)}>{saved.includes(t.name) ? "Saved ✓" : "Save review"}</button></td>
          </tr>)}</tbody>
        </table></div>
        <p className="footnote">*Illustrative values only. The score is a simple screening heuristic, not a forecast. Real evaluation must include verified history, fees, funding, profit share, slippage, leverage, data freshness, and drawdown across different market conditions.</p>
        <div className="manual-entry-card">
          <p className="eyebrow">ADD A REAL PROFILE FROM YOUR EXCHANGE</p><h3>Record a trader for comparison</h3>
          <p className="muted">Open the trader profile on BTCC or Bitget, then transcribe the displayed figures here. This does not connect to the exchange or start copying.</p>
          <form className="manual-entry-form" onSubmit={addManualTrader}>
            <label>Trader name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name or profile ID" /></label>
            <label>Exchange<select value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })}><option>BTCC</option><option>Bitget</option><option>MT5</option><option>Other</option></select></label>
            <label>History period<select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}><option>30 days</option><option>90 days</option><option>180 days</option><option>365 days</option><option>Unknown</option></select></label>
            <label>ROI (%)<input required type="number" step="any" value={form.roi} onChange={(e) => setForm({ ...form, roi: e.target.value })} placeholder="e.g. 8.5" /></label>
            <label>Max drawdown (%)<input required type="number" min="0" max="100" step="any" value={form.drawdown} onChange={(e) => setForm({ ...form, drawdown: e.target.value })} placeholder="e.g. 12" /></label>
            <label>Win rate (%)<input required type="number" min="0" max="100" step="any" value={form.winRate} onChange={(e) => setForm({ ...form, winRate: e.target.value })} placeholder="e.g. 55" /></label>
            <label>Trade count<input required type="number" min="0" step="1" value={form.trades} onChange={(e) => setForm({ ...form, trades: e.target.value })} placeholder="e.g. 120" /></label>
            <label>Leverage profile<select value={form.leverage} onChange={(e) => setForm({ ...form, leverage: e.target.value })}><option>Unknown</option><option>Low</option><option>Low–moderate</option><option>Moderate</option><option>High</option></select></label>
            <button type="submit" className="primary-btn">Save trader profile</button>
          </form>
          {formMessage && <p className="form-message" role="status">{formMessage}</p>}
        </div>
      </section>

      <section className="section-block planner">
        <div><p className="eyebrow">03 / ALLOCATION PLANNER</p><h2>Set a planning limit</h2><p className="muted">Use this calculator to think through a cap before configuring the exchange. It does not move funds or change exchange settings.</p></div>
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
        <div><p className="eyebrow">04 / BEFORE YOU COPY</p><h2>Quick risk checklist</h2></div>
        <ul>
          <li><span>01</span><div><strong>Check the full history</strong><p>Look at 30/90/180-day performance, worst drawdown, and performance during different market conditions.</p></div></li>
          <li><span>02</span><div><strong>Understand the cost</strong><p>Include trading fees, funding, slippage, and any copy-trading profit share before comparing net returns.</p></div></li>
          <li><span>03</span><div><strong>Limit exposure</strong><p>Set a small initial allocation and check leverage, margin mode, open positions, and liquidation risk.</p></div></li>
          <li><span>04</span><div><strong>Know how to stop</strong><p>Find the exchange's native stop-copy and position-close options before activating copy trading.</p></div></li>
        </ul>
      </section>

      <footer className="footer"><span>GEM Copy Center · Working preview</span><span>Browser-local records · No live account data · No trade execution</span></footer>
    </main>
  );
}
