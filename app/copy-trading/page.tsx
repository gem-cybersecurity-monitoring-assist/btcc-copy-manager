"use client";

import { useMemo, useState } from "react";

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
  const [showDemo, setShowDemo] = useState(true);

  const traders = useMemo(() => demoTraders
    .filter((t) => venue === "All" || t.venue === venue)
    .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => scoreTrader(b) - scoreTrader(a)), [query, venue]);

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
        <div className="section-heading"><div><p className="eyebrow">02 / RESEARCH & SCREENING</p><h2>Trader comparison</h2></div><span className="demo-label">Illustrative demo data</span></div>
        {showDemo && <div className="demo-warning"><strong>Demo only.</strong> These trader names and statistics are examples to demonstrate the comparison UI. They are not live exchange results and must not be used to choose a real trader. <button onClick={() => setShowDemo(false)} aria-label="Dismiss demo notice">Dismiss</button></div>}
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
            <td><button className={saved.includes(t.name) ? "saved-btn" : "review-btn"} onClick={() => setSaved((old) => old.includes(t.name) ? old.filter((n) => n !== t.name) : [...old, t.name])}>{saved.includes(t.name) ? "Saved ✓" : "Save review"}</button></td>
          </tr>)}</tbody>
        </table></div>
        <p className="footnote">*Illustrative values only. The score is a simple screening heuristic, not a forecast. Real evaluation must include verified history, fees, funding, profit share, slippage, leverage, data freshness, and drawdown across different market conditions.</p>
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

      <footer className="footer"><span>GEM Copy Center · Initial UI prototype</span><span>Manual links only · No live account data · No trade execution</span></footer>
    </main>
  );
}
