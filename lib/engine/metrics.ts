// Performance and risk metrics from periodic return series. Pure functions, no I/O.

import type { ReturnSeries } from "./types.ts";

export const PERIODS_PER_YEAR = { daily: 365, weekly: 52 } as const;
/** Ratios such as Sharpe are not reported from fewer observations than this. */
export const MIN_POINTS_FOR_RATIOS = 30;

export type SeriesMetrics = {
  points: number;
  firstDate: string | null;
  lastDate: string | null;
  totalReturnPct: number;
  annualizedReturnPct: number | null;
  volatilityPct: number | null;
  downsideDeviationPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownPct: number;
  maxDrawdownDurationPeriods: number;
  currentDrawdownPct: number;
  winRatePct: number | null;
  avgWinPct: number | null;
  avgLossPct: number | null;
  profitFactor: number | null;
  worstPeriodPct: number | null;
  bestPeriodPct: number | null;
  /** Share of total gains produced by the 5 best periods (0..1). High values mean a few lucky periods drive results. */
  topPeriodsGainShare: number | null;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

export function equityCurve(returns: number[], start = 1): number[] {
  const out: number[] = [];
  let v = start;
  for (const r of returns) {
    v *= 1 + r;
    out.push(v);
  }
  return out;
}

export function drawdownStats(returns: number[]) {
  let peak = 1, value = 1, maxDd = 0, duration = 0, maxDuration = 0;
  for (const r of returns) {
    value *= 1 + r;
    if (value >= peak) {
      peak = value;
      duration = 0;
    } else {
      duration += 1;
      maxDuration = Math.max(maxDuration, duration);
      maxDd = Math.max(maxDd, 1 - value / peak);
    }
  }
  return { maxDrawdown: maxDd, maxDurationPeriods: maxDuration, currentDrawdown: peak > 0 ? 1 - value / peak : 0 };
}

/**
 * Converts gross copied returns to estimated net returns for a follower: a profit share charged on new
 * equity highs (high-water mark) plus a per-period cost drag (fees, funding, slippage estimate).
 */
export function netReturns(gross: number[], profitSharePct: number, perPeriodCostPct = 0): number[] {
  const share = Math.max(0, Math.min(profitSharePct, 100)) / 100;
  const drag = Math.max(0, perPeriodCostPct) / 100;
  const out: number[] = [];
  let value = 1, hwm = 1;
  for (const r of gross) {
    const before = value;
    let next = value * (1 + r) * (1 - drag);
    if (next > hwm) {
      next -= (next - hwm) * share;
      hwm = next;
    }
    value = next;
    out.push(before > 0 ? value / before - 1 : 0);
  }
  return out;
}

export function computeMetrics(series: Pick<ReturnSeries, "dates" | "returns" | "frequency">, returns: number[] = series.returns): SeriesMetrics {
  const n = returns.length;
  const ppy = PERIODS_PER_YEAR[series.frequency];
  const dd = drawdownStats(returns);
  const total = n ? equityCurve(returns)[n - 1] - 1 : 0;
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r < 0);
  const enough = n >= MIN_POINTS_FOR_RATIOS;
  const vol = n >= 2 ? stdev(returns) : null;
  const downside = n >= 2 ? Math.sqrt(returns.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / n) : null;
  const avg = n ? mean(returns) : 0;
  const grossGain = wins.reduce((a, b) => a + b, 0);
  const grossLoss = -losses.reduce((a, b) => a + b, 0);
  const sortedWins = [...wins].sort((a, b) => b - a);
  return {
    points: n,
    firstDate: series.dates[0] ?? null,
    lastDate: series.dates[n - 1] ?? null,
    totalReturnPct: round(total * 100, 2),
    annualizedReturnPct: enough && total > -1 ? round(((1 + total) ** (ppy / n) - 1) * 100, 2) : null,
    volatilityPct: enough && vol !== null ? round(vol * Math.sqrt(ppy) * 100, 2) : null,
    downsideDeviationPct: enough && downside !== null ? round(downside * Math.sqrt(ppy) * 100, 2) : null,
    sharpe: enough && vol ? round((avg / vol) * Math.sqrt(ppy), 2) : null,
    sortino: enough && downside ? round((avg / downside) * Math.sqrt(ppy), 2) : null,
    maxDrawdownPct: round(dd.maxDrawdown * 100, 2),
    maxDrawdownDurationPeriods: dd.maxDurationPeriods,
    currentDrawdownPct: round(dd.currentDrawdown * 100, 2),
    winRatePct: n ? round((wins.length / n) * 100, 1) : null,
    avgWinPct: wins.length ? round(mean(wins) * 100, 3) : null,
    avgLossPct: losses.length ? round(mean(losses) * 100, 3) : null,
    profitFactor: grossLoss > 0 ? round(grossGain / grossLoss, 2) : null,
    worstPeriodPct: n ? round(Math.min(...returns) * 100, 2) : null,
    bestPeriodPct: n ? round(Math.max(...returns) * 100, 2) : null,
    topPeriodsGainShare: grossGain > 0 ? round(sortedWins.slice(0, 5).reduce((a, b) => a + b, 0) / grossGain, 3) : null,
  };
}

/** Pearson correlation on dates both series share. Null when fewer than `minOverlap` shared points. */
export function correlation(a: Pick<ReturnSeries, "dates" | "returns">, b: Pick<ReturnSeries, "dates" | "returns">, minOverlap = 20): { value: number | null; overlap: number } {
  const index = new Map(b.dates.map((d, i) => [d, b.returns[i]]));
  const xs: number[] = [], ys: number[] = [];
  a.dates.forEach((d, i) => {
    const y = index.get(d);
    if (y !== undefined) { xs.push(a.returns[i]); ys.push(y); }
  });
  if (xs.length < minOverlap) return { value: null, overlap: xs.length };
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return { value: null, overlap: xs.length };
  return { value: round(num / Math.sqrt(dx * dy), 3), overlap: xs.length };
}

/** Jaccard overlap of traded assets (case-insensitive). 1 = identical asset sets. */
export function assetOverlap(a: string[], b: string[]): number {
  const sa = new Set(a.map((x) => x.trim().toUpperCase()).filter(Boolean));
  const sb = new Set(b.map((x) => x.trim().toUpperCase()).filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Splits a series at a fraction of its length: [baseline, recent]. */
export function splitRecent(returns: number[], recentFraction = 0.2, minRecent = 10) {
  const recentLen = Math.max(minRecent, Math.round(returns.length * recentFraction));
  if (returns.length < recentLen * 2) return null;
  return { baseline: returns.slice(0, returns.length - recentLen), recent: returns.slice(returns.length - recentLen) };
}

export { mean, stdev };
