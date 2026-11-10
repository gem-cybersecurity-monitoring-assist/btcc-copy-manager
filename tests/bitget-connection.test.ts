import assert from "node:assert/strict";
import test from "node:test";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  BITGET_READ_PATHS,
  bitgetGet,
  bitgetSignature,
  readBitgetSnapshot,
} from "../lib/bitget-read-client.ts";
import {
  connectBitget,
  disconnectBitget,
  readBitgetConnection,
  refreshBitgetConnection,
  bitgetConnectionDepsFromEnv,
  type BitgetConnectionDeps,
} from "../lib/bitget-connection.ts";
import { ConnectionStore } from "../lib/connection-store.ts";
import { readKeyring } from "../lib/connection-secrets.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const creds = { apiKey: "bg_KEY_PLAINTEXT", secret: "SECRET_PLAINTEXT", passphrase: "PHRASE_PLAINTEXT" };
const keyring = readKeyring({ CONNECTION_SECRETS_KEY: randomBytes(32).toString("base64") }).keyring!;

type BitgetCall = { url: string; method: string; headers: Record<string, string> };
function fakeBitget(opts: { permType?: string; permissions?: string[]; positionsCode?: string; down?: boolean } = {}) {
  const calls: BitgetCall[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: String(init.method), headers: init.headers as Record<string, string> });
    if (opts.down) throw Error("socket hang up SECRET_PLAINTEXT");
    const path = new URL(url).pathname;
    if (path === "/api/v3/account/info")
      return Response.json({ code: "00000", data: { userId: "987654", permType: opts.permType ?? "readonly", permissions: opts.permissions ?? ["uta_mgt"] } });
    if (path === "/api/v3/account/assets")
      return Response.json({ code: "00000", data: { accountEquity: "1520.55", usdtEquity: "1500.10", btcEquity: "", unrealisedPnl: "-3.2",
        assets: [{ coin: "USDT", equity: "1500.10", available: "1400", locked: "100", usdValue: "1500.10" }, { coin: "DUST", equity: "0", available: "0", locked: "0", usdValue: "0" }] } });
    if (path === "/api/v3/position/current-position") {
      if (opts.positionsCode) return Response.json({ code: opts.positionsCode, msg: "permission denied" }, { status: 400 });
      const category = new URL(url).searchParams.get("category");
      return Response.json({ code: "00000", data: { list: category === "USDT-FUTURES"
        ? [{ symbol: "BTCUSDT", posSide: "long", marginCoin: "USDT", total: "0.01", avgPrice: "65000", markPrice: "65500", leverage: "3", unrealisedPnl: "5", marginMode: "crossed" },
           { symbol: "ETHUSDT", posSide: "short", marginCoin: "USDT", total: "0" }]
        : [] } });
    }
    return Response.json({ code: "40404" }, { status: 404 });
  };
  return { calls, fetchImpl };
}

/** In-memory stand-in for the service-role PostgREST store, recording all writes. */
function memoryStore() {
  const rows = new Map<string, any>();
  const secrets = new Map<string, any>();
  const ledger: any[] = [];
  const writes: string[] = [];
  let n = 0;
  const store = {
    async findConnection(userId: string, venue: string) {
      return [...rows.values()].find((r) => r.userId === userId && r.venue === venue) ?? null;
    },
    async insertConnection(userId: string, venue: string, patch: any) {
      const id = `aaaaaaaa-aaaa-4aaa-8aaa-${String(++n).padStart(12, "0")}`;
      const row = { id, userId, venue, status: "DISCONNECTED", externalAccountRef: null, lastVerifiedAt: null, lastSnapshot: null, lastErrorCode: null, updatedAt: new Date().toISOString(), ...patch };
      rows.set(id, row); writes.push(JSON.stringify(patch)); return row;
    },
    async updateConnection(userId: string, id: string, patch: any) {
      const row = rows.get(id); assert.equal(row.userId, userId);
      Object.assign(row, patch); writes.push(JSON.stringify(patch)); return row;
    },
    async putSecret(userId: string, connectionId: string, venue: string, sealedSecret: string, keyVersion: number) {
      secrets.set(connectionId, { userId, venue, sealedSecret, keyVersion }); writes.push(sealedSecret);
    },
    async getSecret(userId: string, connectionId: string) {
      const s = secrets.get(connectionId); return s && s.userId === userId ? s : null;
    },
    async deleteSecret(_userId: string, connectionId: string) { secrets.delete(connectionId); },
    async recordSnapshot(_userId: string, row: any) { ledger.push(row); },
  };
  return { store, rows, secrets, ledger, writes };
}

