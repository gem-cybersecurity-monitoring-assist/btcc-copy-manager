import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyUtaPermissions } from "../src/lib/bitget-readonly.ts";

test("accepts only the minimum UTA management/read permission", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"]), true);
});

test("rejects trade, withdrawal, and copy-trading permissions", () => {
  for (const permissions of [
    ["uta_mgt", "uta_trade"],
    ["uta_mgt", "withdraw"],
    ["uta_mgt", "copy_futures_position"],
    ["uta_mgt", "copy_futures_order"],
    ["uta_mgt", "unknown_permission"]
  ]) assert.equal(isReadOnlyUtaPermissions(permissions), false);
});

test("fails closed for missing or malformed permission responses", () => {
  for (const permissions of [undefined, null, "uta_mgt", [], [null]]) {
    assert.equal(isReadOnlyUtaPermissions(permissions), false);
  }
});
