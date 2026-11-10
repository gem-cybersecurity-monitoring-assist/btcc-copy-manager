import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { IMPORT_LABEL, parseBtccImport, parseCsv } from "../lib/btcc-csv.ts";
import { BTCC_READ_CALLS, btccStaticStatus, checkBtccProvider } from "../lib/btcc-read-adapter.ts";
import { clearBtccImport, importBtccCsv, readBtcc, type BtccDeps } from "../lib/btcc-connection.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const btccEnv = {
  BTCC_API_BASE_URL: "https://api.btcc.example", BTCC_API_KEY: "KEY_PLAINTEXT", BTCC_SECRET_KEY: "SECRET_PLAINTEXT",
  BTCC_USERNAME: "owner", BTCC_PASSWORD: "PASSWORD_PLAINTEXT",
};

function memoryStore() {
  const rows = new Map<string, any>();
  const ledger: any[] = [];
  return {
    rows, ledger,
    store: {
      async findConnection(userId: string, venue: string, ref?: string) {
        return [...rows.values()].find((r) => r.userId === userId && r.venue === venue && (ref === undefined || r.externalAccountRef === ref)) ?? null;
      },
      async insertConnection(userId: string, venue: string, patch: any) {
        const row = { id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001", userId, venue, updatedAt: "2026-11-10T00:00:00Z", ...patch };
        rows.set(row.id, row); return row;
      },
      async updateConnection(_u: string, id: string, patch: any) { Object.assign(rows.get(id), patch); return rows.get(id); },
      async recordSnapshot(_u: string, row: any) { ledger.push(row); },
    },
  };
}
const deps = (mem = memoryStore(), env: Record<string, string> = {}): BtccDeps => ({ store: mem.store as any, missing: [], env, now: () => new Date("2026-11-10T12:00:00Z") });

test("CSV parser handles quotes, escaped quotes, CRLF, BOM and semicolons", () => {
  assert.deepEqual(parseCsv('\uFEFFa,b\r\n"x, y","say ""hi"""\r\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  assert.deepEqual(parseCsv("a;b\n1;2\n\n"), [["a", "b"], ["1", "2"]]);
});

test("balances import maps common BTCC headers; unknown optional values stay null", () => {
  const result = parseBtccImport("balances", 'Asset,Total Balance,Available,Value (USDT)\nUSDT,"1,250.50",1200,1250.5\nBTC,0.01,,\n');
  assert.ok(result.ok);
  assert.deepEqual((result as any).rows[0], { coin: "USDT", total: 1250.5, available: 1200, locked: null, usdValue: 1250.5 });
  assert.equal((result as any).rows[1].usdValue, null);
});

test("positions and copy history imports normalise sides and dates", () => {
  const positions = parseBtccImport("positions", "Contract,Direction,Volume,Open Price,Leverage\nBTCUSDT,Buy,0.5,65000,10\n");
  assert.ok(positions.ok && (positions as any).rows[0].side === "long" && (positions as any).rows[0].size === 0.5);
  const history = parseBtccImport("copy_history", "Lead Trader,Symbol,Side,Open Time,Close Time,Realized PnL,Fee\nAlpha,ETHUSDT,Sell,2026-11-01 08:00:00,2026-11-02 09:30:00,-12.5,0.3\n");
  assert.ok(history.ok);
  assert.equal((history as any).rows[0].closedAt, "2026-11-02T09:30:00.000Z");
  assert.equal((history as any).rows[0].side, "short");
  assert.equal((history as any).rows[0].realizedPnl, -12.5);
});

test("strict rejection: unrecognised headers, invalid values, wrong kind, oversize", () => {
  const headers = parseBtccImport("balances", "Name,Amount Due\nx,1\n");
  assert.equal(headers.ok, false);
  assert.match((headers as any).details[0], /Missing: coin/);
  const bad = parseBtccImport("positions", "Symbol,Side,Size\nBTCUSDT,long,abc\nETHUSDT,short,0\n");
  assert.equal(bad.ok, false);
  assert.equal((bad as any).details.length, 2);
  assert.equal(parseBtccImport("orders", "a\n1").ok, false);
  assert.equal(parseBtccImport("balances", "coin,total\n" + "x".repeat(600 * 1024)).ok, false);
  assert.equal(parseBtccImport("copy_history", "Symbol,PnL\nBTCUSDT,1\n").ok, false, "a time column is required");
});

test("formula-looking text is neutralised", () => {
  const result = parseBtccImport("copy_history", 'Trader,Symbol,PnL,Close Time\n"=HYPERLINK(""x"")",BTCUSDT,1,2026-11-01\n');
  assert.ok(result.ok);
  assert.ok(!String((result as any).rows[0].trader).startsWith("="));
});

test("adapter reports provider unavailable with the suspension reason, never demo data", async () => {
  const status = btccStaticStatus({});
  assert.equal(status.status, "provider_unavailable");
  assert.match((status as any).reason, /13 February 2026/);
  assert.deepEqual((status as any).missing, ["BTCC_API_BASE_URL", "BTCC_API_KEY", "BTCC_SECRET_KEY", "BTCC_USERNAME", "BTCC_PASSWORD"]);
  let calls = 0;
  const unconfigured = await checkBtccProvider({}, async () => { calls++; return Response.json({}); });
  assert.equal(unconfigured.status, "provider_unavailable");
  assert.equal(calls, 0, "no network call without server credentials");
});

test("configured adapter uses only login + position list and reports rejection as unavailable", async () => {
  const seen: Array<{ method: string; path: string; body: string }> = [];
  const rejected = await checkBtccProvider(btccEnv, async (url, init = {}) => {
    seen.push({ method: String(init.method), path: new URL(url).pathname, body: String(init.body ?? "") });
    return Response.json({ code: 10001, msg: "API service suspended" });
  });
  assert.equal(rejected.status, "provider_unavailable");
  assert.equal((rejected as any).code, "provider_rejected");
  assert.match((rejected as any).reason, /API service suspended/);
  assert.ok(!JSON.stringify(rejected).includes("PLAINTEXT"));
  assert.deepEqual(seen.map((c) => c.method + " " + c.path), ["POST /v1/user/login"]);

  const ok = await checkBtccProvider(btccEnv, async (url) => {
    const path = new URL(url).pathname;
    seen.push({ method: "", path, body: "" });
    return path === "/v1/user/login"
      ? Response.json({ code: 0, token: "t", account: { id: 7 } })
      : Response.json({ code: 0, positions: [{ symbol: "BTCUSDT", direction: 1, volume: "0.2", open_price: "65000", multiple: 5 }] });
  });
  assert.equal(ok.status, "available");
  assert.equal((ok as any).positions[0].side, "long");
  assert.equal((ok as any).balances, null, "balances are not invented");
  for (const call of seen) assert.ok(BTCC_READ_CALLS.some((c) => c.path === call.path));
  assert.equal(btccStaticStatus({ ...btccEnv, BTCC_API_BASE_URL: "http://insecure.example" }).status, "provider_unavailable");
});

test("import stores labelled owner data and records a manual (not official) observation", async () => {
  const mem = memoryStore();
  const result = await importBtccCsv(deps(mem), owner, { kind: "balances", fileName: "../../etc/BTCC balances<script>.csv", csv: "Coin,Total,USD Value\nUSDT,100,100\nBTC,0.001,65\n" });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const section = (result.body.imports as any).sections.balances;
  assert.equal(section.label, IMPORT_LABEL);
  assert.equal(section.source, "owner_csv_import");
  assert.equal(section.fileName, "BTCC balancesscript.csv");
  const [row] = [...mem.rows.values()];
  assert.equal(row.status, "DISCONNECTED", "an import is not a live connection");
  assert.equal(row.externalAccountRef, "owner-csv-import");
  assert.equal(mem.ledger.length, 1);
  assert.equal(mem.ledger[0].sourceKind, "manual_attestation");
  assert.equal(mem.ledger[0].equityQuote, "165");
});

test("partial USD values do not create a balance observation", async () => {
  const mem = memoryStore();
  await importBtccCsv(deps(mem), owner, { kind: "balances", csv: "Coin,Total,USD Value\nUSDT,100,100\nBTC,0.001,\n" });
  assert.equal(mem.ledger.length, 0);
});

test("sections are independent; removing one keeps the others; invalid CSV changes nothing", async () => {
  const mem = memoryStore();
  await importBtccCsv(deps(mem), owner, { kind: "positions", csv: "Symbol,Side,Size\nBTCUSDT,long,1\n" });
  await importBtccCsv(deps(mem), owner, { kind: "copy_history", csv: "Symbol,PnL,Close Time\nBTCUSDT,5,2026-11-01\n" });
  const before = JSON.stringify([...mem.rows.values()][0].lastSnapshot);
  const invalid = await importBtccCsv(deps(mem), owner, { kind: "positions", csv: "Symbol,Side,Size\nBTCUSDT,long,x\n" });
  assert.equal(invalid.status, 422);
  assert.equal(JSON.stringify([...mem.rows.values()][0].lastSnapshot), before);
  const cleared = await clearBtccImport(deps(mem), owner, "positions");
  assert.deepEqual(Object.keys((cleared.body.imports as any).sections), ["copy_history"]);
  const read = await readBtcc(deps(mem), owner);
  assert.equal((read.body.adapter as any).status, "provider_unavailable");
  assert.ok((read.body.imports as any).sections.copy_history);
  assert.equal((await readBtcc(deps(mem), "22222222-2222-4222-8222-222222222222")).body.imports, null);
});

test("without server storage, status still reads and imports are refused honestly", async () => {
  const noStore: BtccDeps = { store: null, missing: ["SUPABASE_SERVICE_ROLE_KEY"], env: {} };
  const read = await readBtcc(noStore, owner);
  assert.equal(read.status, 200);
  assert.equal(read.body.imports, null);
  const imported = await importBtccCsv(noStore, owner, { kind: "positions", csv: "Symbol,Side,Size\nBTCUSDT,long,1\n" });
  assert.equal(imported.status, 503);
});

test("BTCC routes and adapter contain no order, transfer or withdrawal calls", () => {
  const root = join(process.cwd(), "src/app/api/connections/btcc");
  const files: string[] = [];
  const walk = (dir: string) => { for (const e of readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(join(dir, e.name)) : files.push(join(dir, e.name)); };
  walk(root);
  const source = files.map((f) => readFileSync(f, "utf8")).join("\n") + readFileSync(join(process.cwd(), "lib/btcc-read-adapter.ts"), "utf8") + readFileSync(join(process.cwd(), "lib/btcc-connection.ts"), "utf8");
  assert.doesNotMatch(source, /["'`]\/v\d\/[^"'`]*(openposition|closeposition|cancel|order|withdraw|transfer|deposit)/i);
  assert.doesNotMatch(source, /executeLiveOrder|openPosition\(|prepareLiveOrder/);
  assert.deepEqual(BTCC_READ_CALLS.map((c) => c.method + " " + c.path), ["POST /v1/user/login", "GET /v1/account/positionlist"]);
  const panel = readFileSync(join(process.cwd(), "src/components/btcc-account-panel.tsx"), "utf8");
  assert.doesNotMatch(panel, /localStorage|sessionStorage|indexedDB/);
});
