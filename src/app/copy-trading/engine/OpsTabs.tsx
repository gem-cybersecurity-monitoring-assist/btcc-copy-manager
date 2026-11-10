"use client";
// F · Monitoring & audit, G · Backtest lab, H · Wallets.
import { useMemo, useState } from "react";
import { DEFAULT_BACKTEST, runBacktest, valuePaperPortfolio, type BacktestConfig, type BacktestReport } from "../../../../lib/engine/backtest.ts";
import { runMonitoring } from "../../../../lib/engine/monitoring.ts";
import type { EngineState } from "../../../../lib/engine/types.ts";
import { LineChart, Notice, num, NumberField, pct, Pill, usd, when, type EngineChange } from "./ui.tsx";

// ---- F · Monitoring & audit -------------------------------------------------

export function MonitoringTab({ engine, onChange }: { engine: EngineState; onChange: EngineChange }) {
  const [filter, setFilter] = useState("");
  const names = new Map(engine.strategies.map((s) => [s.id, s.name]));
  const history = useMemo(() => {
    const by = new Map<string, number[]>();
    for (const s of engine.scoreHistory) by.set(s.strategyId, [...(by.get(s.strategyId) ?? []), s.score]);
    return [...by.entries()].filter(([id]) => names.has(id));
  }, [engine.scoreHistory, names]);
  const audit = [...engine.audit].reverse().filter((e) => !filter || `${e.action} ${e.detail}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 150);
  const resolved = engine.alerts.filter((a) => a.resolvedAt).slice(-20).reverse();
  const next = engine.monitor.lastRunAt ? new Date(Date.parse(engine.monitor.lastRunAt) + engine.monitor.intervalHours * 3_600_000) : null;

  return (
    <div className="engine-stack">
      <Notice tone="warn"><strong>Scheduler status:</strong> reviews run in your browser — automatically when you open the dashboard and the interval has passed, or with “Run review now”. No background server job is deployed: your data is protected by row-level security and the server holds no privileged key that could read it unattended. Provider data is not fetched automatically because no provider integration is implemented.</Notice>
      <div className="engine-kpis">
        <div><span>Last review</span><strong>{when(engine.monitor.lastRunAt)}</strong></div>
        <div><span>Next due</span><strong>{next ? (next.getTime() < Date.now() ? "now (on next open)" : when(next.toISOString())) : "on next open"}</strong></div>
        <div><span>Score snapshots</span><strong>{engine.scoreHistory.length}</strong></div>
        <div><span>Audit events</span><strong>{engine.audit.length}</strong></div>
      </div>
      <div className="engine-actions">
        <button type="button" className="primary-btn" onClick={() => onChange(runMonitoring(engine, new Date(), "manual").state)}>Run review now</button>
        <label className="inline">Review every<select value={engine.monitor.intervalHours} onChange={(e) => onChange({ ...engine, monitor: { ...engine.monitor, intervalHours: Number(e.target.value) } }, { action: "monitor_interval_changed", detail: `${e.target.value} hours` })}>{[6, 12, 24, 72, 168].map((h) => <option key={h} value={h}>{h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? "" : "s"}`}</option>)}</select></label>
      </div>
      {engine.monitor.lastRunSummary && <p className="form-message" role="status">{engine.monitor.lastRunSummary}</p>}
      <h3>Score history</h3>
      {history.length ? <div className="table-wrap"><table className="compact-table"><thead><tr><th>Strategy</th><th>Snapshots</th><th>First → latest</th><th>Trend</th></tr></thead>
        <tbody>{history.map(([id, scores]) => <tr key={id}><td>{names.get(id)}</td><td>{scores.length}</td><td>{scores[0]} → {scores.at(-1)}</td><td>{scores.slice(-20).join(" · ")}</td></tr>)}</tbody></table></div> : <p className="cell-sub">Run a review to start recording score history.</p>}
      {resolved.length > 0 && <><h3>Recently resolved alerts</h3><ul className="engine-steps">{resolved.map((a) => <li key={a.key + a.createdAt}>{a.message} <span className="cell-sub">raised {when(a.createdAt)}, resolved {when(a.resolvedAt)}</span></li>)}</ul></>}
      <h3>Audit trail</h3>
      <input aria-label="Filter audit trail" placeholder="Filter audit events…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="table-wrap"><table className="compact-table"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>{!audit.length && <tr><td colSpan={4} className="empty-cell">No events yet.</td></tr>}{audit.map((e) => <tr key={e.id}><td>{when(e.at)}</td><td>{e.actor}</td><td>{e.action.replace(/_/g, " ")}</td><td className="wrap">{e.detail}</td></tr>)}</tbody></table></div>
      <p className="footnote">The most recent {engine.audit.length} of up to 500 events are kept with your workspace (browser, backups, and cloud sync).</p>
    </div>
  );
}

