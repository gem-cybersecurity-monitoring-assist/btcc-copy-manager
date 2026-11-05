// Data-quality checks and series import. Flags stale, inconsistent, incomplete, or suspicious data
// instead of silently using it, and never fills in missing statistics.

import { computeMetrics, MIN_POINTS_FOR_RATIOS } from "./metrics.ts";
import type { DataSource, Observation, ReturnSeries, Strategy } from "./types.ts";

export type QualityFlag = { code: string; severity: "info" | "warning" | "critical"; message: string };

export const SOURCE_LABELS: Record<DataSource, string> = {
  official_api: "Official API (verified)",
  provider_profile: "Transcribed from provider profile",
  imported_csv: "Imported file",
  user_entered: "User-entered",
  simulated: "SIMULATED — not real performance",
};

/** Base confidence by source; observations cannot claim more than their source supports. */
export const SOURCE_CONFIDENCE_CAP: Record<DataSource, number> = {
  official_api: 1,
  provider_profile: 0.7,
  imported_csv: 0.6,
  user_entered: 0.5,
  simulated: 0.2,
};

export function dataConfidence(strategy: Strategy): number {
  const values: number[] = strategy.observations.map((o) => Math.min(o.confidence, SOURCE_CONFIDENCE_CAP[o.source]));
  if (strategy.series) values.push(SOURCE_CONFIDENCE_CAP[strategy.series.source] * (strategy.series.verified ? 1 : 0.9));
  return values.length ? Math.max(...values) : 0;
}

export function isSimulated(strategy: Strategy) {
  return strategy.series?.source === "simulated" || strategy.observations.some((o) => o.source === "simulated");
}

export function latestObservation(strategy: Strategy): Observation | null {
  return [...strategy.observations].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt))[0] ?? null;
}

export function assessQuality(strategy: Strategy, now: Date, staleAfterHours: number): QualityFlag[] {
  const flags: QualityFlag[] = [];
  const s = strategy.series;
  if (isSimulated(strategy)) flags.push({ code: "simulated", severity: "critical", message: "Simulated data. Use only for testing the engine, never for real allocation decisions." });
  if (!s && !strategy.observations.length) flags.push({ code: "no_data", severity: "critical", message: "No performance data recorded." });
  if (!s) flags.push({ code: "no_series", severity: "warning", message: "No return history; drawdown duration, volatility, Sharpe/Sortino and correlation cannot be computed." });
  if (s) {
    if (s.returns.length < MIN_POINTS_FOR_RATIOS) flags.push({ code: "short_history", severity: "warning", message: `Only ${s.returns.length} periods of history (need ${MIN_POINTS_FOR_RATIOS}+ for risk ratios).` });
    if (!s.verified) flags.push({ code: "unverified_series", severity: "info", message: `Return history is ${SOURCE_LABELS[s.source].toLowerCase()} and not independently verified.` });
    if (s.basis === "gross" && strategy.profitSharePct === null) flags.push({ code: "unknown_fees", severity: "warning", message: "Profit share unknown, so net returns cannot be estimated. Enter the provider's terms." });
    const big = s.returns.filter((r) => Math.abs(r) >= (s.frequency === "daily" ? 0.25 : 0.4)).length;
    if (big) flags.push({ code: "extreme_periods", severity: "warning", message: `${big} period(s) moved more than ${s.frequency === "daily" ? 25 : 40}% — consistent with high leverage or data errors.` });
    const m = computeMetrics(s);
    if (m.topPeriodsGainShare !== null && m.topPeriodsGainShare > 0.6 && s.returns.length >= 20) {
      flags.push({ code: "concentrated_gains", severity: "warning", message: `${Math.round(m.topPeriodsGainShare * 100)}% of gains came from the 5 best periods; results may depend on a few trades.` });
    }
    const last = s.dates[s.dates.length - 1];
    if (last && (now.getTime() - Date.parse(last)) / 3_600_000 > Math.max(staleAfterHours, s.frequency === "weekly" ? 24 * 9 : 48)) {
      flags.push({ code: "stale_series", severity: "warning", message: `Latest return is from ${last}; history is out of date.` });
    }
    const obs = latestObservation(strategy);
    if (obs?.values.maxDrawdownPct !== undefined && m.maxDrawdownPct > obs.values.maxDrawdownPct + 5 && s.returns.length >= 20) {
      flags.push({ code: "inconsistent_drawdown", severity: "warning", message: `History shows ${m.maxDrawdownPct}% drawdown but the profile reports ${obs.values.maxDrawdownPct}%. Check for a reset or selective reporting.` });
    }
  }
  const obs = latestObservation(strategy);
  if (obs && (now.getTime() - Date.parse(obs.collectedAt)) / 3_600_000 > staleAfterHours && !s) {
    flags.push({ code: "stale_observation", severity: "warning", message: `Latest figures were recorded ${obs.collectedAt.slice(0, 10)}; refresh them from the provider.` });
  }
  if (obs?.values.roiPct !== undefined && obs.values.periodDays !== undefined && obs.values.periodDays <= 30 && obs.values.roiPct > 50) {
    flags.push({ code: "roi_spike", severity: "warning", message: `${obs.values.roiPct}% ROI over ${obs.values.periodDays} days is a short-term spike, not evidence of a durable edge.` });
  }
  if (strategy.maxLeverage === null) flags.push({ code: "unknown_leverage", severity: "info", message: "Leverage not recorded." });
  return flags;
}