function deps(bitget: ReturnType<typeof fakeBitget>, mem = memoryStore()): { deps: BitgetConnectionDeps; mem: ReturnType<typeof memoryStore> } {
  return { deps: { store: mem.store as any, keyring, missing: [], bitgetFetch: bitget.fetchImpl, now: () => new Date("2026-11-10T12:00:00Z") }, mem };
}

test("signature matches Bitget's timestamp+method+path?query HMAC-SHA256/base64", async () => {
  const expected = createHmac("sha256", "s").update("1700000000000GET/api/v3/position/current-position?category=USDT-FUTURES").digest("base64");
  assert.equal(bitgetSignature("s", "1700000000000", "GET", "/api/v3/position/current-position?category=USDT-FUTURES"), expected);
  const bitget = fakeBitget();
  await bitgetGet(creds, "/api/v3/position/current-position", { category: "USDT-FUTURES" }, bitget.fetchImpl, () => 1700000000000);
  assert.equal(bitget.calls[0].headers["ACCESS-SIGN"], bitgetSignature(creds.secret, "1700000000000", "GET", "/api/v3/position/current-position?category=USDT-FUTURES"));
});

test("client refuses any path outside the read-only allowlist", async () => {
  const bitget = fakeBitget();
  for (const path of ["/api/v3/trade/place-order", "/api/v3/copy/futures/follower-settings", "/api/v2/spot/wallet/withdrawal", "/api/v3/account/transfer"])
    await assert.rejects(bitgetGet(creds, path as any, {}, bitget.fetchImpl), /allowlist/);
  assert.equal(bitget.calls.length, 0);
  assert.deepEqual([...BITGET_READ_PATHS], ["/api/v3/account/info", "/api/v3/account/assets", "/api/v3/position/current-position"]);
});

test("snapshot: balances parsed, empty strings stay unknown, zero rows dropped", async () => {
  const bitget = fakeBitget();
  const { snapshot } = await readBitgetSnapshot(creds, bitget.fetchImpl);
  assert.equal(snapshot!.balances.accountEquityUsd, 1520.55);
  assert.equal(snapshot!.balances.btcEquity, null);
  assert.deepEqual(snapshot!.balances.coins.map((c) => c.coin), ["USDT"]);
  assert.equal(snapshot!.positions.status, "complete");
  assert.deepEqual(snapshot!.positions.rows.map((p) => p.symbol), ["BTCUSDT"]);
  assert(bitget.calls.every((c) => c.method === "GET" && c.url.startsWith("https://api.bitget.com/")));
});

test("positions refused for a uta_mgt-only key are unavailable, never zero", async () => {
  const { snapshot } = await readBitgetSnapshot(creds, fakeBitget({ positionsCode: "40014" }).fetchImpl);
  assert.equal(snapshot!.positions.status, "unavailable");
  assert.deepEqual(snapshot!.positions.rows, []);
  assert.match(snapshot!.positions.reason!, /40014/);
  assert.equal(snapshot!.balances.accountEquityUsd, 1520.55);
});

test("connect stores only an encrypted credential and returns no secret material", async () => {
  const { deps: d, mem } = deps(fakeBitget());
  const result = await connectBitget(d, owner, creds);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.credentialsStored, "encrypted_server_side");
  assert.equal(mem.secrets.size, 1);
  const [stored] = [...mem.secrets.values()];
  assert.match(stored.sealedSecret, /^gcs1\./);
  const everything = JSON.stringify(result.body) + mem.writes.join("") + JSON.stringify(mem.ledger);
  for (const plain of Object.values(creds)) assert(!everything.includes(plain), "plaintext leaked: " + plain);
  assert.equal((result.body.connection as any).status, "READ_ONLY");
  assert.equal(mem.ledger.length, 1);
  assert.equal(mem.ledger[0].sourceKind, "official_api");
  assert.equal(mem.ledger[0].quoteCurrency, "USD");
});

test("connect rejects read-write or trade-scoped keys before storing anything", async () => {
  for (const opts of [{ permType: "read-and-write" }, { permissions: ["uta_mgt", "uta_trade"] }, { permissions: ["uta_mgt", "withdraw"] }]) {
    const { deps: d, mem } = deps(fakeBitget(opts));
    const result = await connectBitget(d, owner, creds);
    assert.equal(result.status, 403);
    assert.equal(result.body.code, "not_read_only");
    assert.equal(mem.secrets.size, 0);
    assert.equal(mem.rows.size, 0);
  }
});