// ---- G · Backtest lab ------------------------------------------------------

const TONES = { equal: "#635bff", risk_adjusted: "#198365", score_weighted: "#d99b32", cash: "#8a95a6" } as const;

export function LabTab({ engine, onChange }: { engine: EngineState; onChange: EngineChange }) {
  const [config, setConfig] = useState<BacktestConfig>({ ...DEFAULT_BACKTEST, startCapitalUsd: engine.planner.totalCapitalUsd || DEFAULT_BACKTEST.startCapitalUsd });
  const [report, setReport] = useState<BacktestReport | null>(null);
  const [error, setError] = useState("");
  const names = new Map(engine.strategies.map((s) => [s.id, s.name]));

  function run() {
    setError("");
    const r = runBacktest({ strategies: engine.strategies, accounts: engine.providers, customProviders: engine.customProviders, policy: engine.policy, planner: engine.planner, weights: engine.weights, config });
    if (!r.results.length) { setReport(null); setError(`Not enough history: need more than ${config.warmup} periods across your strategies' return histories.`); return; }
    setReport(r);
    const summary = r.results.map((x) => `${x.method} ${usd(x.finalValueUsd)} (max DD ${pct(x.metrics.maxDrawdownPct)})`).join("; ");
    onChange({ ...engine }, { action: "backtest_run", detail: `${r.universe.length} strategies, ${r.evaluationPeriods} out-of-sample periods: ${summary}.${r.limitations[0]?.startsWith("Includes SIMULATED") ? " SIMULATED data." : ""}` });
  }

  return (
    <div className="engine-stack">
      <Notice tone="warn">Backtests and paper portfolios are simulations. Simulated gains are not earnings and past results do not predict future returns.</Notice>
      <h3>Walk-forward backtest</h3>
      <div className="engine-form compact">
        <NumberField label="Start capital (USD)" value={config.startCapitalUsd} onChange={(v) => setConfig({ ...config, startCapitalUsd: v })} />
        <NumberField label="Warm-up (periods, never scored)" value={config.warmup} min={10} max={380} step="1" onChange={(v) => setConfig({ ...config, warmup: Math.round(v) })} />
        <NumberField label="Rebalance every (periods)" value={config.rebalanceEvery} min={1} max={180} step="1" onChange={(v) => setConfig({ ...config, rebalanceEvery: Math.round(v) })} />
        <NumberField label="Data delay (periods)" value={config.delayPeriods} min={0} max={30} step="1" onChange={(v) => setConfig({ ...config, delayPeriods: Math.round(v) })} />
        <NumberField label="Rebalance cost (% of traded)" value={config.rebalanceCostPct} max={10} onChange={(v) => setConfig({ ...config, rebalanceCostPct: v })} />
      </div>
      <p className="cell-sub">Uses your current risk policy, planner caps (per-provider limit, reserve), provider minimums, and scoring weights.</p>
      <div className="engine-actions"><button type="button" className="primary-btn" onClick={run} disabled={!engine.strategies.some((s) => s.series)}>Run backtest</button></div>
      {error && <p className="form-message error" role="alert">{error}</p>}
      {report && <article className="engine-card wide">
        {report.limitations[0]?.startsWith("Includes SIMULATED") && <Notice tone="bad"><strong>SIMULATED DATA.</strong> {report.limitations[0]}</Notice>}
        <LineChart label="Backtest equity curves" series={report.results.map((r) => ({ name: r.method.replace("_", " "), points: r.equity.map((e) => e.value), tone: TONES[r.method] }))} />
        <div className="table-wrap"><table className="compact-table"><thead><tr><th>Policy</th><th>Final value</th><th>Total</th><th>Max DD</th><th>Volatility</th><th>Sharpe</th><th>Avg holdings</th><th>Avg cash</th><th>Rebalances</th><th>Costs</th><th>Missing-data periods</th></tr></thead>
          <tbody>{report.results.map((r) => <tr key={r.method}><td>{r.method.replace("_", " ")}</td><td>{usd(r.finalValueUsd)}</td><td>{pct(r.metrics.totalReturnPct)}</td><td>{pct(r.metrics.maxDrawdownPct)}</td><td>{pct(r.metrics.volatilityPct)}</td><td>{num(r.metrics.sharpe)}</td><td>{r.avgHoldings}</td><td>{pct(r.avgCashPct)}</td><td>{r.rebalances}</td><td>{usd(r.costsUsd)}</td><td>{r.missingDataPeriods}</td></tr>)}</tbody></table></div>
        <p className="cell-sub">Out-of-sample: {report.results[0].startDate} → {report.results[0].endDate} ({report.evaluationPeriods} periods after a {report.trainingPeriods}-period warm-up). Universe: {report.universe.map((id) => names.get(id)).join(", ")}.{report.excluded.length ? ` Excluded: ${report.excluded.map((e) => `${names.get(e.strategyId)} (${e.reason})`).join(", ")}.` : ""}</p>
        <strong>Assumptions</strong><ul className="engine-steps">{report.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        <strong>Limitations</strong><ul className="engine-steps">{report.limitations.map((a) => <li key={a}>{a}</li>)}</ul>
      </article>}

      <h3>Paper portfolios</h3>
      {!engine.paperPortfolios.length && <p className="cell-sub">Create one from a proposal in Capital allocation.</p>}
      {engine.paperPortfolios.map((pp) => {
        const v = valuePaperPortfolio(pp, engine.strategies);
        const sim = v.lines.some((l) => l.simulatedSource);
        return <article key={pp.id} className="engine-card wide">
          <div className="engine-card-head"><div><h3>{pp.name}</h3><span className="cell-sub">Paper only · {pp.method.replace("_", " ")} · starts after {pp.startDate} · created {when(pp.createdAt)}</span></div><Pill tone={sim ? "sim" : "neutral"}>{sim ? "SIMULATED" : "PAPER"}</Pill></div>
          <p>Start {usd(v.startUsd)} → simulated value {usd(v.valueUsd)} ({pct(v.changePct, 2)}){v.asOf ? ` as of ${v.asOf}` : " — no history recorded after the start date yet"}.</p>
          <div className="table-wrap"><table className="compact-table"><thead><tr><th>Strategy</th><th>Start</th><th>Value</th><th>Periods</th></tr></thead><tbody>{v.lines.map((l) => <tr key={l.strategyId}><td>{l.name}</td><td>{usd(l.startUsd)}</td><td>{usd(l.valueUsd)}</td><td>{l.periods}</td></tr>)}</tbody></table></div>
          <button type="button" className="danger-btn" onClick={() => window.confirm(`Delete paper portfolio "${pp.name}"?`) && onChange({ ...engine, paperPortfolios: engine.paperPortfolios.filter((x) => x.id !== pp.id) }, { action: "paper_deleted", detail: pp.name })}>Delete</button>
        </article>;
      })}
    </div>
  );
}

// ---- H · Wallets ---------------------------------------------------------------

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown>; isMetaMask?: boolean };
type PhantomSolana = { isPhantom?: boolean; connect: () => Promise<{ publicKey: { toString(): string } }>; disconnect: () => Promise<void> };
type WalletWindow = Window & { ethereum?: Eip1193; phantom?: { solana?: PhantomSolana }; solana?: PhantomSolana };

