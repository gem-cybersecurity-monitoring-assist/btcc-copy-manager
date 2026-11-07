import test from "node:test";
import assert from "node:assert/strict";
import { runLocalRiskReview, inspectLocalAutomation } from "../src/lib/browser-automation.ts";
import { defaultEngineState } from "../lib/engine/state.ts";
import { simulatedStrategies } from "../lib/engine/sample-data.ts";
import { STORAGE_KEYS } from "../lib/workspace.ts";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
function setup() {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: () => {} } });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: class { type: string; constructor(type: string) { this.type = type; } } });
  return storage;
}

test("unconfigured browser automation does not fabricate work", () => {
  setup();
  assert.equal(inspectLocalAutomation().configured, false);
  assert.equal(runLocalRiskReview(false).status, "empty");
});

test("malformed workspace fails closed without modifying engine record", () => {
  const storage = setup();
  const bad = '{"version":1,"strategies":"untrusted"}';
  storage.setItem(STORAGE_KEYS.engine, bad);
  assert.equal(runLocalRiskReview(true).status, "invalid");
  assert.equal(storage.getItem(STORAGE_KEYS.engine), bad);
});

test("scheduled risk review persists once and records audit without placing financial orders", () => {
  const storage = setup();
  const now = new Date("2026-11-07T06:00:00Z");
  const engine = { ...defaultEngineState(), strategies: [simulatedStrategies(now, 45)[0]] };
  storage.setItem(STORAGE_KEYS.engine, JSON.stringify(engine));
  const first = runLocalRiskReview(false, now);
  assert.equal(first.status, "completed");
  const report = inspectLocalAutomation();
  assert.equal(report.strategyCount, 1);
  assert.equal(report.lastRunAt, now.toISOString());
  const serialized = storage.getItem(STORAGE_KEYS.engine)!;
  assert.match(serialized, /monitor_run/);
  assert.equal(runLocalRiskReview(false, new Date("2026-11-07T06:05:00Z")).status, "not_due");
  assert.equal(storage.getItem(STORAGE_KEYS.engine), serialized);
});
