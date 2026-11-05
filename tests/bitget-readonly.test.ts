import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyUtaPermissions } from "../src/lib/bitget-readonly.ts";

test("accepts only a read-only key with the minimum UTA management/read permission", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "read-only"), true);
});

test("rejects read-write keys even when their only listed scope is UTA management", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "read-and-write"), false);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "read_write"), false);
});

test("rejects trading, withdrawal, copy-trading, and unknown permissions", () => {
  for (const permissions of [
    ["uta_mgt", "uta_trade"],
    ["uta_mgt", "withdraw"],
    ["uta_mgt", "copy_futures_position"],
    ["uta_mgt", "copy_futures_order"],
    ["uta_mgt", "unknown_permission"]
  ]) assert.equal(isReadOnlyUtaPermissions(permissions, "read-only"), false);
});

test("fails closed for missing or malformed permission responses", () => {
  for (const permissions of [undefined, null, "uta_mgt", [], [null]]) {
    assert.equal(isReadOnlyUtaPermissions(permissions, "read-only"), false);
  }
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], undefined), false);
});
