import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readKeyring } from "../lib/connection-secrets.ts";
import { mt5BridgeFromEnv, parseMt5Credentials, readMt5Snapshot, unconfiguredBridge, type Mt5Bridge } from "../lib/mt5-adapter.ts";
import { disconnectMt5, mt5DepsFromEnv, readMt5, refreshMt5, saveMt5, type Mt5Deps } from "../lib/mt5-connection.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const input = { login: "10000001", server: "Example-MT5-LIVE1", investorPassword: "INVESTOR_PLAINTEXT" };
const keyring = readKeyring({ CONNECTION_SECRETS_KEY: randomBytes(32).toString("base64") }).keyring!;

function memoryStore() {
  const rows = new Map<string, any>();
  const secrets = new Map<string, any>();
  const writes: string[] = [];
  return {
    rows, secrets, writes,
    store: {
      async findConnection(userId: string, venue: string) { return [...rows.values()].find((r) => r.userId === userId && r.venue === venue) ?? null; },
      async insertConnection(userId: string, venue: string, patch: any) {
        const row = { id: "cccccccc-cccc-4ccc-8ccc-000000000001", userId, venue, updatedAt: "2026-11-10T00:00:00Z", lastSnapshot: null, lastVerifiedAt: null, lastErrorCode: null, ...patch };
        rows.set(row.id, row); writes.push(JSON.stringify(patch)); return row;
      },
      async updateConnection(_u: string, id: string, patch: any) { Object.assign(rows.get(id), patch); writes.push(JSON.stringify(patch)); return rows.get(id); },
      async putSecret(userId: string, id: string, venue: string, sealed: string) { secrets.set(id, { userId, venue, sealedSecret: sealed }); writes.push(sealed); },
      async getSecret(userId: string, id: string) { const s = secrets.get(id); return s && s.userId === userId ? s : null; },
      async deleteSecret(_u: string, id: string) { secrets.delete(id); },
    },
  };
}

function fakeBridge(tradeAllowed: boolean, calls: string[] = []): Mt5Bridge {
  return {
    name: "test-bridge", configured: true,
    async readAccount(c) { calls.push("account:" + c.login); return { login: c.login, server: c.server, currency: "USD", leverage: 100, balance: 1000, equity: 1012.5, margin: 20, freeMargin: 992.5, profit: 12.5, tradeAllowed }; },
    async readPositions() { calls.push("positions"); return [{ ticket: "1", symbol: "XAUUSD", side: "buy", volume: 0.01, openPrice: 2400, currentPrice: 2410, profit: 10, openedAt: null }]; },
    async readHistory() { calls.push("history"); return []; },
  };
}
const deps = (mem = memoryStore(), bridge: Mt5Bridge = unconfiguredBridge): Mt5Deps => ({ store: mem.store as any, keyring, missing: [], bridge, now: () => new Date("2026-11-10T12:00:00Z") });

test("credentials are strictly validated", () => {
  assert.ok(parseMt5Credentials(input));
  for (const bad of [{ ...input, login: "12ab" }, { ...input, login: "123" }, { ...input, server: "bad server!" }, { ...input, investorPassword: "" }, { ...input, investorPassword: "x".repeat(129) }, null])
    assert.equal(parseMt5Credentials(bad), null);
});

test("no bridge is chosen: the default refuses every read and nothing is simulated", async () => {
  assert.equal(mt5BridgeFromEnv({ MT5_BRIDGE: "anything" }).configured, false);
  await assert.rejects(readMt5Snapshot(unconfiguredBridge, parseMt5Credentials(input)!), /No MT5 bridge is configured/);
});

test("save encrypts the investor password, stays not connected, and never returns it", async () => {
  const mem = memoryStore();
  const result = await saveMt5(deps(mem), owner, input);
  assert.equal(result.status, 200);
  const connection = result.body.connection as any;
  assert.equal(connection.status, "PAUSED");
  assert.equal(connection.lastErrorCode, "bridge_not_configured");
  assert.equal(connection.snapshot, null);
  assert.deepEqual(connection.account, { login: "10000001", server: "Example-MT5-LIVE1" });
  assert.equal(connection.credentialsSaved, true);
  assert.match([...mem.secrets.values()][0].sealedSecret, /^gcs1\./);
  const everything = JSON.stringify(result.body) + mem.writes.join("") + JSON.stringify(await readMt5(deps(mem), owner));
  assert.ok(!everything.includes("INVESTOR_PLAINTEXT"));
});

test("refresh without a bridge returns bridge_not_configured and no figures", async () => {
  const mem = memoryStore();
  await saveMt5(deps(mem), owner, input);
  const result = await refreshMt5(deps(mem), owner);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "bridge_not_configured");
  assert.equal([...mem.rows.values()][0].lastSnapshot, null);
});

test("with a bridge that reports investor access, balances and positions are read", async () => {
  const mem = memoryStore();
  const calls: string[] = [];
  await saveMt5(deps(mem), owner, input);
  const result = await refreshMt5(deps(mem, fakeBridge(false, calls)), owner);
  assert.equal(result.status, 200);
  const snapshot = (result.body.connection as any).snapshot;
  assert.equal(snapshot.account.equity, 1012.5);
  assert.equal("tradeAllowed" in snapshot.account, false);
  assert.equal(snapshot.positions[0].symbol, "XAUUSD");
  assert.equal((result.body.connection as any).status, "READ_ONLY");
  assert.deepEqual(calls, ["account:10000001", "positions", "history"]);
});

test("a login that can trade (master password) is refused and its password deleted", async () => {
  const mem = memoryStore();
  await saveMt5(deps(mem), owner, input);
  const calls: string[] = [];
  const result = await refreshMt5(deps(mem, fakeBridge(true, calls)), owner);
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "not_investor_login");
  assert.equal(mem.secrets.size, 0);
  assert.deepEqual(calls, ["account:10000001"], "nothing else is read");
  assert.equal([...mem.rows.values()][0].status, "ERROR");
});

test("disconnect deletes the investor password", async () => {
  const mem = memoryStore();
  await saveMt5(deps(mem), owner, input);
  const result = await disconnectMt5(deps(mem), owner);
  assert.equal((result.body.connection as any).status, "DISCONNECTED");
  assert.equal(mem.secrets.size, 0);
  assert.equal((await refreshMt5(deps(mem), owner)).status, 404);
});

test("without server storage nothing is saved and env names are reported", async () => {
  const d = mt5DepsFromEnv({});
  const result = await saveMt5(d, owner, input);
  assert.equal(result.status, 503);
  assert.ok((result.body.missing as string[]).includes("CONNECTION_SECRETS_KEY"));
});

test("MT5 code has no trading methods, keeps the login out of the repo, and no browser storage", () => {
  const files = ["lib/mt5-adapter.ts", "lib/mt5-connection.ts", "src/components/mt5-connection-panel.tsx"];
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const source = [...files.map((f) => join(process.cwd(), f)), ...walk(join(process.cwd(), "src/app/api/connections/mt5"))].map((f) => readFileSync(f, "utf8")).join("\n");
  assert.doesNotMatch(source, /\b(orderSend|order_send|placeOrder|closePosition|sendOrder|withdraw\(|deposit\()/i);
  // No account login is hard-coded: the owner enters it in the UI.
  assert.doesNotMatch(source, /useState\("\d{4,}"\)|login:\s*"\d{4,}"/);
  assert.doesNotMatch(readFileSync(join(process.cwd(), "src/components/mt5-connection-panel.tsx"), "utf8"), /localStorage|sessionStorage|indexedDB/);
});
