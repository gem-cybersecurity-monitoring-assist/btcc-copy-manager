import type { Snapshot } from "./workspace.ts";

export type EquityChange = {
  venue: string;
  start: Snapshot;
  end: Snapshot;
  changeUsd: number;
  unadjustedChangePct: number;
  days: number;
  verifiedNetRoi: null;
  warning: string;
};

/**
 * Shows observed equity change only. An equity delta is not a trading return
 * without deposits/withdrawals, valuation, fees and provenance reconciliation.
 * Never call the unadjusted percentage "ROI" or extrapolate it daily.
 */
export function summarizeRecordedEquity(snapshots: Snapshot[]): EquityChange[] {
  const byVenue = new Map<string, Snapshot[]>();
  for (const row of snapshots) {
    if (!(row.equity > 0) || !Number.isFinite(row.equity)) continue;
    const at = Date.parse(row.capturedAt);
    if (!Number.isFinite(at)) continue;
    const key = row.venue.trim().toLowerCase();
    if (!key) continue;
    const list = byVenue.get(key) ?? [];
    list.push(row);
    byVenue.set(key, list);
  }
  const result: EquityChange[] = [];
  for (const rows of byVenue.values()) {
    rows.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    if (rows.length < 2) continue;
    const start = rows[0];
    const end = rows[rows.length - 1];
    const days = (Date.parse(end.capturedAt) - Date.parse(start.capturedAt)) / 86_400_000;
    if (days <= 0) continue;
    result.push({
      venue: end.venue,
      start,
      end,
      changeUsd: end.equity - start.equity,
      unadjustedChangePct: ((end.equity - start.equity) / start.equity) * 100,
      days,
      verifiedNetRoi: null,
      warning: "Equity changes may include deposits, withdrawals, fees and asset prices. Net trading ROI cannot be verified from these records.",
    });
  }
  return result.sort((a, b) => a.venue.localeCompare(b.venue));
}

export type AccountEquityEvent = {
  timestamp: string;
  equityUsd: number;
  /** Net external deposit minus external withdrawal since preceding observation. */
  externalFlowUsd: number;
};

/** Calculate true flow-adjusted period returns only with explicit flow data. */
export function calculateFlowAdjustedReturns(events: AccountEquityEvent[]) {
  if (events.length < 2) return null;
  const sorted = [...events].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  let growth = 1;
  let peak = 1;
  let maxDrawdownPct = 0;
  for (let i = 0; i < sorted.length; i++) {
    const point = sorted[i];
    if (!Number.isFinite(Date.parse(point.timestamp)) || !Number.isFinite(point.equityUsd) ||
        !Number.isFinite(point.externalFlowUsd) || point.equityUsd <= 0) return null;
    if (i === 0) continue;
    const previous = sorted[i - 1];
    if (Date.parse(point.timestamp) <= Date.parse(previous.timestamp)) return null;
    const periodReturn = (point.equityUsd - point.externalFlowUsd) / previous.equityUsd;
    if (!Number.isFinite(periodReturn) || periodReturn <= 0) return null;
    growth *= periodReturn;
    peak = Math.max(peak, growth);
    maxDrawdownPct = Math.max(maxDrawdownPct, (1 - growth / peak) * 100);
  }
  return { flowAdjustedReturnPct: (growth - 1) * 100, maxDrawdownPct };
}
