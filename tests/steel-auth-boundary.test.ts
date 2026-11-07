import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

test("Steel authentication has no source-embedded recovery-passphrase bypass", async () => {
  const route = await readFile(join(process.cwd(), "src/app/api/v1/steel/auth/route.ts"), "utf8");
  assert.doesNotMatch(route, /RECOVERY_(?:CANONICAL_)?PASSPHRASE_SHA256/);
  assert.doesNotMatch(route, /verifyRecoveryPassphrase/);
  assert.match(route, /recoveryPassphraseEnabled: false/);
  assert.match(route, /verifyControlSecret\(secret\)/);
  assert.match(route, /verifyLegacyControlSecret\(secret\)/);
});
