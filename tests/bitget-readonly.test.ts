import assert from "node:assert/strict";
import test from "node:test";
import { isReadOnlyUtaPermissions } from "../src/lib/bitget-readonly.ts";

test("accepts a read-only key with UTA management, in both of Bitget's spellings", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "read-only"), true);
  // Bitget's live account/info returns "readonly" without a hyphen.
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "readonly"), true);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "ReadOnly"), true);
});

test("rejects read-write keys even when their only listed scope is UTA management", () => {
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "read-and-write"), false);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "read_write"), false);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "read_only"), false);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], "readwrite"), false);
});

test("rejects trading, withdrawal and copy-trading permissions", () => {
  for (const permissions of [
    ["uta_mgt", "uta_trade"],
    ["uta_mgt", "withdraw"],
    ["uta_mgt", "copy_futures_position"],
    ["uta_mgt", "copy_futures_order"],
  ]) assert.equal(isReadOnlyUtaPermissions(permissions, "readonly"), false);
});

test("fails closed for missing or malformed permission responses", () => {
  for (const permissions of [undefined, null, "uta_mgt", [], [null], ["uta_trade"], [1]]) {
    assert.equal(isReadOnlyUtaPermissions(permissions, "read-only"), false);
  }
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], undefined), false);
  assert.equal(isReadOnlyUtaPermissions(["uta_mgt"], 1), false);
});
