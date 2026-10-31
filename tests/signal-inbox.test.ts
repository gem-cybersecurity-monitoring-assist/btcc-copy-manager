import assert from "node:assert/strict";
import test from "node:test";
import { isSignalInboxSymbol, normalizeWorkerSignal } from "../lib/signal-inbox.ts";

const safe = {
  symbol: "BTC", side: "HOLD", confidence: 0.5, entry_price: 77000,
  strategy: "worker_ema_crossover", available: true, price_source: "coinbase",
  mode: "paper", trading_mode: "paper", exchange_mode: "paper", network: "testnet",
  allow_mainnet: false, live_trading_enabled: false, withdrawals_enabled: false,
  ts: 1793480362110,
};

test("allows only the explicit supported symbol set", () => {
  assert.equal(isSignalInboxSymbol("btc"), true);
  assert.equal(isSignalInboxSymbol("ETH"), true);
  assert.equal(isSignalInboxSymbol("UNLISTED"), false);
  assert.equal(isSignalInboxSymbol("BTCUSDT"), false);
});

test("normalizes a fresh-source signal but always requires human review", () => {
  const result = normalizeWorkerSignal(safe, "BTC");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.side, "HOLD");
  assert.equal(result.value.confidence, 0.5);
  assert.equal(result.value.reviewState, "REVIEW_REQUIRED");
  assert.equal(result.value.sourceKind, "DERIVED_WORKER_SIGNAL");
  assert.equal(result.value.createdAt, null);
  assert.ok(result.value.responseAt);
});

test("blocks a static fallback even when the Worker says available", () => {
  const result = normalizeWorkerSignal({ ...safe, price_source: "fallback", entry_price: 1 }, "BTC");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.reviewState, "BLOCKED_FALLBACK");
});

test("marks cached or unknown price provenance for extra review", () => {
  const cached = normalizeWorkerSignal({ ...safe, price_source: "cache:coinbase" }, "BTC");
  assert.equal(cached.ok, true);
  if (cached.ok) assert.equal(cached.value.reviewState, "STALE_REVIEW");
  const unknown = normalizeWorkerSignal({ ...safe, price_source: undefined }, "BTC");
  assert.equal(unknown.ok, true);
  if (unknown.ok) assert.equal(unknown.value.reviewState, "STALE_REVIEW");
});

test("rejects unsupported side, invalid confidence, and invalid price", () => {
  assert.equal(normalizeWorkerSignal({ ...safe, side: "UP" }, "BTC").ok, false);
  assert.equal(normalizeWorkerSignal({ ...safe, confidence: 1.5 }, "BTC").ok, false);
  assert.equal(normalizeWorkerSignal({ ...safe, entry_price: 0 }, "BTC").ok, false);
});

test("rejects mismatched symbols and any runtime without all paper-only flags", () => {
  assert.equal(normalizeWorkerSignal({ ...safe, symbol: "ETH" }, "BTC").ok, false);
  assert.equal(normalizeWorkerSignal({ ...safe, allow_mainnet: true }, "BTC").ok, false);
  assert.equal(normalizeWorkerSignal({ ...safe, withdrawals_enabled: true }, "BTC").ok, false);
  assert.equal(normalizeWorkerSignal({ ...safe, live_trading_enabled: true }, "BTC").ok, false);
});

test("identifies a persisted signal without treating its timestamp as market-data time", () => {
  const result = normalizeWorkerSignal({ ...safe, id: 42, created_at: "2026-10-31 20:59:19" }, "BTC");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.sourceKind, "PERSISTED_SIGNAL");
  assert.equal(result.value.createdAt, "2026-10-31T20:59:19.000Z");
  assert.equal(result.value.reviewState, "REVIEW_REQUIRED");
});
