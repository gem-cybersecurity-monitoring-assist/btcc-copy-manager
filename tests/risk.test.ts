import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PLAN, evaluateRisk } from "../src/lib/risk.ts";

test("default review plan produces finite exposure", () => {
  const result = evaluateRisk(DEFAULT_PLAN);
  assert.equal(result.notionalPerTradeUsdt, 50);
  assert.equal(result.portfolioExposureUsdt, 150);
  assert.ok(result.score >= 0 && result.score <= 100);
});

test("missing capital fails closed", () => {
  const result = evaluateRisk({ ...DEFAULT_PLAN, allocatedUsdt: 0 });
  assert.equal(result.grade, "CRITICAL");
  assert.equal(result.score, 100);
});

test("high leverage scores above conservative plan", () => {
  const conservative = evaluateRisk({ ...DEFAULT_PLAN, leverage: 2, maxOpenTrades: 1, leaderDrawdownPercent: 4 });
  const aggressive = evaluateRisk({ ...DEFAULT_PLAN, leverage: 25, maxOpenTrades: 5, leaderDrawdownPercent: 30 });
  assert.ok(aggressive.score > conservative.score);
  assert.equal(aggressive.grade, "CRITICAL");
});