export type SeriesImport = { ok: true; series: ReturnSeries; warnings: string[] } | { ok: false; error: string };

/**
 * Parses CSV text with a header containing `date` and either `return_pct` (period return in %) or
 * `equity` (account value / cumulative index). Rejects unsorted dates, duplicates, and non-numeric values.
 */
export function parseSeriesCsv(text: string, options: { source: DataSource; collectedAt: string; basis: "gross" | "net"; maxPoints?: number }): SeriesImport {
  const maxPoints = options.maxPoints ?? 400;
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) return { ok: false, error: "Need a header row and at least two data rows." };
  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const di = header.indexOf("date");
  const ri = header.findIndex((h) => h === "return_pct" || h === "return");
  const ei = header.indexOf("equity");
  if (di < 0 || (ri < 0 && ei < 0)) return { ok: false, error: "Header must include `date` and `return_pct` or `equity`." };
  const dates: string[] = [];
  const values: number[] = [];
  for (const [n, line] of lines.slice(1).entries()) {
    const cells = line.split(",").map((c) => c.trim());
    const date = cells[di];
    const value = Number(cells[ri >= 0 ? ri : ei]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || Number.isNaN(Date.parse(date))) return { ok: false, error: `Row ${n + 2}: date must be YYYY-MM-DD.` };
    if (!Number.isFinite(value)) return { ok: false, error: `Row ${n + 2}: value is not a number.` };
    if (dates.length && date <= dates[dates.length - 1]) return { ok: false, error: `Row ${n + 2}: dates must be strictly increasing (duplicate or unsorted ${date}).` };
    dates.push(date);
    values.push(value);
  }
  let returns: number[];
  let outDates = dates;
  if (ri >= 0) {
    if (values.some((v) => v <= -100)) return { ok: false, error: "A period return of -100% or worse is not valid." };
    returns = values.map((v) => v / 100);
  } else {
    if (values.some((v) => v <= 0)) return { ok: false, error: "Equity values must be positive." };
    returns = values.slice(1).map((v, i) => v / values[i] - 1);
    outDates = dates.slice(1);
  }
  const gaps = outDates.slice(1).map((d, i) => (Date.parse(d) - Date.parse(outDates[i])) / 86_400_000);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] ?? 1;
  const frequency: ReturnSeries["frequency"] = median >= 5 ? "weekly" : "daily";
  const expected = frequency === "weekly" ? 7 : 1;
  const warnings: string[] = [];
  const missing = gaps.filter((g) => g > expected * 2).length;
  if (missing) warnings.push(`${missing} gap(s) in the dates; missing periods are not filled in.`);
  if (returns.length > maxPoints) {
    warnings.push(`Kept the most recent ${maxPoints} of ${returns.length} periods.`);
    returns = returns.slice(-maxPoints);
    outDates = outDates.slice(-maxPoints);
  }
  return {
    ok: true,
    warnings,
    series: { frequency, dates: outDates, returns: returns.map((r) => Math.round(r * 1e6) / 1e6), basis: options.basis, source: options.source, collectedAt: options.collectedAt, verified: options.source === "official_api" },
  };
}
