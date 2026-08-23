import test from "node:test";
import assert from "node:assert/strict";

import {
  extractBtccEvidence,
  isBtccJsonResponse,
  sanitizeBtccUrl,
  sanitizeBtccValue
} from "../src/lib/btcc-browser-audit.ts";

test("BTCC URLs are stored without query parameters or fragments", () => {
  assert.equal(
    sanitizeBtccUrl("https://www.btcc.com/en-US/assets?token=secret#private"),
    "https://www.btcc.com/en-US/assets"
  );
});

test("sensitive fields are redacted recursively", () => {
  const result = sanitizeBtccValue({
    balance: 43.85,
    token: "super-secret-token",
    nested: { password: "never-save-this", pnl: 71.19 }
  }) as Record<string, unknown>;

  assert.equal(result.balance, 43.85);
  assert.equal(result.token, "[REDACTED]");
  assert.deepEqual(result.nested, { password: "[REDACTED]", pnl: 71.19 });
});

test("evidence extraction keeps financial state and excludes credentials", () => {
  const evidence = extractBtccEvidence([
    "Total Account Value $94.58",
    "Futures USDT 43.85",
    "Copy Trading PnL 71.19 USDT",
    "Password: do-not-save",
    "Welcome to BTCC"
  ].join("\n"));

  assert.deepEqual(evidence, [
    "Total Account Value $94.58",
    "Futures USDT 43.85",
    "Copy Trading PnL 71.19 USDT"
  ]);
});

test("network capture accepts BTCC JSON/XHR and rejects other hosts", () => {
  assert.equal(isBtccJsonResponse({ url: "https://api.btcc.com/account", mimeType: "application/json", resourceType: "XHR" }), true);
  assert.equal(isBtccJsonResponse({ url: "https://example.com/account", mimeType: "application/json", resourceType: "XHR" }), false);
});