test("missing storage configuration fails before contacting Bitget and names env vars only", async () => {
  const bitget = fakeBitget();
  const d = bitgetConnectionDepsFromEnv({ SUPABASE_URL: "https://x.supabase.co" });
  d.bitgetFetch = bitget.fetchImpl;
  const result = await connectBitget(d, owner, creds);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body.missing, ["SUPABASE_SERVICE_ROLE_KEY", "CONNECTION_SECRETS_KEY"]);
  assert.equal(bitget.calls.length, 0);
});

test("status read never calls Bitget and never returns credentials", async () => {
  const bitget = fakeBitget();
  const { deps: d } = deps(bitget);
  await connectBitget(d, owner, creds);
  const callsAfterConnect = bitget.calls.length;
  const status = await readBitgetConnection(d, owner);
  assert.equal(status.status, 200);
  assert.equal(bitget.calls.length, callsAfterConnect);
  const text = JSON.stringify(status.body);
  assert(!text.includes("gcs1.") && !Object.values(creds).some((p) => text.includes(p)));
  assert.equal((status.body.connection as any).snapshot.balances.accountEquityUsd, 1520.55);
  assert.equal((await readBitgetConnection(d, "22222222-2222-4222-8222-222222222222")).body.connection, null);
});

test("refresh decrypts, re-checks read-only permissions, and only issues allowlisted GETs", async () => {
  const bitget = fakeBitget();
  const { deps: d } = deps(bitget);
  await connectBitget(d, owner, creds);
  bitget.calls.length = 0;
  const result = await refreshBitgetConnection(d, owner);
  assert.equal(result.status, 200);
  assert.equal(new URL(bitget.calls[0].url).pathname, "/api/v3/account/info", "permission check first");
  for (const call of bitget.calls) {
    assert.equal(call.method, "GET");
    assert((BITGET_READ_PATHS as readonly string[]).includes(new URL(call.url).pathname));
    assert.equal(call.headers["ACCESS-KEY"], creds.apiKey, "decrypted key used");
  }
});

test("refresh stops using a key that is no longer read-only and deletes it", async () => {
  const mem = memoryStore();
  await connectBitget(deps(fakeBitget(), mem).deps, owner, creds);
  const result = await refreshBitgetConnection(deps(fakeBitget({ permissions: ["uta_mgt", "uta_trade"] }), mem).deps, owner);
  assert.equal(result.status, 403);
  assert.equal(mem.secrets.size, 0);
  assert.equal([...mem.rows.values()][0].status, "ERROR");
  assert.equal([...mem.rows.values()][0].lastErrorCode, "not_read_only");
});

test("refresh with a different server key fails closed without leaking", async () => {
  const mem = memoryStore();
  await connectBitget(deps(fakeBitget(), mem).deps, owner, creds);
  const other = { ...deps(fakeBitget(), mem).deps, keyring: readKeyring({ CONNECTION_SECRETS_KEY: randomBytes(32).toString("base64") }).keyring };
  const result = await refreshBitgetConnection(other, owner);
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "credentials_unreadable");
});

test("provider outage is reported without echoing credentials", async () => {
  const { deps: d } = deps(fakeBitget({ down: true }));
  const result = await connectBitget(d, owner, creds);
  assert.equal(result.status, 502);
  assert(!JSON.stringify(result.body).includes("PLAINTEXT"));
});

test("disconnect deletes the sealed credential and keeps history", async () => {
  const mem = memoryStore();
  const { deps: d } = deps(fakeBitget(), mem);
  await connectBitget(d, owner, creds);
  const result = await disconnectBitget(d, owner);
  assert.equal(result.status, 200);
  assert.equal(mem.secrets.size, 0);
  assert.equal((result.body.connection as any).status, "DISCONNECTED");
  assert.equal(mem.ledger.length, 1);
  assert.equal((await refreshBitgetConnection(d, owner)).status, 404);
});

test("service-role store filters every query by owner and never sends plaintext", async () => {
  const requests: Array<{ url: string; method: string; body: string; headers: Record<string, string> }> = [];
  const store = new ConnectionStore({ url: "https://isolated.supabase.co", serviceKey: "sb_secret_TEST" }, async (url, init = {}) => {
    requests.push({ url, method: String(init.method ?? "GET"), body: String(init.body ?? ""), headers: init.headers as Record<string, string> });
    return Response.json([]);
  });
  assert.equal(await store.findConnection(owner, "bitget"), null);
  await assert.rejects(store.putSecret(owner, "33333333-3333-4333-8333-333333333333", "bitget", "plaintext-secret", 1), /sealed/);
  await assert.rejects(store.findConnection("not-a-uuid", "bitget"), /Invalid owner/);
  const url = new URL(requests[0].url);
  assert.equal(url.searchParams.get("user_id"), "eq." + owner);
  assert.equal(requests[0].headers.apikey, "sb_secret_TEST");
  assert.equal(requests[0].headers.Authorization, undefined, "opaque secret keys are not sent as a bearer JWT");
  assert.equal(requests.length, 1);
});

