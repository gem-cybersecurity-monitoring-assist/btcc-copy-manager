import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkerSignal } from "../lib/signals/normalize.ts";

const now = Date.parse("2026-10-31T12:00:00.000Z");
const base = { symbol: "BTCUSDT", side: "BUY", confidence: 0.72, entry_price: 68000, stop_loss: 66000, take_profit: 71000, strategy: "trend-following", created_at: "2026-10-31T11:55:00.000Z", id: 42, available: true, mode: "paper", trading_mode: "paper", network: "testnet", allow_mainnet: false, live_trading_enabled: false, withdrawals_enabled: false, ts: now };

test("normalizes a recent persisted paper signal", () => {
  const result = normalizeWorkerSignal(base, now);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.value.symbol, "BTC"); assert.equal(result.value.source, "PERSISTED_SIGNAL"); assert.equal(result.value.freshness, "FRESH_BY_SIGNAL_TIME"); assert.equal(result.value.readOnly, true); assert.equal(result.value.reviewRequired, true); }
});
test("marks old persisted signals stale", () => {
  const result = normalizeWorkerSignal({ ...base, created_at: "2026-10-31T11:00:00.000Z" }, now);
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.freshness, "STALE");
});
test("marks derived signals as source-time-unverified even when the price feed is live", () => {
  const { created_at, id, ...derived } = { ...base, strategy: "worker_ema_crossover", price_source: "coinbase" };
  void created_at; void id;
  const result = normalizeWorkerSignal(derived, now);
  assert.equal(result.ok, true); if (result.ok) { assert.equal(result.value.source, "DERIVED_WORKER_SIGNAL"); assert.equal(result.value.freshness, "SOURCE_TIME_UNVERIFIED"); }
});
test("rejects cached and static fallback prices for derived signals", () => {
  for (const price_source of ["fallback", "cache:coinbase", undefined]) {
    const { created_at, id, ...derived } = { ...base, strategy: "worker_ema_crossover", price_source }; void created_at; void id;
    assert.equal(normalizeWorkerSignal(derived, now).ok, false);
  }
});
test("rejects missing or weakened paper-only safety flags", () => {
  for (const patch of [{ allow_mainnet: true }, { live_trading_enabled: true }, { withdrawals_enabled: true }, { network: "mainnet" }, { trading_mode: "live" }]) {
    assert.equal(normalizeWorkerSignal({ ...base, ...patch }, now).ok, false);
  }
});
test("rejects unknown symbols, directions, confidence, prices and risk levels", () => {
  const bad = [{ symbol: "FAKEUSDT" }, { side: "SHORT" }, { confidence: 1.1 }, { confidence: Number.NaN }, { entry_price: 0 }, { entry_price: Infinity }, { stop_loss: -1 }, { take_profit: "71000" }];
  for (const patch of bad) assert.equal(normalizeWorkerSignal({ ...base, ...patch }, now).ok, false);
});
test("rejects malformed and future timestamps", () => {
  assert.equal(normalizeWorkerSignal({ ...base, created_at: "not-a-date" }, now).ok, false);
  assert.equal(normalizeWorkerSignal({ ...base, created_at: "2026-10-31T13:00:00.000Z" }, now).ok, false);
});
test("accepts fresh derived signals only when Worker supplies a fresh matching market timestamp", () => {
  const { created_at, id, ...derived } = { ...base, strategy: "worker_ema_crossover", price_source: "coinbase", event_id: "ema:BTC:88:BUY", market_data_as_of: "2026-10-31T11:59:00.000Z", market_data_stale: false, stale: false };
  void created_at; void id;
  const result = normalizeWorkerSignal(derived, now);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.value.freshness, "FRESH_MARKET_DATA"); assert.equal(result.value.marketDataAsOf, "2026-10-31T11:59:00.000Z"); assert.equal(result.value.id, "ema:BTC:88:BUY"); }
});
test("marks Worker-reported stale derived market data stale", () => {
  const { created_at, id, ...derived } = { ...base, strategy: "worker_ema_crossover", price_source: "coinbase", market_data_as_of: "2026-10-31T11:59:00.000Z", market_data_stale: true, stale: true };
  void created_at; void id;
  const result = normalizeWorkerSignal(derived, now);
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.freshness, "STALE");
});