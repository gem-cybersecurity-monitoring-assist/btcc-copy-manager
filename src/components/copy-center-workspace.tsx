"use client";

import { useEffect, useMemo, useState } from "react";

type ProviderKind = "exchange" | "wallet" | "identity" | "terminal";
type Provider = { id: string; name: string; kind: ProviderKind; description: string; state: "not-connected" | "connected"; note: string };
type Activity = { id: string; at: string; title: string; detail: string };

const starterProviders: Provider[] = [
  { id: "btcc", name: "BTCC", kind: "exchange", description: "Exchange account and copy-trading research.", state: "not-connected", note: "Connect status is not yet verified. Start with read-only access." },
  { id: "bitget", name: "Bitget", kind: "exchange", description: "Exchange account and provider performance.", state: "not-connected", note: "Connector implementation and permissions need verification." },
  { id: "phantom", name: "Phantom", kind: "wallet", description: "Solana wallet visibility.", state: "not-connected", note: "Wallet connection is not implemented in this release." },
  { id: "metamask", name: "MetaMask", kind: "wallet", description: "EVM wallet visibility.", state: "not-connected", note: "Wallet connection is not implemented in this release." },
  { id: "base", name: "Base", kind: "wallet", description: "Base network assets and wallet activity.", state: "not-connected", note: "Use a compatible wallet; Base is a network, not an exchange." },
  { id: "farcaster", name: "Farcaster", kind: "identity", description: "Social identity and public profile context.", state: "not-connected", note: "Identity linking is not implemented in this release." },
  { id: "mt5", name: "MetaTrader 5", kind: "terminal", description: "External trading terminal / broker account.", state: "not-connected", note: "Broker integration is not implemented in this release." }
];

const nav = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "providers", label: "Connections", icon: "⛓" },
  { id: "portfolio", label: "Portfolio", icon: "▤" },
  { id: "risk", label: "Risk controls", icon: "◈" },
  { id: "activity", label: "Activity", icon: "≡" },
  { id: "settings", label: "Settings", icon: "⚙" }
] as const;
type View = typeof nav[number]["id"];

