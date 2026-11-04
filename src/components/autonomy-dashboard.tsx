"use client";

import { useCallback, useEffect, useState } from "react";

type Row = Record<string, unknown>;
type Scan = {
  status?: string;
  captured_at?: string;
  autonomy_plan?: {
    status?: string;
    account?: Record<string, number>;
    selected?: Row[];
    excluded?: Row[];
    execution_blockers?: string[];
  };
  ai_review?: {
    status?: string;
    enabled?: boolean;
    summary?: string;
    reviews?: Row[];
  };
  maintenance_plan?: {
    status?: string;
    stop_review?: Row[];
    retain?: Row[];
    replacement_candidates?: Row[];
    execution?: string;
  };
  error?: string;
};
type BitgetStatus = {
  configured?: boolean;
  live_enabled?: boolean;
  internal_transfer_enabled?: boolean;
  copy_fund_source?: string | null;
  allowlisted_project_count?: number;
  minimum_subscription_usdt?: number;
  required_account_mode?: string;
  supported?: string[];
  error?: string;
};

function amount(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT` : "—";
}
function text(value: unknown) {
  if (Array.isArray(value)) return value.map(String).join(" · ");
  return value === undefined || value === null || value === "" ? "—" : String(value);
}
function Rows({ rows, empty }: { rows: Row[]; empty: string }) {
  if (!rows.length) return <p className="subtle">{empty}</p>;
  return <div className="flag-list">{rows.map((row, index) => (
    <div className="autonomy-row" key={String(row.trader_id || row.project_id || row.trader || index)}>
      <strong>{text(row.trader || row.name || row.trader_id)}</strong>
      <span>{text(row.exchange || row.action)} {row.score !== undefined ? `· Score ${text(row.score)}` : ""}</span>
      <span>{row.allocation_usdt !== undefined ? amount(row.allocation_usdt) : text(row.decision)}</span>
      {Array.isArray(row.reasons) && <small>{text(row.reasons)}</small>}
    </div>
  ))}</div>;
}

export function AutonomyDashboard() {
  const [scan, setScan] = useState<Scan | null>(null);
  const [bitget, setBitget] = useState<BitgetStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [scanResponse, bitgetResponse] = await Promise.all([
        fetch("/api/v1/sentinel/autonomy", { cache: "no-store" }),
        fetch("/api/v1/sentinel/bitget-status", { cache: "no-store" }),
      ]);
      const [scanBody, bitgetBody] = await Promise.all([scanResponse.json(), bitgetResponse.json()]);
      if (!scanResponse.ok) throw new Error(scanBody.error || "Sentinel is not connected.");
      setScan(scanBody as Scan);
      setBitget(bitgetBody as BitgetStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the autonomous copy manager.");
      setScan(null);
      setBitget(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const plan = scan?.autonomy_plan;
  const maintenance = scan?.maintenance_plan;
  const account = plan?.account || {};

  return <div className="page-grid">
    <section className="hero-card span-2">
      <div>
        <p className="eyebrow">GEM Autonomous Copy Manager</p>
        <div className="title-line"><h2>AI trader oversight and capital plan</h2><span className="badge badge-blocked">PLAN ONLY</span></div>
        <p className="subtle">Evaluates verified trader observations, applies hard capital limits, and identifies deteriorating followers. Exchange actions remain disabled until the exchange adapter and account are fully configured.</p>
      </div>
      <button className="button" disabled={loading} onClick={() => void refresh()}>{loading ? "Reviewing…" : "Run review"}</button>
    </section>

    {error && <section className="panel span-2"><p className="eyebrow">Sentinel connection</p><h2>Autonomy service unavailable</h2><p className="subtle">{error}</p><p className="subtle">The web dashboard needs SENTINEL_URL and SENTINEL_CONTROL_TOKEN configured to reach a persistent Sentinel service.</p></section>}

    <section className="metric-grid span-2">
      <div className="metric"><span>Account equity</span><strong>{amount(account.equity_usdt)}</strong></div>
      <div className="metric"><span>Protected reserve</span><strong>{amount(account.reserve_usdt)}</strong></div>
      <div className="metric"><span>Copy exposure cap</span><strong>{amount(account.copy_exposure_cap_usdt)}</strong></div>
      <div className="metric"><span>Daily loss guard</span><strong>{amount(account.daily_loss_limit_usdt)}</strong></div>
    </section>

    <section className="panel">
      <p className="eyebrow">Bitget adapter</p>
      <h2>{bitget?.configured ? "Credentials configured" : "Awaiting secure credentials"}</h2>
      <p className="subtle">Live actions: {bitget?.live_enabled ? "Enabled by server policy" : "Disabled"}.</p>
      <p className="subtle">Internal copy-account funding transfer: {bitget?.internal_transfer_enabled ? `Enabled from ${text(bitget?.copy_fund_source)}` : "Disabled"}.</p>
      <p className="subtle">Allowed projects: {text(bitget?.allowlisted_project_count)} · Minimum copy amount: {amount(bitget?.minimum_subscription_usdt)}</p>
      <p className="subtle">Account mode: {text(bitget?.required_account_mode)}.</p>
      <p className="subtle">No withdrawals or address changes are available to the agent.</p>
    </section>

    <section className="panel">
      <p className="eyebrow">Decision cycle</p>
      <h2>{text(plan?.status || "Waiting for Sentinel")}</h2>
      <p className="subtle">Latest observation: {text(scan?.captured_at)}</p>
      <p className="subtle">Re-evaluation target: every 60 seconds while Sentinel is running.</p>
    </section>

    <section className="panel span-2">
      <p className="eyebrow">AI independent risk panel</p>
      <h2>{scan?.ai_review?.enabled ? "LLM review enabled" : "Deterministic-only review"}</h2>
      <p className="subtle">{text(scan?.ai_review?.summary || "The LLM reviewer is disabled. Hard deterministic limits remain active.")}</p>
      <Rows rows={scan?.ai_review?.reviews || []} empty="No separate AI review was run."/>
    </section>

    <section className="panel span-2">
      <p className="eyebrow">Selected traders</p>
      <h2>Qualified allocation candidates</h2>
      <Rows rows={plan?.selected || []} empty="No trader currently meets every eligibility, freshness, capital and minimum-margin gate."/>
    </section>

    <section className="panel span-2">
      <p className="eyebrow">Maintenance and replacement</p>
      <h2>Stop-and-replace review</h2>
      <Rows rows={maintenance?.stop_review || []} empty="No followed trader currently triggers the deterioration review."/>
      <p className="eyebrow">Replacement candidates</p>
      <Rows rows={maintenance?.replacement_candidates || []} empty="No verified replacement candidate is ready."/>
      <p className="eyebrow">Retain / pause</p>
      <Rows rows={maintenance?.retain || []} empty="No current follower state has been supplied."/>
    </section>

    <section className="panel span-2">
      <p className="eyebrow">Excluded candidates and blockers</p>
      <h2>Why a trader was not selected</h2>
      <Rows rows={plan?.excluded || []} empty="No excluded candidate records in the latest scan."/>
      {plan?.execution_blockers?.map((item) => <p className="subtle" key={item}>• {item}</p>)}
      {maintenance?.execution && <p className="subtle">{maintenance.execution}</p>}
    </section>
  </div>;
}