test("connection routes expose no trading, transfer or withdrawal handlers", () => {
  const root = join(process.cwd(), "src/app/api/connections");
  const files: string[] = [];
  const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) entry.isDirectory() ? walk(join(dir, entry.name)) : files.push(join(dir, entry.name)); };
  walk(root);
  const source = files.map((file) => readFileSync(file, "utf8")).join("\n") + readFileSync(join(process.cwd(), "lib/bitget-read-client.ts"), "utf8");
  assert.doesNotMatch(source, /place-order|withdraw(al)?["'/]|\/transfer|follower-settings|unfollow|close-all|method:\s*"(POST|PUT|DELETE)"/);
  assert.doesNotMatch(source, /api\.bitget\.com\/api\/v[0-9]\/(trade|copy|spot\/wallet)/);
});

test("browser code never persists Bitget credentials to storage or the cloud workspace", () => {
  const workspace = readFileSync(join(process.cwd(), "src/components/copy-center-workspace.tsx"), "utf8");
  const panel = readFileSync(join(process.cwd(), "src/components/bitget-connection-panel.tsx"), "utf8");
  assert.doesNotMatch(panel, /localStorage|sessionStorage|indexedDB/);
  for (const match of workspace.matchAll(/(?:localStorage|sessionStorage)\.setItem\(([\s\S]*?)\);/g))
    assert.doesNotMatch(match[1], /bgKey|bgSecret|bgPhrase|apiKey|secret|passphrase/i, "credential in browser storage");
  const cloudSave = workspace.slice(workspace.indexOf("copyCenter: {"), workspace.indexOf("copyCenter: {") + 300);
  assert.doesNotMatch(cloudSave, /bgKey|bgSecret|bgPhrase|apiKey|passphrase/);
  // Inputs are cleared after every save/verify attempt.
  assert.ok((workspace.match(/setBgSecret\(""\)/g) ?? []).length >= 2);
});

test("live refresh: history gets at most one point per 15 minutes", async () => {
  const { ledgerDue, LEDGER_INTERVAL_MS } = await import("../lib/bitget-connection.ts");
  assert.equal(ledgerDue(null, "2026-11-10T12:00:00Z"), true);
  assert.equal(ledgerDue({ ledgerRecordedAt: "2026-11-10T12:00:00Z" }, "2026-11-10T12:05:00Z"), false);
  assert.equal(ledgerDue({ ledgerRecordedAt: "2026-11-10T12:00:00Z" }, new Date(Date.parse("2026-11-10T12:00:00Z") + LEDGER_INTERVAL_MS).toISOString()), true);

  const mem = memoryStore();
  let clock = Date.parse("2026-11-10T12:00:00Z");
  const d = { ...deps(fakeBitget(), mem).deps, now: () => new Date(clock) };
  await connectBitget(d, owner, creds);           // ledger point 1
  clock += 60_000; await refreshBitgetConnection(d, owner);  // 1 min later: skipped
  clock += 60_000; await refreshBitgetConnection(d, owner);  // 2 min: skipped
  clock += 15 * 60_000; await refreshBitgetConnection(d, owner); // 17 min: point 2
  assert.equal(mem.ledger.length, 2);
  assert.equal([...mem.rows.values()][0].lastVerifiedAt, new Date(clock).toISOString(), "balances still refresh every time");
});

test("panels refresh live only while visible", () => {
  const hook = readFileSync(join(process.cwd(), "src/components/use-live-refresh.ts"), "utf8");
  assert.match(hook, /document\.visibilityState === "visible"/);
  assert.match(readFileSync(join(process.cwd(), "src/components/bitget-connection-panel.tsx"), "utf8"), /useLiveRefresh\(\(\) => act\("refresh", true\), 60_000/);
  assert.match(readFileSync(join(process.cwd(), "src/components/market-overview.tsx"), "utf8"), /useLiveRefresh\(\(\) => refresh\(true\), 60_000\)/);
});

test("real mode: no simulated data can enter allocations", () => {
  const engine = readFileSync(join(process.cwd(), "src/app/copy-trading/engine/IntelligenceEngine.tsx"), "utf8");
  assert.match(engine, /Removed leftover simulated strategies/);
  assert.doesNotMatch(engine, /Simulation lab/);
  const allocation = readFileSync(join(process.cwd(), "src/app/copy-trading/engine/AnalysisTabs.tsx"), "utf8");
  assert.match(allocation, /const includeSim = false;/);
  assert.doesNotMatch(allocation, /Include simulated data/);
});
