"use client";

import { useEffect, useMemo, useState } from "react";

type Status = {
  ready: boolean;
  liveExecutionEnabled: boolean;
  adapterMode: string;
  blockers: string[];
  policy: {
    maxExecutions: number;
    maxTotalFiat: number | null;
    destination: string;
    destinationFingerprint: string | null;
    recurring: false;
    otpStorage: false;
  };
};

type PreparedPlan = {
  planId: string;
  asset: "BTC";
  amountPerExecution: number;
  executionCount: number;
  totalAuthorized: number;
  quoteCurrency: "USD" | "EUR";
  payinGroup: "card" | "balance";
  destinationFingerprint: string;
  confirmationPhrase: string;
  confirmationToken: string;
  expiresAt: string;
  children: Array<{ sequence: number; partnerOrderId: string; amount: number }>;
};

type Execution = {
  status: "created" | "partial";
  orders: Array<{ sequence: number; partnerOrderId: string; clientOrderId?: string; status: string; redirect?: string; reused: boolean }>;
};

function money(value: number, currency: string) {
  return `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
}

export function FinitePurchaseConsole() {
  const [status, setStatus] = useState<Status | null>(null);
  const [amount, setAmount] = useState("300");
  const [count, setCount] = useState("2");
  const [currency, setCurrency] = useState<"USD" | "EUR">("USD");
  const [payinGroup, setPayinGroup] = useState<"card" | "balance">("card");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("US");
  const [acknowledged, setAcknowledged] = useState(false);
  const [controlSecret, setControlSecret] = useState("");
  const [prepared, setPrepared] = useState<PreparedPlan | null>(null);
  const [phrase, setPhrase] = useState("");
  const [execution, setExecution] = useState<Execution | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/purchase/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setStatus(data as Status))
      .catch(() => setMessage("Could not read finite-purchase connector status."));
  }, []);

  const numericAmount = Number(amount) || 0;
  const numericCount = Math.max(0, Math.trunc(Number(count) || 0));
  const total = useMemo(() => Math.round((numericAmount * numericCount + Number.EPSILON) * 100) / 100, [numericAmount, numericCount]);

  function resetPrepared() {
    setPrepared(null);
    setPhrase("");
    setExecution(null);
    setMessage("");
  }

  async function prepare() {
    setBusy(true);
    setMessage("");
    setExecution(null);
    const response = await fetch("/api/v1/purchase/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        amountPerExecution: numericAmount,
        executionCount: numericCount,
        quoteCurrency: currency,
        payinGroup,
        clientEmail: email.trim() || undefined,
        remoteCountry: country.trim().toUpperCase(),
        ownerAcknowledgedTotal: acknowledged
      })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Purchase preparation failed.");
      return;
    }
    setPrepared(data as PreparedPlan);
  }

  async function execute() {
    if (!prepared) return;
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/v1/purchase/execute", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-purchase-control-secret": controlSecret
      },
      body: JSON.stringify({ confirmationToken: prepared.confirmationToken, confirmationPhrase: phrase })
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setMessage(data.error || "Purchase execution failed.");
      return;
    }
    setExecution(data as Execution);
  }

  return <div className="page-grid review-grid">
    <section className="hero-card span-2">
      <div>
        <p className="eyebrow">Finite Bitcoin purchase controller</p>
        <div className="title-line"><h2>One plan, exact purchase count, then stop</h2><span className={`badge badge-${status?.ready ? "live-ready" : "setup-required"}`}>{status?.ready ? "LIVE READY" : "SETUP REQUIRED"}</span></div>
        <p className="subtle">Choose any supported amount per purchase and a finite execution count. The controller creates exactly that many uniquely identified BTC purchase orders and never schedules another one.</p>
      </div>
      <div className={`score ${status?.ready ? "score-low" : "score-critical"}`}><span>Total now</span><strong>{money(total, currency)}</strong><small>{numericCount || 0} × {money(numericAmount, currency)}</small></div>
    </section>

    <section className="panel span-2">
      <div className="panel-head"><div><p className="eyebrow">Purchase definition</p><h2>Define the finite batch</h2></div><a className="button" href="/">Back to manager</a></div>
      <div className="critical-callout">The full total is disclosed before authorization. This service never stores, replays, or reuses an owner OTP/2FA code. Switchere or the card issuer may still require its own authentication for each card-funded child order.</div>
      <div className="form-grid live-form">
        <label className="field"><span>Amount per BTC purchase</span><div className="input-wrap"><input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => { setAmount(event.target.value); resetPrepared(); }}/><em>{currency}</em></div></label>
        <label className="field"><span>Number of purchases</span><div className="input-wrap"><input type="number" min="1" max={status?.policy.maxExecutions || 10} step="1" value={count} onChange={(event) => { setCount(event.target.value); resetPrepared(); }}/><em>finite</em></div></label>
        <label className="field"><span>Fiat currency</span><select value={currency} onChange={(event) => { setCurrency(event.target.value as "USD" | "EUR"); resetPrepared(); }}><option value="USD">USD</option><option value="EUR">EUR</option></select></label>
        <label className="field"><span>Switchere funding route</span><select value={payinGroup} onChange={(event) => { setPayinGroup(event.target.value as "card" | "balance"); resetPrepared(); }}><option value="card">Card</option><option value="balance">Switchere balance</option></select></label>
        <label className="field"><span>Owner email (optional)</span><div className="input-wrap"><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); resetPrepared(); }}/></div></label>
        <label className="field"><span>Country code</span><div className="input-wrap"><input maxLength={2} value={country} onChange={(event) => { setCountry(event.target.value.toUpperCase()); resetPrepared(); }}/><em>2 letters</em></div></label>
      </div>
      <div className="metric-grid confirm-grid">
        <div className="metric"><span>Per purchase</span><strong>{money(numericAmount, currency)}</strong></div>
        <div className="metric"><span>Execution count</span><strong>{numericCount || 0}</strong></div>
        <div className="metric"><span>Maximum authorized total</span><strong>{money(total, currency)}</strong></div>
        <div className="metric"><span>Destination</span><strong>{status?.policy.destinationFingerprint || "Not configured"}</strong></div>
      </div>
      <label className="field"><span>Owner authorization disclosure</span><span className="subtle"><input type="checkbox" checked={acknowledged} onChange={(event) => { setAcknowledged(event.target.checked); resetPrepared(); }}/> I confirm the owner is being shown that this plan authorizes {numericCount || 0} separate BTC purchases for a maximum total of {money(total, currency)}.</span></label>
      <div className="form-actions"><button className="button" disabled={busy || !acknowledged || numericAmount <= 0 || numericCount < 1} onClick={() => void prepare()}>{busy ? "Preparing…" : "Prepare finite purchase"}</button></div>
      {message && <div className="notice inline"><span>{message}</span></div>}
    </section>

    <section className="panel span-2">
      <p className="eyebrow">Exact authorization</p>
      {prepared ? <>
        <h2>Authorize {prepared.executionCount} × {money(prepared.amountPerExecution, prepared.quoteCurrency)}</h2>
        <p className="subtle">Total authorized: <strong>{money(prepared.totalAuthorized, prepared.quoteCurrency)}</strong>. Destination: BTCC BTC deposit {prepared.destinationFingerprint}. The plan expires at {new Date(prepared.expiresAt).toLocaleTimeString()}.</p>
        <div className="position-list">{prepared.children.map((child) => <article key={child.partnerOrderId}><strong>Purchase #{child.sequence}</strong><span>{money(child.amount, prepared.quoteCurrency)}</span><span>{child.partnerOrderId}</span></article>)}</div>
        <label className="field"><span>Type exactly: {prepared.confirmationPhrase}</span><div className="input-wrap"><input value={phrase} onChange={(event) => setPhrase(event.target.value)}/></div></label>
        <label className="field"><span>Purchase control secret</span><div className="input-wrap"><input type="password" autoComplete="off" value={controlSecret} onChange={(event) => setControlSecret(event.target.value)}/></div></label>
        <button className="button danger-button execute-button" disabled={busy || !status?.ready || phrase !== prepared.confirmationPhrase || !controlSecret} onClick={() => void execute()}>{busy ? "Creating orders…" : `Create exactly ${prepared.executionCount} BTC purchase orders`}</button>
      </> : <p className="subtle">Prepare a plan above. The signed plan locks the amount, count, destination and total so none can change between review and execution.</p>}
    </section>

    {execution && <section className="panel span-2">
      <div className="panel-head"><div><p className="eyebrow">Provider orders</p><h2>{execution.status === "created" ? "Finite batch created" : "Partial batch — retry safely"}</h2></div><span className={`badge badge-${execution.status === "created" ? "pass" : "block"}`}>{execution.status.toUpperCase()}</span></div>
      <p className="subtle">Each child uses a deterministic partner order ID. Retrying the same signed plan reuses existing Switchere orders instead of intentionally adding a third purchase.</p>
      <div className="position-list">{execution.orders.map((order) => <article key={order.partnerOrderId}><strong>Purchase #{order.sequence}</strong><span>{order.status}{order.reused ? " · existing" : " · new"}</span><span>{order.clientOrderId || order.partnerOrderId}</span>{order.redirect && <a className="button" href={order.redirect} target="_blank" rel="noreferrer">Open Switchere payment</a>}</article>)}</div>
    </section>}

    <section className="panel span-2">
      <p className="eyebrow">Activation state</p><h2>{status?.ready ? "Switchere → BTCC purchase path is armed" : "Configuration still required"}</h2>
      {status?.blockers?.length ? <ul className="flag-list">{status.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="subtle">Live execution is enabled, Switchere partner credentials are present, a fixed BTCC BTC deposit address is configured, and the finite total limit is active.</p>}
      <p className="subtle">The controller is finite by construction: no cron, no recurring schedule, and no automatic execution beyond the signed child count.</p>
    </section>
  </div>;
}
