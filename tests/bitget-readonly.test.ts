import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyUtaPermissions } from "../src/lib/bitget-readonly.ts";

test("accepts the minimum UTA management/read permission", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"]), true);
});

test("rejects keys that can trade", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt", "uta_trade"]), false);
});

test("rejects keys that can withdraw", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt", "withdraw"]), false);
});

test("rejects copy-trading permissions and any extra permission", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt", "copy_futures_position"]), false);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt", "copy_futures_order"]), false);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt", "unknown_permission"]), false);
});

test("fails closed for missing or malformed permission responses", () => {
  assert.equal(isReadOnlyUtaPermissions(undefined), false);
  assert.equal(isReadOnlyUtaPermissions(null), false);
  assert.equal(isReadOnlyUtaPermissions("uta_mgt"), false);
  assert.equal(isReadOnlyUtaPermissions([]), false);
  assert.equal(isReadOnlyUtaPermissions([null]), false);
});
