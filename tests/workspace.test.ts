import assert from "node:assert/strict";
import test from "node:test";
import {
  createBackup,
  emptyWorkspace,
  isWorkspaceEmpty,
  LIMITS,
  loadStoredList,
  normalizeSnapshot,
  normalizeTrader,
  parseBackupText,
  parseWorkspace,
  toCsv,
  traderKey,
} from "../lib/workspace.ts";

const trader = { name: "Alpha", venue: "BTCC", period: "90 days", roi: 5, drawdown: 10, winRate: 55, trades: 120, leverage: "Low", profitShare: "Check venue terms", history: "User-entered", note: "" };
const snapshot = { id: "s1", venue: "BTCC", capturedAt: "2026-10-24T10:00:00.000Z", equity: 100, available: 80, unrealizedPnl: -2, note: "", source: "User-entered; not independently verified" };

test("accepts a valid workspace and de-duplicates bookmarks", () => {
  const result = parseWorkspace({ traders: [trader], savedReviews: ["Alpha", "Alpha"], portfolioSnapshots: [snapshot] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.traders.length, 1);
    assert.deepEqual(result.value.savedReviews, ["Alpha"]);
    assert.equal(result.value.portfolioSnapshots.length, 1);
  }
});

test("accepts an empty workspace", () => {
  const result = parseWorkspace(emptyWorkspace());
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(isWorkspaceEmpty(result.value), true);
});

test("rejects non-object and missing-list payloads", () => {
  for (const input of [null, undefined, "x", 42, [], { traders: [] }, { traders: {}, savedReviews: [] }]) {
    assert.equal(parseWorkspace(input).ok, false, JSON.stringify(input));
  }
});

test("rejects any malformed trader so nothing is partially restored", () => {
  const bad = [
    { ...trader, name: "" },
    { ...trader, drawdown: 101 },
    { ...trader, winRate: -1 },
    { ...trader, trades: 1.5 },
    { ...trader, roi: Number.NaN },
    { ...trader, roi: "5" },
    { ...trader, name: "x".repeat(LIMITS.text + 1) },
  ];
  for (const t of bad) assert.equal(parseWorkspace({ traders: [trader, t], savedReviews: [], portfolioSnapshots: [] }).ok, false);
});

test("rejects malformed snapshots", () => {
  const bad = [{ ...snapshot, capturedAt: "not a date" }, { ...snapshot, equity: -1 }, { ...snapshot, id: "" }, { ...snapshot, note: 5 }];
  for (const s of bad) assert.equal(normalizeSnapshot(s), null);
  assert.equal(parseWorkspace({ traders: [], savedReviews: [], portfolioSnapshots: [bad[0]] }).ok, false);
});

test("enforces record-count limits", () => {
  const many = Array.from({ length: LIMITS.traders + 1 }, (_, i) => ({ ...trader, name: "T" + i }));
  const result = parseWorkspace({ traders: many, savedReviews: [], portfolioSnapshots: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /limit/);
});

test("fills optional trader text fields with safe defaults", () => {
  const { profitShare, note, ...minimal } = trader;
  void profitShare; void note;
  const normalized = normalizeTrader(minimal);
  assert.equal(normalized?.profitShare, "Check venue terms");
  assert.equal(normalized?.note, "");
});

test("backup import: validates JSON, schema and size; v1 backups without snapshots are accepted", () => {
  assert.equal(parseBackupText("{not json").ok, false);
  assert.equal(parseBackupText(JSON.stringify({ schema: "other", traders: [], savedReviews: [] })).ok, false);
  assert.equal(parseBackupText("x".repeat(LIMITS.maxBytes + 1)).ok, false);
  const v1 = parseBackupText(JSON.stringify({ schema: "gem-copy-center-backup-v1", traders: [trader], savedReviews: [] }));
  assert.equal(v1.ok, true);
  if (v1.ok) assert.equal(v1.value.portfolioSnapshots.length, 0);
});

test("backup export round-trips through import", () => {
  const workspace = { traders: [normalizeTrader(trader)!], savedReviews: ["Alpha"], portfolioSnapshots: [snapshot] };
  const backup = createBackup(workspace, new Date("2026-10-24T00:00:00Z"));
  assert.equal(backup.schema, "gem-copy-center-backup-v2");
  const parsed = parseBackupText(JSON.stringify(backup));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value, workspace);
});

test("local storage loader drops corrupt records instead of crashing", () => {
  assert.deepEqual(loadStoredList(null, normalizeTrader), { items: [], dropped: 0 });
  assert.deepEqual(loadStoredList("{broken", normalizeTrader), { items: [], dropped: 1 });
  assert.deepEqual(loadStoredList("{}", normalizeTrader), { items: [], dropped: 1 });
  const mixed = loadStoredList(JSON.stringify([trader, { name: 1 }, null]), normalizeTrader);
  assert.equal(mixed.items.length, 1);
  assert.equal(mixed.dropped, 2);
});

test("CSV uses real CRLF line breaks, quotes cells, and neutralizes formulas", () => {
  const csv = toCsv(["a", "b"], [["=HYPERLINK(\"x\")", -5], ["say \"hi\"", 1]]);
  const lines = csv.split("\r\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[1], '"\'=HYPERLINK(""x"")","-5"');
  assert.equal(lines[2], '"say ""hi""","1"');
  assert.equal(csv.includes("\\r\\n"), false);
});

test("trader identity is venue-scoped and case-insensitive", () => {
  assert.equal(traderKey({ name: "Alpha", venue: "BTCC" }), traderKey({ name: "alpha", venue: "BTCC" }));
  assert.notEqual(traderKey({ name: "Alpha", venue: "BTCC" }), traderKey({ name: "Alpha", venue: "Bitget" }));
});

test("validates and round-trips cloud-synced Copy Center preferences", () => {
  const copyCenter = {
    budget: "10",
    maxLoss: "2",
    activity: [{ id: "evt-1", at: "2026-10-28T08:00:00.000Z", title: "Wallet connected", detail: "Public address checked; no transaction." }]
  };
  const parsed = parseWorkspace({ ...emptyWorkspace(), copyCenter });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.value.copyCenter, copyCenter);
  const backup = createBackup(parsed.value, new Date("2026-10-28T08:00:00Z"));
  const roundTrip = parseBackupText(JSON.stringify(backup));
  assert.equal(roundTrip.ok, true);
  if (roundTrip.ok) assert.deepEqual(roundTrip.value.copyCenter, copyCenter);
});

test("rejects invalid cloud Copy Center preferences as a whole", () => {
  const base = { ...emptyWorkspace(), copyCenter: { budget: "10", maxLoss: "2", activity: [] } };
  const bad = [
    { ...base, copyCenter: { ...base.copyCenter, budget: "-1" } },
    { ...base, copyCenter: { ...base.copyCenter, budget: "100001" } },
    { ...base, copyCenter: { ...base.copyCenter, maxLoss: "101" } },
    { ...base, copyCenter: { ...base.copyCenter, activity: [{ id: "", at: "not-a-date", title: "bad", detail: "" }] } },
    { ...base, copyCenter: { ...base.copyCenter, activity: Array.from({ length: 51 }, (_, i) => ({ id: String(i), at: "2026-10-28T08:00:00Z", title: "event", detail: "" })) } }
  ];
  for (const input of bad) assert.equal(parseWorkspace(input).ok, false);
});
