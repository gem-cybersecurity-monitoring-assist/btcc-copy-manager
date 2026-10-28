"use client";

import { useEffect, useMemo, useState } from "react";

type ProviderKind = "exchange" | "wallet" | "network" | "identity" | "terminal";
type Provider = { id: string; name: string; kind: ProviderKind; description: string; state: "not-connected" | "connected" | "verified-once"; note: string };
type Activity = { id: string; at: string; title: string; detail: string };
type CloudSession = { configured: boolean; authenticated: boolean; user?: { id: string; email?: string } | null; error?: string };
type WalletAddresses = { phantom?: string; metamask?: string; base?: string };
type EthereumProvider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
type PhantomProvider = { connect: () => Promise<{ publicKey?: { toString: () => string } }>; publicKey?: { toString: () => string }; isConnected?: boolean };

const starterProviders: Provider[] = [
  { id: "btcc", name: "BTCC", kind: "exchange", description: "Exchange account and copy-trading research.", state: "not-connected", note: "Connect status is not yet verified. Start with read-only access." },
  { id: "bitget", name: "Bitget", kind: "exchange", description: "Exchange account and provider performance.", state: "not-connected", note: "Connector implementation and permissions need verification." },
  { id: "phantom", name: "Phantom", kind: "wallet", description: "Solana wallet visibility.", state: "not-connected", note: "Connect Phantom to verify the active public wallet address. No signature or transaction is requested." },
  { id: "metamask", name: "MetaMask", kind: "wallet", description: "EVM wallet visibility.", state: "not-connected", note: "Connect MetaMask to verify the active public wallet address. No signature or transaction is requested." },
  { id: "base", name: "Base", kind: "network", description: "Base network assets and wallet activity.", state: "not-connected", note: "Use MetaMask to select Base mainnet and verify the connected address. No transaction is submitted." },
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
  const [walletAddresses, setWalletAddresses] = useState<WalletAddresses>({});
  const [cloudSession, setCloudSession] = useState<CloudSession>({ configured: false, authenticated: false, user: null });
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [cloudUpdatedAt, setCloudUpdatedAt] = useState<string | null>(null);
  const [bgKey, setBgKey] = useState("");
  const [bgSecret, setBgSecret] = useState("");
  const [bgPhrase, setBgPhrase] = useState("");
  const [bgMessage, setBgMessage] = useState("");
  const [bgBusy, setBgBusy] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gem-copy-center-workspace-v1");
      if (raw) {
        const saved = JSON.parse(raw) as { providers?: Provider[]; activity?: Activity[]; budget?: string; maxLoss?: string };
        if (saved.providers) setProviders(starterProviders.map((base) => {
          const prior = saved.providers!.find((p) => p.id === base.id);
          return prior ? { ...base, note: typeof prior.note === "string" ? prior.note : base.note, state: "not-connected" } : base;
        }));
        if (Array.isArray(saved.activity)) setActivity(saved.activity.filter((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.detail === "string" && !Number.isNaN(Date.parse(item.at))).slice(0, 50));
        if (typeof saved.budget === "string" && Number.isFinite(Number(saved.budget)) && Number(saved.budget) >= 0 && Number(saved.budget) <= 100000) setBudget(saved.budget);
        if (typeof saved.maxLoss === "string" && Number.isFinite(Number(saved.maxLoss)) && Number(saved.maxLoss) >= 0 && Number(saved.maxLoss) <= 100) setMaxLoss(saved.maxLoss);
      }
      const rawWallets = localStorage.getItem("gem-copy-center-wallet-addresses-v1");
      if (rawWallets) {
        const wallets = JSON.parse(rawWallets) as WalletAddresses;
        setWalletAddresses({
          ...(typeof wallets.phantom === "string" ? { phantom: wallets.phantom } : {}),
          ...(typeof wallets.metamask === "string" ? { metamask: wallets.metamask } : {}),
          ...(typeof wallets.base === "string" ? { base: wallets.base } : {})
        });
      }
    } catch { /* Start with a safe blank workspace if saved data is invalid. */ }
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      localStorage.setItem("gem-copy-center-workspace-v1", JSON.stringify({ providers, activity: activity.slice(0, 50), budget, maxLoss }));
      localStorage.setItem("gem-copy-center-wallet-addresses-v1", JSON.stringify(walletAddresses));
    } catch { setToast("This browser could not save workspace changes."); }
  }, [providers, activity, budget, maxLoss, walletAddresses, storageReady]);

  useEffect(() => {
    let active = true;
    void fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .then(({ response, data }) => {
        if (!active) return;
        setCloudSession({
          configured: data.configured === true,
          authenticated: data.authenticated === true,
          user: data.user ?? null,
          ...(typeof data.error === "string" ? { error: data.error } : {})
        });
        if (!response.ok || data.error) setCloudMessage(data.error || "Cloud account status could not be checked.");
      })
      .catch(() => { if (active) setCloudMessage("Cloud account status is temporarily unavailable. Local planning data is still available."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    let active = true;
    const verifyWallets = async () => {
      const w = window as Window & { ethereum?: EthereumProvider; phantom?: { solana?: PhantomProvider } };
      const verified: Record<string, string> = {};
      try {
        if (walletAddresses.metamask && w.ethereum) {
          const accounts = await w.ethereum.request({ method: "eth_accounts" }) as string[];
          if (Array.isArray(accounts) && accounts.some((a) => a.toLowerCase() === walletAddresses.metamask!.toLowerCase())) verified.metamask = accounts.find((a) => a.toLowerCase() === walletAddresses.metamask!.toLowerCase())!;
        }
      } catch { /* Wallet extension is locked or unavailable; never trust stale local state. */ }
      try {
        if (walletAddresses.base && w.ethereum) {
          const chainId = await w.ethereum.request({ method: "eth_chainId" });
          const accounts = await w.ethereum.request({ method: "eth_accounts" }) as string[];
          if (chainId === "0x2105" && Array.isArray(accounts) && accounts.some((a) => a.toLowerCase() === walletAddresses.base!.toLowerCase())) verified.base = accounts.find((a) => a.toLowerCase() === walletAddresses.base!.toLowerCase())!;
        }
      } catch { /* Base is not active in this wallet session. */ }
      try {
        const phantom = w.phantom?.solana;
        const address = phantom?.publicKey?.toString();
        if (phantom?.isConnected && address && walletAddresses.phantom === address) verified.phantom = address;
      } catch { /* Phantom is not connected in this wallet session. */ }
      if (!active) return;
      setProviders((old) => old.map((p) => {
        const address = verified[p.id as keyof typeof verified];
        return ["phantom", "metamask", "base"].includes(p.id)
          ? { ...p, state: address ? "connected" : "not-connected", note: address ? "Wallet session verified: " + address.slice(0, 7) + "…" + address.slice(-5) : starterProviders.find((s) => s.id === p.id)!.note }
          : p;
      }));
    };
    void verifyWallets();
    return () => { active = false; };
  }, [storageReady, walletAddresses]);

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

  async function refreshCloudSession() {
    const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    setCloudSession({ configured: data.configured === true, authenticated: data.authenticated === true, user: data.user ?? null, ...(typeof data.error === "string" ? { error: data.error } : {}) });
    return data as CloudSession;
  }

  async function cloudAuth(action: "login" | "signup" | "resend" | "logout") {
    if (cloudBusy) return;
    setCloudBusy(true);
    setCloudMessage("");
    try {
      const endpoint = action === "logout" ? "/api/auth/logout" : action === "resend" ? "/api/auth/resend" : "/api/auth/" + action;
      const payload = action === "logout" ? {} : action === "resend" ? { email: cloudEmail } : { email: cloudEmail, password: cloudPassword };
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) throw new Error(typeof data.error === "string" ? data.error : "The account request did not complete.");
      if (action === "logout") {
        setCloudPassword("");
        setCloudSession({ configured: true, authenticated: false, user: null });
        setCloudMessage("Signed out. Cloud data remains saved in your account.");
      } else if (action === "signup" && data.needsEmailConfirmation) {
        setCloudMessage(typeof data.message === "string" ? data.message : "Check your email for a confirmation link, then sign in.");
      } else if (action === "resend") {
        setCloudMessage(typeof data.message === "string" ? data.message : "If the account needs confirmation, a new email was requested. Delivery is not guaranteed.");
      } else {
        await refreshCloudSession();
        setCloudPassword("");
        setCloudMessage(action === "signup" ? "Account created and signed in." : "Signed in. Use Restore cloud data or Save to cloud to sync this workspace.");
      }
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Cloud account request failed.");
    } finally { setCloudBusy(false); }
  }

  async function syncCloud(mode: "save" | "restore") {
    if (cloudBusy) return;
    setCloudBusy(true);
    setCloudMessage("");
    try {
      const get = await fetch("/api/workspace", { cache: "no-store", credentials: "same-origin" });
      const current = await get.json().catch(() => ({}));
      if (!get.ok) throw new Error(typeof current.error === "string" ? current.error : "Sign in to use cloud sync.");
      if (mode === "restore") {
        if (!current.workspace?.copyCenter) throw new Error("There are no saved Copy Center preferences in the cloud account yet.");
        const saved = current.workspace.copyCenter as { budget?: unknown; maxLoss?: unknown; activity?: unknown[] };
        if (typeof saved.budget !== "string" || typeof saved.maxLoss !== "string" || !Array.isArray(saved.activity)) throw new Error("The saved Copy Center settings are invalid; local data was not changed.");
        setBudget(saved.budget);
        setMaxLoss(saved.maxLoss);
        setActivity(saved.activity.filter((item): item is Activity => Boolean(item && typeof item === "object" && typeof (item as Activity).id === "string" && typeof (item as Activity).at === "string" && typeof (item as Activity).title === "string" && typeof (item as Activity).detail === "string")).slice(0, 50));
        setCloudUpdatedAt(typeof current.updatedAt === "string" ? current.updatedAt : null);
        setCloudMessage("Cloud preferences restored. Wallet sessions must be re-verified in this browser.");
      } else {
        const base = current.workspace && typeof current.workspace === "object"
          ? current.workspace
          : { traders: [], savedReviews: [], portfolioSnapshots: [] };
        const response = await fetch("/api/workspace", {
          method: "PUT", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspace: { ...base, copyCenter: { budget, maxLoss, activity: activity.slice(0, 50) } } })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.error) throw new Error(typeof result.error === "string" ? result.error : "Cloud save failed.");
        setCloudUpdatedAt(typeof result.updatedAt === "string" ? result.updatedAt : new Date().toISOString());
        setCloudMessage("Workspace saved to your authenticated cloud account. Exchange credentials and wallet secrets are not uploaded.");
      }
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Cloud sync failed.");
    } finally { setCloudBusy(false); }
  }

  async function verifyBitget() {
    setBgBusy(true);
    setBgMessage("");
    try {
      if (!cloudSession.authenticated) throw new Error("Sign in first to verify an exchange connection.");
      const response = await fetch("/api/connections/bitget/verify", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: bgKey, secret: bgSecret, passphrase: bgPhrase }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok !== true) throw new Error(typeof data.error === "string" ? data.error : "Bitget verification failed.");
      setProviders((old) => old.map((p) => p.id === "bitget" ? { ...p, state: "verified-once", note: "Read-only API verified once at " + new Date().toLocaleString() + ". Credentials were not saved; no recurring sync is active." } : p));
      log("Bitget verified", "Read-only account-assets endpoint succeeded. No order or transfer endpoint was called.");
      setBgMessage("Read-only verification succeeded. Credentials were not saved; re-enter them for the next check.");
    } catch (error) {
      setBgMessage(error instanceof Error ? error.message : "Verification failed.");
    } finally {
      setBgKey("");
      setBgSecret("");
      setBgPhrase("");
      setBgBusy(false);
    }
  }

  async function connectWallet(provider: Provider) {
    const w = window as Window & { ethereum?: EthereumProvider; phantom?: { solana?: PhantomProvider } };
    setToast("");
    try {
      let address = "";
      if (provider.id === "phantom") {
        const phantom = w.phantom?.solana;
        if (!phantom) {
          setToast("Phantom was not detected. Install it from phantom.app, then return and retry.");
          return;
        }
        const result = await phantom.connect();
        address = result.publicKey?.toString() || phantom.publicKey?.toString() || "";
      } else if (provider.id === "metamask") {
        if (!w.ethereum) {
          setToast("No EVM wallet was detected. Install MetaMask, then return and retry.");
          return;
        }
        const accounts = await w.ethereum.request({ method: "eth_requestAccounts" }) as string[];
        address = Array.isArray(accounts) ? accounts[0] || "" : "";
      } else if (provider.id === "base") {
        if (!w.ethereum) {
          setToast("No EVM wallet was detected. Install MetaMask, then return and retry.");
          return;
        }
        const accounts = await w.ethereum.request({ method: "eth_requestAccounts" }) as string[];
        address = Array.isArray(accounts) ? accounts[0] || "" : "";
        if (!address) throw new Error("The wallet did not return an account.");
        try {
          await w.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
        } catch (switchError) {
          if ((switchError as { code?: number })?.code !== 4902) throw switchError;
          await w.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0x2105", chainName: "Base", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.base.org"], blockExplorerUrls: ["https://basescan.org"] }] });
        }
        const chainId = await w.ethereum.request({ method: "eth_chainId" });
        if (chainId !== "0x2105") throw new Error("Base mainnet was not selected in the wallet.");
      } else {
        setToast(provider.name + " does not have a verified connection adapter yet. No credentials were sent.");
        return;
      }
      if (!address) throw new Error("The wallet did not return a public address.");
      const nextWallets = { ...walletAddresses, [provider.id]: address };
      setWalletAddresses(nextWallets);
      setProviders((old) => old.map((p) => p.id === provider.id ? { ...p, state: "connected", note: "Wallet session verified: " + address.slice(0, 7) + "…" + address.slice(-5) } : p));
      log("Wallet connected", provider.name + " public address verified: " + address.slice(0, 7) + "…" + address.slice(-5) + ". No signature or transaction was requested.");
      setSelected(null);
      setToast(provider.name + " wallet session verified. No transaction was submitted.");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Wallet connection failed. No transaction was submitted.");
    }
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
        <div className="cc-top-right"><span className="cc-pill cc-pill-muted">DEVELOPMENT WORKSPACE</span><a className="cc-advanced-link" href="/copy-trading">Open copy-trading engine ↗</a><a className="cc-advanced-link" href="/advanced-btcc">Advanced BTCC tools ↗</a></div>
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

      {view === "providers" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">CONNECTORS</p><h2>Your accounts and services</h2><p className="cc-lead">Each service has a separate status. A setup guide is not the same as a live connection.</p></div><span className="cc-pill cc-pill-muted">{connectedCount} verified</span></section><div className="cc-provider-grid">{providers.map((provider) => <article className="cc-provider-card" key={provider.id}><div className="cc-provider-top"><span className={"cc-provider-icon cc-icon-" + provider.kind}>{provider.name.slice(0, 1)}</span><span className={"cc-pill " + (provider.state !== "not-connected" ? "cc-pill-safe" : "cc-pill-off")}>{provider.state === "connected" ? "Verified session" : provider.state === "verified-once" ? "Verified once" : "Not connected"}</span></div><p className="cc-provider-kind">{provider.kind}</p><h3>{provider.name}</h3><p className="cc-provider-description">{provider.description}</p><button className="cc-card-button" onClick={() => requestConnection(provider)}>View setup <span>→</span></button></article>)}</div><p className="cc-footnote">Connection state is intentionally not toggled by a button. It will only change after a real connector and authorization check are implemented.</p></div>}

      {view === "portfolio" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">PORTFOLIO OVERVIEW</p><h2>One view, separate allocations</h2><p className="cc-lead">A monitoring layout for future verified balances and positions.</p></div><span className="cc-pill cc-pill-muted">No exchange data loaded</span></section><div className="cc-portfolio-empty"><div className="cc-empty-icon">▤</div><h3>Your portfolio will appear here</h3><p>No live account balances or positions have been imported. Connect a supported provider after its integration passes validation.</p><button className="cc-button" onClick={() => setView("providers")}>Review connections →</button></div><section className="cc-table-card"><div className="cc-table-title"><h3>Provider coverage</h3><span>Setup inventory</span></div><div className="cc-table-wrap"><table><thead><tr><th>Provider</th><th>Type</th><th>Connection</th><th>Next step</th></tr></thead><tbody>{providers.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.kind}</td><td><span className="cc-table-status">{p.state === "connected" ? "Verified session" : p.state === "verified-once" ? "Verified once" : "Not connected"}</span></td><td><button className="cc-text-button" onClick={() => requestConnection(p)}>Review</button></td></tr>)}</tbody></table></div></section></div>}

      {view === "risk" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">RISK FIRST</p><h2>Plan limits before providers</h2><p className="cc-lead">These are planning controls only. They do not place orders or configure exchange-side risk.</p></div><span className="cc-pill cc-pill-safe">Planning only</span></section><div className="cc-risk-layout"><section className="cc-settings-card"><h3>Allocation plan</h3><p>Choose a small amount to plan for each independent provider.</p><label className="cc-field">Planned amount per provider <span>USD</span><input type="number" min="0" max="100000" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} /></label><label className="cc-field">Maximum planned loss <span>%</span><input type="number" min="0" max="100" step="0.5" value={maxLoss} onChange={(e) => setMaxLoss(e.target.value)} /></label><div className="cc-form-note">Changes save to this browser automatically. They are not sent to any exchange.</div></section><section className="cc-risk-summary"><p className="cc-eyebrow">ILLUSTRATIVE LIMIT</p><span>Potential loss allowance per provider</span><strong>{money(perProviderRisk)}</strong><div className="cc-risk-bar"><span style={{ width: Math.min(100, lossValue) + "%" }} /></div><p>Based on {money(budgetValue)} planned allocation and a {lossValue}% loss threshold. Fees, slippage, leverage, liquidity, and market gaps can cause losses beyond this estimate.</p><div className="cc-risk-check"><span>✓</span> Separate provider allocations</div><div className="cc-risk-check"><span>✓</span> No automatic order execution in this workspace</div></section></div><section className="cc-notice"><span className="cc-notice-icon">!</span><div><strong>Risk warning</strong><p>Copy trading can lose the entire allocated amount. Small allocations do not remove market, custody, platform, or counterparty risk.</p></div></section></div>}

      {view === "activity" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">WORKSPACE HISTORY</p><h2>Recent activity</h2><p className="cc-lead">Records created by this interface on this browser.</p></div><span className="cc-pill cc-pill-muted">{activity.length} records</span></section>{activity.length ? <div className="cc-activity-list">{activity.map((item) => <article key={item.id}><span className="cc-activity-dot" /><div><strong>{item.title}</strong><p>{item.detail}</p><time>{new Date(item.at).toLocaleString()}</time></div></article>)}</div> : <div className="cc-portfolio-empty"><div className="cc-empty-icon">≡</div><h3>No activity recorded yet</h3><p>Reviewing a provider setup guide will add an entry here. Trades are not initiated from this activity page.</p><button className="cc-button" onClick={() => setView("providers")}>Review a provider</button></div>}</div>}

      {view === "settings" && <div className="cc-page"><section className="cc-section-head"><div><p className="cc-eyebrow">WORKSPACE SETTINGS</p><h2>Clear status, safer defaults</h2><p className="cc-lead">Manage your sign-in and sync only the planning data you choose.</p></div></section>
        <section className="cc-settings-card cc-cloud-card">
          <span className="cc-setting-icon">☁</span><h3>Authenticated cloud sync</h3>
          <p>{cloudSession.authenticated ? "Signed in as " + (cloudSession.user?.email || "your account") + "." : cloudSession.configured ? "Sign in or create an account to save planning preferences across devices." : "Cloud account service is not configured. Local planning still works."}</p>
          {!cloudSession.authenticated && <form className="cc-cloud-form" onSubmit={(e) => { e.preventDefault(); void cloudAuth(authMode === "signup" ? "signup" : "login"); }}>
            <label className="cc-field">Email<input type="email" autoComplete="email" value={cloudEmail} onChange={(e) => setCloudEmail(e.target.value)} required maxLength={254} /></label>
            <label className="cc-field">Password<input type="password" autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={cloudPassword} onChange={(e) => setCloudPassword(e.target.value)} required minLength={authMode === "signup" ? 12 : 1} maxLength={256} /></label>
            {authMode === "signup" && <p className="cc-form-note">Use at least 12 characters. If email confirmation is enabled, sign-in will wait until you confirm.</p>}
            <div className="cc-modal-actions"><button className="cc-button" disabled={cloudBusy || !cloudSession.configured}>{cloudBusy ? "Working…" : authMode === "signup" ? "Create account" : "Sign in"}</button><button type="button" className="cc-button cc-button-secondary" disabled={cloudBusy} onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}>{authMode === "signup" ? "I have an account" : "Create account"}</button></div>
            <button type="button" className="cc-text-button" disabled={cloudBusy || !cloudEmail} onClick={() => void cloudAuth("resend")}>Resend confirmation email</button>
          </form>}
          {cloudSession.authenticated && <div className="cc-cloud-actions"><button className="cc-button" disabled={cloudBusy} onClick={() => void syncCloud("save")}>{cloudBusy ? "Working…" : "Save to cloud"}</button><button className="cc-button cc-button-secondary" disabled={cloudBusy} onClick={() => void syncCloud("restore")}>Restore cloud data</button><button className="cc-text-button" disabled={cloudBusy} onClick={() => void cloudAuth("logout")}>Sign out</button></div>}
          {cloudUpdatedAt && <p className="cc-form-note">Last cloud sync: {new Date(cloudUpdatedAt).toLocaleString()}</p>}
          {cloudMessage && <p className="cc-form-note" role="status">{cloudMessage}</p>}
          <span className={"cc-pill " + (cloudSession.authenticated ? "cc-pill-safe" : "cc-pill-off")}>{cloudSession.authenticated ? "Authenticated" : cloudSession.configured ? "Signed out" : "Setup required"}</span>
          <p className="cc-form-note">Only planning preferences and activity are synced by this panel. API secrets, seed phrases, private keys, and wallet sessions are never uploaded.</p>
        </section>
        <div className="cc-settings-grid"><article className="cc-settings-card"><span className="cc-setting-icon">◉</span><h3>Data storage</h3><p>Planning settings and local activity are saved in this browser only.</p><span className="cc-pill cc-pill-off">Cloud sync not verified</span></article><article className="cc-settings-card"><span className="cc-setting-icon">⛨</span><h3>Execution permissions</h3><p>This friendly workspace does not enable live order execution or withdrawal actions.</p><span className="cc-pill cc-pill-safe">Not enabled here</span></article><article className="cc-settings-card"><span className="cc-setting-icon">◫</span><h3>Full copy-trading engine</h3><p>Open the existing engine for trader profiles, allocation proposals, risk reports, and review workflows.</p><a className="cc-card-button" href="/copy-trading">Open copy-trading engine →</a></article><article className="cc-settings-card"><span className="cc-setting-icon">↗</span><h3>Advanced BTCC tools</h3><p>The existing BTCC execution interface is kept separate for focused validation.</p><a className="cc-card-button" href="/advanced-btcc">Open advanced tools →</a></article><article className="cc-settings-card"><span className="cc-setting-icon">↻</span><h3>Reset local workspace</h3><p>Restore the default connection inventory and clear this browser's workspace history.</p><button className="cc-card-button" onClick={() => { if (window.confirm("Reset this browser's GEM Copy Center planning data? This cannot be undone.")) { setProviders(starterProviders); setActivity([]); setBudget("10"); setMaxLoss("2"); setToast("Local planning workspace reset."); } }}>Reset local data</button></article></div></div>}
    </main>

    {selected && <div className="cc-modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}><section className="cc-modal" role="dialog" aria-modal="true" aria-labelledby="cc-modal-title"><button className="cc-modal-close" onClick={() => setSelected(null)} aria-label="Close setup">×</button><p className="cc-eyebrow">CONNECTION SETUP</p><span className={"cc-provider-icon cc-icon-" + selected.kind}>{selected.name.slice(0, 1)}</span><h2 id="cc-modal-title">Set up {selected.name}</h2><span className={"cc-pill " + (selected.state !== "not-connected" ? "cc-pill-safe" : "cc-pill-off")}>{selected.state === "connected" ? "Verified session" : selected.state === "verified-once" ? "Verified once" : "Not connected"}</span><p>{selected.note}</p>
      {selected.id === "bitget" && <form className="cc-credential-form" onSubmit={(e) => { e.preventDefault(); void verifyBitget(); }}>
        <p className="cc-form-note">Read-only account-assets check only. Use an API key with read permission and no trading or withdrawal permissions. The key and secret are sent to the GEM server for this verification request and are not saved.</p>
        <label className="cc-field">API key<input type="password" autoComplete="off" value={bgKey} onChange={(e) => setBgKey(e.target.value)} maxLength={256} required /></label>
        <label className="cc-field">API secret<input type="password" autoComplete="new-password" value={bgSecret} onChange={(e) => setBgSecret(e.target.value)} maxLength={256} required /></label>
        <label className="cc-field">API passphrase<input type="password" autoComplete="off" value={bgPhrase} onChange={(e) => setBgPhrase(e.target.value)} maxLength={256} required /></label>
        <button className="cc-button" disabled={bgBusy || !cloudSession.authenticated}>{bgBusy ? "Verifying…" : "Verify read-only access"}</button>
        {bgMessage && <p className="cc-form-note" role="status">{bgMessage}</p>}
      </form>}
      {selected.id === "btcc" && <div className="cc-notice"><span className="cc-notice-icon">i</span><div><strong>BTCC native connection</strong><p>GEM does not currently have a verified BTCC read-only API adapter. Do not enter BTCC API credentials here. Review API availability in your account, and manage copy activation directly in BTCC's own Copy Trading screen.</p><a href="https://www.btcc.com/en-US/user-center/setting/api" target="_blank" rel="noreferrer">Open official BTCC API settings ↗</a></div></div>}
      {(selected.id === "phantom" || selected.id === "metamask" || selected.id === "base") && <p className="cc-form-note">This only asks the wallet for account access and public address. GEM does not request a message signature, token approval, transaction, or withdrawal.</p>}<ol><li>Open the official service and confirm you can sign in.</li><li>Start with read-only permissions wherever supported.</li><li>Never share passwords, seed phrases, private keys, or API secrets in chat.</li><li>Verify the integration and its status before relying on displayed balances.</li></ol><div className="cc-modal-actions"><button className="cc-button cc-button-secondary" onClick={() => setSelected(null)}>Close</button>{(selected.id === "phantom" || selected.id === "metamask" || selected.id === "base") ? <button className="cc-button" onClick={() => void connectWallet(selected)}>Connect wallet</button> : <button className="cc-button" onClick={() => confirmNotConnected(selected)}>Record review</button>}</div></section></div>}
  </div>;
}