const CHAINS: Record<string, string> = { "0x1": "Ethereum mainnet", "0x89": "Polygon", "0xa": "Optimism", "0xa4b1": "Arbitrum One", "0x2105": "Base", "0x38": "BNB Smart Chain", "0xaa36a7": "Sepolia testnet" };

function formatWei(hex: string) {
  const wei = BigInt(hex);
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function WalletsTab() {
  const [evm, setEvm] = useState<{ address: string; chain: string; balance: string | null; isMetaMask: boolean } | null>(null);
  const [sol, setSol] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const w = typeof window !== "undefined" ? (window as WalletWindow) : null;
  const phantom = w?.phantom?.solana ?? (w?.solana?.isPhantom ? w.solana : undefined);

  async function connectEvm() {
    setMessage("");
    if (!w?.ethereum) { setMessage("No browser wallet detected. Install MetaMask from metamask.io, or open this page in the MetaMask app browser."); return; }
    try {
      const accounts = (await w.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("No account was shared.");
      const chainId = String(await w.ethereum.request({ method: "eth_chainId" }));
      let balance: string | null = null;
      try { balance = formatWei(String(await w.ethereum.request({ method: "eth_getBalance", params: [address, "latest"] }))); } catch { /* balance is optional */ }
      setEvm({ address, chain: CHAINS[chainId] ?? `chain ${chainId}`, balance, isMetaMask: Boolean(w.ethereum.isMetaMask) });
    } catch (e) {
      setMessage(e instanceof Error && /reject|denied/i.test(e.message) ? "Connection request was declined in the wallet." : "The wallet did not share an account.");
    }
  }
  async function disconnectEvm() {
    try { await w?.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); } catch { /* not all wallets support revocation */ }
    setEvm(null);
    setMessage("Disconnected in GEM. If the wallet still lists this site as connected, remove it in the wallet's connected-sites settings.");
  }
  async function connectSol() {
    setMessage("");
    if (!phantom) { setMessage("Phantom not detected. Install it from phantom.app, or open this page in the Phantom app browser."); return; }
    try { const r = await phantom.connect(); setSol(r.publicKey.toString()); }
    catch { setMessage("Connection request was declined in Phantom."); }
  }
  async function disconnectSol() {
    try { await phantom?.disconnect(); } catch { /* ignore */ }
    setSol(null);
  }

  return (
    <div className="engine-stack">
      <Notice tone="info">Optional and separate from exchange accounts. GEM only reads a public address (and, for EVM wallets, the native-coin balance through the wallet). It never asks for a seed phrase, private key, or password, and never requests signatures, approvals, swaps, or transfers. Connections are kept for this page session only and are not saved.</Notice>
      <div className="engine-summary-grid">
        <article className="engine-card">
          <div className="engine-card-head"><h3>MetaMask / EVM wallet</h3>{evm ? <Pill tone="good">Connected</Pill> : <Pill>Not connected</Pill>}</div>
          {evm ? <>
            <dl className="engine-dl"><div><dt>Address</dt><dd className="mono">{evm.address.slice(0, 6)}…{evm.address.slice(-4)}</dd></div><div><dt>Network</dt><dd>{evm.chain}</dd></div><div><dt>Native balance</dt><dd>{evm.balance ?? "unavailable"}</dd></div><div><dt>Provider</dt><dd>{evm.isMetaMask ? "MetaMask" : "Other injected wallet"}</dd></div></dl>
            <p className="cell-sub">Token balances and positions held on exchanges are not shown. This is not an exchange copy-trading account.</p>
            <button type="button" className="secondary-btn" onClick={() => void disconnectEvm()}>Disconnect</button>
          </> : <button type="button" className="primary-btn" onClick={() => void connectEvm()}>Connect MetaMask</button>}
        </article>
        <article className="engine-card">
          <div className="engine-card-head"><h3>Phantom (Solana)</h3>{sol ? <Pill tone="good">Connected</Pill> : <Pill>Not connected</Pill>}</div>
          {sol ? <>
            <dl className="engine-dl"><div><dt>Address</dt><dd className="mono">{sol.slice(0, 4)}…{sol.slice(-4)}</dd></div><div><dt>Balance</dt><dd>not available</dd></div></dl>
            <p className="cell-sub">Reading a Solana balance needs a Solana RPC endpoint, which is not configured for this app.</p>
            <button type="button" className="secondary-btn" onClick={() => void disconnectSol()}>Disconnect</button>
          </> : <button type="button" className="primary-btn" onClick={() => void connectSol()}>Connect Phantom</button>}
        </article>
      </div>
      {message && <p className="form-message" role="status">{message}</p>}
    </div>
  );
}

