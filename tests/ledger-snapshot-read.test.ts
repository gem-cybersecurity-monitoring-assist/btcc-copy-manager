import assert from "node:assert/strict";
import test from "node:test";
import { CloudService } from "../lib/cloud-core.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const row = {
  id: "snap-1", connection_id: "conn-1", captured_at: "2026-11-07T09:00:00Z",
  recorded_at: "2026-11-07T09:01:00Z", source_kind: "official_api",
  equity_quote: "101.12", available_quote: "90.00", realized_pnl_quote: "1.20",
  unrealized_pnl_quote: "-0.25", quote_currency: "USDT", native_snapshot_id: null,
  secret_credentials: "NOT_TO_EXPOSE",
};

type Seen = { url: string; headers: Record<string,string>; method?: string };
function setup(opts: { user?: string; snapshots?: unknown; restStatus?: number; restCode?: string; errorOnFetch?: boolean } = {}) {
  const calls: Seen[] = [];
  const fetcher = async (url: string, init: RequestInit = {}) => {
    if (opts.errorOnFetch) throw Error("network outage containing secret");
    const headers = init.headers as Record<string,string>;
    calls.push({ url, headers, method: init.method });
    if (url.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: opts.user || owner }), { status: 200 });
    return new Response(JSON.stringify(opts.restStatus && opts.restStatus !== 200 ? { code: opts.restCode } : (opts.snapshots ?? [row])), { status: opts.restStatus ?? 200 });
  };
  return { service: new CloudService({ url: "https://isolated.supabase.co", key: "public-key" }, fetcher), calls };
}

test("signed-out snapshots fail before database calls", async () => {
  const { service, calls } = setup();
  const result = await service.getLedgerSnapshots({});
  assert.equal(result.status, 401);
  assert.equal(calls.length, 0);
});

test("uses verified owner JWT and owner filter, with no secret exposure", async () => {
  const { service, calls } = setup();
  const result = await service.getLedgerSnapshots({ access: "user-jwt" });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  const dbCall = calls[1];
  assert(dbCall.url.includes("gem_copy_account_snapshots"));
  const query = new URL(dbCall.url).searchParams;
  assert.equal(query.get("user_id"), "eq." + owner);
  assert.equal(query.get("limit"), "25");
  assert.equal(dbCall.headers.Authorization, "Bearer user-jwt");
  assert.equal(dbCall.headers.apikey, "public-key");
  assert.equal(result.body.source, "owner_scoped_ledger");
  assert(!JSON.stringify(result.body).includes("NOT_TO_EXPOSE"));
  assert(!JSON.stringify(result.body).includes("user-jwt"));
});

test("changing authenticated identity changes owner scope", async () => {
  const { service, calls } = setup({ user: other, snapshots: [] });
  const result = await service.getLedgerSnapshots({ access: "token" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.snapshots, []);
  assert.equal(new URL(calls[1].url).searchParams.get("user_id"), "eq." + other);
});

test("unapplied schema is not misreported as empty account data", async () => {
  const { service } = setup({ restStatus: 404, restCode: "PGRST205" });
  const result = await service.getLedgerSnapshots({ access: "token" });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, "ledger_not_ready");
  assert.equal(result.body.snapshots, undefined);
});

test("network failure fails closed, without upstream secret in error", async () => {
  const { service } = setup({ errorOnFetch: true });
  const result = await service.getLedgerSnapshots({ access: "token" });
  assert.equal(result.status, 503);
  assert(!JSON.stringify(result).includes("secret"));
});

test("invalid upstream rows are not displayed as verified balances", async () => {
  const { service } = setup({ snapshots: [{ ...row, equity_quote: "NaN" }] });
  const result = await service.getLedgerSnapshots({ access: "token" });
  assert.equal(result.status, 502);
  assert.equal(result.body.code, "ledger_invalid");
});
