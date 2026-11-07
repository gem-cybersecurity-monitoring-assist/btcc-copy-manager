import test from "node:test";
import assert from "node:assert/strict";
import { summarizeRecordedEquity, calculateFlowAdjustedReturns } from "../lib/performance.ts";
import type { Snapshot } from "../lib/workspace.ts";

const observation = (venue: string, date: string, equity: number): Snapshot => ({
  id: venue + date, venue, capturedAt: date, equity,
  available: equity, unrealizedPnl: 0, note: "", source: "manual",
});

test("recorded equity is never labeled verified net ROI", () => {
  const result = summarizeRecordedEquity([
    observation("BTCC", "2026-11-02T00:00:00Z", 120),
    observation("Bitget", "2026-11-01T00:00:00Z", 500),
    observation("BTCC", "2026-11-01T00:00:00Z", 100),
    observation("Bitget", "2026-11-03T00:00:00Z", 600),
  ]);
  assert.equal(result.length, 2);
  assert.equal(result.find((r) => r.venue === "BTCC")?.changeUsd, 20);
  assert.equal(result.find((r) => r.venue === "BTCC")?.unadjustedChangePct, 20);
  assert.equal(result.find((r) => r.venue === "BTCC")?.verifiedNetRoi, null);
  assert.equal(result.find((r) => r.venue === "Bitget")?.changeUsd, 100);
});

test("single, invalid and same-time snapshots cannot produce performance comparisons", () => {
  assert.deepEqual(summarizeRecordedEquity([observation("BTCC", "2026-11-01T00:00:00Z", 100)]), []);
  assert.deepEqual(summarizeRecordedEquity([
    observation("BTCC", "2026-11-01T00:00:00Z", 100),
    observation("BTCC", "2026-11-01T00:00:00Z", 200),
  ]), []);
});

test("external deposits do not count as returns and drawdown reflects cash-flow-adjusted equity", () => {
  const result = calculateFlowAdjustedReturns([
    { timestamp: "2026-11-01T00:00:00Z", equityUsd: 100, externalFlowUsd: 0 },
    { timestamp: "2026-11-02T00:00:00Z", equityUsd: 160, externalFlowUsd: 50 },
    { timestamp: "2026-11-03T00:00:00Z", equityUsd: 145, externalFlowUsd: 0 },
  ]);
  assert.ok(result);
  assert.ok(result.flowAdjustedReturnPct < 0);
  assert.ok(result.maxDrawdownPct > 0);
});
test("missing and invalid equity data fails closed", () => {
  assert.equal(calculateFlowAdjustedReturns([]), null);
  assert.equal(calculateFlowAdjustedReturns([
    { timestamp: "2026-11-01T00:00:00Z", equityUsd: 100, externalFlowUsd: 0 },
    { timestamp: "2026-11-02T00:00:00Z", equityUsd: NaN, externalFlowUsd: 0 },
  ]), null);
});
