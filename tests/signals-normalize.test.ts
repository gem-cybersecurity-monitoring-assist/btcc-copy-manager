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
  const { created_at, id, ...derived } = { ...base, strategy: "worker_ema_crossover", price_source: "coinbase", event_id: "ema:BTC:88:BUY", market_data_as_of: "2026-10-31T11:59:00.000Z", market_data_stale: true, stale: true };
  void created_at; void id;
  const result = normalizeWorkerSignal(derived, now);
  assert.equal(result.ok, true); if (result.ok) assert.equal(result.value.freshness, "STALE");
});

test("keeps persisted signals without linked market data stale and non-decision-grade", () => {
  const result = normalizeWorkerSignal({
    ...base,
    created_at: undefined,
    schema_version: 1,
    event_id: "signal:BTC:42",
    source_kind: "persisted",
    provenance_status: "PERSISTED_SIGNAL",
    signal_created_at: "2026-10-31T11:55:00.000Z",
    market_data_as_of: null,
    market_snapshot_price: null,
    expires_at: "2026-10-31T12:10:00.000Z",
    stale: true,
    decision_grade: false,
    price_source: null,
  }, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.freshness, "STALE");
    assert.equal(result.value.decisionGrade, false);
    assert.equal(result.value.marketDataAsOf, null);
  }
});

test("rejects persisted signals falsely claiming fresh market data", () => {
  const result = normalizeWorkerSignal({
    ...base,
    created_at: undefined,
    schema_version: 1,
    event_id: "signal:BTC:42",
    source_kind: "persisted",
    provenance_status: "PERSISTED_SIGNAL",
    signal_created_at: "2026-10-31T11:55:00.000Z",
    market_data_as_of: "2026-10-31T11:59:00.000Z",
    expires_at: "2026-10-31T12:10:00.000Z",
    stale: false,
    decision_grade: true,
    price_source: "coinbase",
  }, now);
  assert.equal(result.ok, false);
});

test("normalizes a fresh versioned derived signal by market snapshot time", () => {
  const result = normalizeWorkerSignal({
    ...base,
    created_at: undefined,
    id: undefined,
    strategy: "worker_ema_crossover",
    schema_version: 1,
    event_id: "derived:BTC:77:BUY",
    source_kind: "derived",
    provenance_status: "DERIVED_WORKER_SIGNAL",
    signal_created_at: "2026-10-31T12:00:00.000Z",
    market_data_as_of: "2026-10-31T11:59:45.000Z",
    market_snapshot_price: 68000,
    expires_at: "2026-10-31T12:14:45.000Z",
    price_source: "coinbase",
    stale: false,
    decision_grade: true,
  }, now);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.freshness, "FRESH_BY_MARKET_TIME");
    assert.equal(result.value.eventId, "derived:BTC:77:BUY");
  }
});

test("rejects a derived signal whose entry price differs from the reported market snapshot", () => {
  const result = normalizeWorkerSignal({
    ...base,
    created_at: undefined,
    id: undefined,
    strategy: "worker_ema_crossover",
    schema_version: 1,
    event_id: "derived:BTC:77:BUY",
    source_kind: "derived",
    provenance_status: "DERIVED_WORKER_SIGNAL",
    signal_created_at: "2026-10-31T12:00:00.000Z",
    market_data_as_of: "2026-10-31T11:59:45.000Z",
    market_snapshot_price: 67999,
    expires_at: "2026-10-31T12:14:45.000Z",
    price_source: "coinbase",
    stale: false,
    decision_grade: true,
  }, now);
  assert.equal(result.ok, false);
});

test("keeps stale versioned signals visible but never decision-grade", () => {
  const result = normalizeWorkerSignal({
    ...base,
    schema_version: 1,
    event_id: "persisted:43",
    source_kind: "persisted",
    provenance_status: "PERSISTED_SIGNAL",
    signal_created_at: "2026-10-31T11:00:00.000Z",
    market_data_as_of: null,
    market_snapshot_price: null,
    expires_at: "2026-10-31T11:15:00.000Z",
    stale: true,
    decision_grade: false,
    price_source: null,
  }, now);
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.value.freshness, "STALE"); assert.equal(result.value.decisionGrade, false); }
});

test("rejects inconsistent or incomplete versioned provenance", () => {
  const valid = {
    ...base,
    created_at: undefined,
    schema_version: 1,
    event_id: "derived:BTC:77:BUY",
    source_kind: "derived",
    provenance_status: "DERIVED_WORKER_SIGNAL",
    signal_created_at: "2026-10-31T12:00:00.000Z",
    market_data_as_of: "2026-10-31T11:59:45.000Z",
    market_snapshot_price: 68000,
    expires_at: "2026-10-31T12:14:45.000Z",
    price_source: "coinbase",
    stale: false,
    decision_grade: true,
    strategy: "worker_ema_crossover",
  };
  assert.equal(normalizeWorkerSignal({ ...valid, decision_grade: false }, now).ok, false);
  assert.equal(normalizeWorkerSignal({ ...valid, market_data_as_of: "not-a-date" }, now).ok, false);
  assert.equal(normalizeWorkerSignal({ ...valid, provenance_status: "UNTRUSTED_PRICE_FALLBACK", price_source: "fallback", stale: true, decision_grade: false }, now).ok, false);
});
