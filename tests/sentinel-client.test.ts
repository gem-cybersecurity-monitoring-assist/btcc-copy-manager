import assert from "node:assert/strict";
import test from "node:test";
import { containsForbiddenCredentialKeys } from "../src/lib/sentinel-client";

test("allows normalized read-only Sentinel payloads", () => {
  assert.equal(
    containsForbiddenCredentialKeys({
      account: { total_usdt: 54.74, futures_free_usdt: 1.34, wallet_usdt: 53.4, open_margin_usdt: 0 },
      traders: [{ name: "example", recent_trades: [] }],
    }),
    false,
  );
});

test("blocks credentials anywhere in nested collector payload", () => {
  assert.equal(containsForbiddenCredentialKeys({ account: {}, metadata: { cookie: "do-not-send" } }), true);
  assert.equal(containsForbiddenCredentialKeys({ token: "do-not-send" }), true);
  assert.equal(containsForbiddenCredentialKeys({ nested: [{ password: "do-not-send" }] }), true);
});
