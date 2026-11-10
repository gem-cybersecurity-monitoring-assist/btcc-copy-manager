import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PREFERENCES, decideSync, fingerprint, readSyncMeta, syncablePreferences, type SyncMeta } from "../lib/cloud-sync.ts";

const user = "11111111-1111-4111-8111-111111111111";
const prefs = (budget: string, extra: Record<string, unknown> = {}) =>
  syncablePreferences({ budget, maxLoss: "2", activity: [], ...extra })!;
const meta = (p: ReturnType<typeof prefs>): SyncMeta => ({ userId: user, updatedAt: "2026-11-10T08:00:00Z", fingerprint: fingerprint(p) });

test("only whitelisted preference fields can sync; credentials are dropped", () => {
  const result = syncablePreferences({
    budget: "25", maxLoss: "3", activity: [],
    walletAddresses: { metamask: "0x" + "a".repeat(40) },
    apiKey: "bg_KEY", secret: "SECRET", passphrase: "PHRASE", investorPassword: "PW",
  } as any);
  assert.deepEqual(Object.keys(result!).sort(), ["activity", "budget", "maxLoss", "walletAddresses"]);
  assert.ok(!JSON.stringify(result).match(/KEY|SECRET|PHRASE|PW/));
  assert.equal(syncablePreferences({ budget: "-1", maxLoss: "2", activity: [] }), null, "invalid values never sync");
});

test("fingerprint ignores empty wallet maps and key order", () => {
  assert.equal(fingerprint(prefs("10")), fingerprint(prefs("10", { walletAddresses: {} })));
  assert.notEqual(fingerprint(prefs("10")), fingerprint(prefs("11")));
});

test("decisions: in sync, apply cloud, push local, conflict", () => {
  const a = prefs("10"), b = prefs("20"), c = prefs("30");
  assert.equal(decideSync({ local: a, cloud: a, meta: null }), "in_sync");
  assert.equal(decideSync({ local: a, cloud: null, meta: null }), "push_local", "first save creates the cloud copy");
  assert.equal(decideSync({ local: a, cloud: b, meta: meta(a) }), "apply_cloud", "only the cloud changed (other device)");
  assert.equal(decideSync({ local: b, cloud: a, meta: meta(a) }), "push_local", "only this device changed");
  assert.equal(decideSync({ local: b, cloud: c, meta: meta(a) }), "conflict", "both changed: never overwrite");
});

test("a fresh device takes the cloud; a used device that never synced asks", () => {
  const cloud = prefs("50");
  assert.equal(decideSync({ local: syncablePreferences(DEFAULT_PREFERENCES), cloud, meta: null }), "apply_cloud");
  assert.equal(decideSync({ local: prefs("15"), cloud, meta: null }), "conflict");
});

test("sync metadata is bound to the signed-in user and validated", () => {
  const raw = JSON.stringify(meta(prefs("10")));
  assert.ok(readSyncMeta(raw, user));
  assert.equal(readSyncMeta(raw, "22222222-2222-4222-8222-222222222222"), null, "another account's metadata is ignored");
  assert.equal(readSyncMeta("not json", user), null);
  assert.equal(readSyncMeta(JSON.stringify({ userId: user, updatedAt: 5, fingerprint: "x" }), user), null);
});

test("workspace sync sends only the whitelisted preferences and never connection secrets", () => {
  const source = readFileSync(join(process.cwd(), "src/components/copy-center-workspace.tsx"), "utf8");
  const put = source.slice(source.indexOf("async function pushLocal"), source.indexOf("/** Compares this device"));
  assert.match(put, /copyCenter: prefs/);
  assert.doesNotMatch(put, /bgKey|bgSecret|bgPhrase|apiKey|passphrase|investorPassword/);
  assert.match(put, /expectedUpdatedAt: current\.updatedAt/, "saves are revision-conditional");
});