function money(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

export function CopyCenterWorkspace() {
  const [view, setView] = useState<View>("overview");
  const [providers, setProviders] = useState<Provider[]>(starterProviders);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [budget, setBudget] = useState("10");
  const [maxLoss, setMaxLoss] = useState("2");
  const [selected, setSelected] = useState<Provider | null>(null);
  const [toast, setToast] = useState("");
  const [storageReady, setStorageReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gem-copy-center-workspace-v1");
      if (raw) {
        const saved = JSON.parse(raw) as { providers?: Provider[]; activity?: Activity[]; budget?: string; maxLoss?: string };
        if (saved.providers) setProviders(starterProviders.map((base) => saved.providers!.find((p) => p.id === base.id) ?? base));
        if (saved.activity) setActivity(saved.activity);
        if (saved.budget) setBudget(saved.budget);
        if (saved.maxLoss) setMaxLoss(saved.maxLoss);
      }
    } catch { /* Start with a safe blank workspace if saved data is invalid. */ }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem("gem-copy-center-workspace-v1", JSON.stringify({ providers, activity: activity.slice(0, 50), budget, maxLoss }));
    } catch { setToast("This browser could not save workspace changes."); }
  }, [providers, activity, budget, maxLoss, storageReady]);

  const connectedCount = providers.filter((p) => p.state === "connected").length;
  const exchangeCount = providers.filter((p) => p.kind === "exchange" && p.state === "connected").length;
  const budgetValue = Math.max(0, Number(budget) || 0);
  const lossValue = Math.max(0, Number(maxLoss) || 0);
  const perProviderRisk = useMemo(() => budgetValue * lossValue / 100, [budgetValue, lossValue]);

  function log(title: string, detail: string) {
    setActivity((old) => [{ id: crypto.randomUUID(), at: new Date().toISOString(), title, detail }, ...old].slice(0, 50));
  }
  function requestConnection(provider: Provider) {
    setSelected(provider);
    setToast("");
  }
  function confirmNotConnected(provider: Provider) {
    log("Connection setup reviewed", provider.name + ": " + provider.note);
    setSelected(null);
    setToast(provider.name + " is still marked not connected. No account was accessed.");
  }

  return <div className="cc-shell">
    <aside className="cc-sidebar" aria-label="Main navigation">
      <div className="cc-brand"><div className="cc-mark">G</div><div><strong>GEM Copy Center</strong><small>Multi-provider workspace</small></div></div>
      <div className="cc-workspace-label">WORKSPACE</div>
      <nav>{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
      <div className="cc-side-note"><span className="cc-status-dot" /><div><strong>Safe setup mode</strong><small>No live actions enabled here</small></div></div>
    </aside>

    <main className="cc-main">
      <header className="cc-topbar">
        <div><p className="cc-eyebrow">GEM SERVER SECURITY / COPY CENTER</p><h1>{nav.find((item) => item.id === view)?.label}</h1></div>
        <div className="cc-top-right"><span className="cc-pill cc-pill-muted">DEVELOPMENT WORKSPACE</span><a className="cc-advanced-link" href="/advanced-btcc">Advanced BTCC tools ↗</a></div>
      </header>

      <nav className="cc-mobile-nav" aria-label="Mobile navigation">{nav.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>
      {toast && <div className="cc-toast" role="status"><span>{toast}</span><button onClick={() => setToast("")} aria-label="Dismiss">×</button></div>}

      {view === "overview" && <div className="cc-page">
        <section className="cc-welcome"><div><p className="cc-eyebrow">ONE PLACE TO MONITOR YOUR PROVIDERS</p><h2>Your trading workspace,<br /><span>made easier to manage.</span></h2><p>Review connections, organize providers, set small test allocations, and understand risk before considering any trade.</p><div className="cc-hero-actions"><button className="cc-button" onClick={() => setView("providers")}>Review connections <span>→</span></button><button className="cc-button cc-button-secondary" onClick={() => setView("risk")}>Set risk limits</button></div></div><div className="cc-hero-art" aria-hidden="true"><div className="cc-orbit cc-orbit-one" /><div className="cc-orbit cc-orbit-two" /><div className="cc-orbit-core">GEM<span>●</span></div><div className="cc-orbit-tag cc-tag-one">MONITOR</div><div className="cc-orbit-tag cc-tag-two">CONTROL</div></div></section>
        <section className="cc-stats"><article><span>Connected providers</span><strong>{connectedCount}<small> / {providers.length}</small></strong><p>Only verified connections count.</p></article><article><span>Exchange connections</span><strong>{exchangeCount}<small> / 2</small></strong><p>BTCC and Bitget require setup.</p></article><article><span>Test allocation per provider</span><strong>{money(budgetValue)}</strong><p>Your planning amount, not a deposit.</p></article><article><span>Risk estimate per provider</span><strong>{money(perProviderRisk)}</strong><p>Illustrative limit from your settings.</p></article></section>
        <section className="cc-section-head"><div><p className="cc-eyebrow">GET STARTED</p><h2>Build your workspace in three steps</h2></div><span className="cc-soft-label">No trades submitted</span></section>
        <section className="cc-step-grid"><button onClick={() => setView("providers")}><span className="cc-step-number">01</span><strong>Review providers</strong><p>See which exchange, wallet, and identity connectors still need setup.</p><span className="cc-step-link">Open connections →</span></button><button onClick={() => setView("risk")}><span className="cc-step-number">02</span><strong>Set your limits</strong><p>Plan small separate allocations and a maximum loss threshold.</p><span className="cc-step-link">Configure limits →</span></button><button onClick={() => setView("portfolio")}><span className="cc-step-number">03</span><strong>Review the portfolio</strong><p>Check the workspace state before enabling any integrations.</p><span className="cc-step-link">View portfolio →</span></button></section>
        <section className="cc-notice"><span className="cc-notice-icon">i</span><div><strong>Honest connection status</strong><p>This build saves planning settings in this browser. Exchange sync, wallet linking, cloud sync, and automatic copy execution are not verified by this interface yet.</p></div></section>
      </div>}

      {view === "providers" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">CONNECTORS</p><h2>Your accounts and services</h2><p className="cc-lead">Each service has a separate status. A setup guide is not the same as a live connection.</p></div><span className="cc-pill cc-pill-muted">{connectedCount} verified</span></section><div className="cc-provider-grid">{providers.map((provider) => <article className="cc-provider-card" key={provider.id}><div className="cc-provider-top"><span className={"cc-provider-icon cc-icon-" + provider.kind}>{provider.name.slice(0, 1)}</span><span className="cc-pill cc-pill-off">Not connected</span></div><p className="cc-provider-kind">{provider.kind}</p><h3>{provider.name}</h3><p className="cc-provider-description">{provider.description}</p><button className="cc-card-button" onClick={() => requestConnection(provider)}>View setup <span>→</span></button></article>)}</div><p className="cc-footnote">Connection state is intentionally not toggled by a button. It will only change after a real connector and authorization check are implemented.</p></div>}

      {view === "portfolio" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">PORTFOLIO OVERVIEW</p><h2>One view, separate allocations</h2><p className="cc-lead">A monitoring layout for future verified balances and positions.</p></div><span className="cc-pill cc-pill-muted">No exchange data loaded</span></section><div className="cc-portfolio-empty"><div className="cc-empty-icon">▤</div><h3>Your portfolio will appear here</h3><p>No live account balances or positions have been imported. Connect a supported provider after its integration passes validation.</p><button className="cc-button" onClick={() => setView("providers")}>Review connections →</button></div><section className="cc-table-card"><div className="cc-table-title"><h3>Provider coverage</h3><span>Setup inventory</span></div><div className="cc-table-wrap"><table><thead><tr><th>Provider</th><th>Type</th><th>Connection</th><th>Next step</th></tr></thead><tbody>{providers.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.kind}</td><td><span className="cc-table-status">Not connected</span></td><td><button className="cc-text-button" onClick={() => requestConnection(p)}>Review</button></td></tr>)}</tbody></table></div></section></div>}

      {view === "risk" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">RISK FIRST</p><h2>Plan limits before providers</h2><p className="cc-lead">These are planning controls only. They do not place orders or configure exchange-side risk.</p></div><span className="cc-pill cc-pill-safe">Planning only</span></section><div className="cc-risk-layout"><section className="cc-settings-card"><h3>Allocation plan</h3><p>Choose a small amount to plan for each independent provider.</p><label className="cc-field">Planned amount per provider <span>USD</span><input type="number" min="0" max="100000" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} /></label><label className="cc-field">Maximum planned loss <span>%</span><input type="number" min="0" max="100" step="0.5" value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)} /></label><div className="cc-form-note">Changes save to this browser automatically. They are not sent to any exchange.</div></section><section className="cc-risk-summary"><p className="cc-eyebrow">ILLUSTRATIVE LIMIT</p><span>Potential loss allowance per provider</span><strong>{money(perProviderRisk)}</strong><div className="cc-risk-bar"><span style={{ width: Math.min(100, lossValue) + "%" }} /></div><p>Based on {money(budgetValue)} planned allocation and a {lossValue}% loss threshold. Fees, slippage, leverage, liquidity, and market gaps can cause losses beyond this estimate.</p><div className="cc-risk-check"><span>✓</span> Separate provider allocations</div><div className="cc-risk-check"><span>✓</span> No automatic order execution in this workspace</div></section></div><section className="cc-notice"><span className="cc-notice-icon">!</span><div><strong>Risk warning</strong><p>Copy trading can lose the entire allocated amount. Small allocations do not remove market, custody, platform, or counterparty risk.</p></div></section></div>}

      {view === "activity" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">WORKSPACE HISTORY</p><h2>Recent activity</h2><p className="cc-lead">Records created by this interface on this browser.</p></div><span className="cc-pill cc-pill-muted">{activity.length} records</span></section>{activity.length ? <div className="cc-activity-list">{activity.map((item) => <article key={item.id}><span className="cc-activity-dot" /><div><strong>{item.title}</strong><p>{item.detail}</p><time>{new Date(item.at).toLocaleString()}</time></div></article>)}</div> : <div className="cc-portfolio-empty"><div className="cc-empty-icon">≡</div><h3>No activity recorded yet</h3><p>Reviewing a provider setup guide will add an entry here. Trades are not initiated from this activity page.</p><button className="cc-button" onClick={() => setView("providers")}>Review a provider</button></div>}</div>}

      {view === "settings" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">WORKSPACE SETTINGS</p><h2>Clear status, safer defaults</h2><p className="cc-lead">Settings for the current browser workspace.</p></div></section><div className="cc-settings-grid"><article className="cc-settings-card"><span className="cc-setting-icon">◉</span><h3>Data storage</h3><p>Planning settings and local activity are saved in this browser only.</p><span className="cc-pill cc-pill-off">Cloud sync not verified</span></article><article className="cc-settings-card"><span className="cc-setting-icon">⛨</span><h3>Execution permissions</h3><p>This friendly workspace does not enable live order execution or withdrawal actions.</p><span className="cc-pill cc-pill-safe">Not enabled here</span></article><article className="cc-settings-card"><span className="cc-setting-icon">↗</span><h3>Advanced BTCC tools</h3><p>The existing BTCC execution interface is kept separate for focused validation.</p><a className="cc-card-button" href="/advanced-btcc">Open advanced tools →</a></article><article className="cc-settings-card"><span className="cc-setting-icon">↻</span><h3>Reset local workspace</h3><p>Restore the default connection inventory and clear this browser's workspace history.</p><button className="cc-card-button" onClick={() => { if (window.confirm("Reset this browser's GEM Copy Center planning data? This cannot be undone.")) { setProviders(starterProviders); setActivity([]); setBudget("10"); setMaxLoss("2"); setToast("Local planning workspace reset."); } }}>Reset local data</button></article></div></div>}
    </main>

    {selected && <div className="cc-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}><section className="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-modal-title"><button className="cc-modal-close" onClick={() => setSelected(null)} aria-label="Close setup">×</button><p className="cc-eyebrow">CONNECTION SETUP</p><span className={"cc-provider-icon cc-icon-" + selected.kind}>{selected.name.slice(0, 1)}</span><h2 id="cc-modal-title">Set up {selected.name}</h2><span className="cc-pill cc-pill-off">Not connected</span><p>{selected.note}</p><ol><li>Open the official service and confirm you can sign in.</li><li>Start with read-only permissions wherever supported.</li><li>Never share passwords, seed phrases, private keys, or API secrets in chat.</li><li>Verify the integration and its status before relying on displayed balances.</li></ol><div className="cc-modal-actions"><button className="cc-button cc-button-secondary" onClick={() => setSelected(null)}>Close</button><button className="cc-button" onClick={() => confirmNotConnected(selected)}>Record review</button></div></section></div>}
  </div>;
}
