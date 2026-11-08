import assert from "node:assert/strict";
import test from "node:test";
import { CloudService } from "../lib/cloud-core.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const connection = {
  id, venue: "bitget", connection_status: "READ_ONLY",
  last_verified_at: "2026-11-07T04:00:00Z", updated_at: "2026-11-08T04:00:00Z",
  credential_vault_ref: "vault:44444444-4444-4444-8444-444444444444",
  external_account_ref: "SECRET_TO_REDACT",
};
function setup(opts: { user?: string; rows?: unknown; dbStatus?: number; dbCode?: string; outage?: boolean } = {}) {
  const calls: Array<{url:string;headers:Record<string,string>}> = [];
  const api = async (url: string, init: RequestInit = {}) => {
    if (opts.outage) throw Error("upstream secret must not leak");
    calls.push({url,headers:init.headers as Record<string,string>});
    if (url.endsWith("/auth/v1/user")) return Response.json({id:opts.user??owner});
    return Response.json(opts.dbStatus && opts.dbStatus!==200 ? {code:opts.dbCode} : (opts.rows??[connection]), {status:opts.dbStatus??200});
  };
  return { service:new CloudService({url:"https://isolated.supabase.co",key:"public"},api),calls };
}
test("signed-out connection read rejects without upstream access",async()=>{
  const {service,calls}=setup();assert.equal((await service.getLedgerConnections({},owner)).status,401);assert.equal(calls.length,0);
});
test("ordinary account rejected before any ledger query",async()=>{
  const {service,calls}=setup({user:other});const r=await service.getLedgerConnections({access:"test-jwt"},owner);
  assert.equal(r.status,403);assert.equal(r.body.code,"owner_required");assert.equal(calls.length,1);
});
test("owner config missing fails closed",async()=>{
  const {service,calls}=setup();const r=await service.getLedgerConnections({access:"test-jwt"},undefined);
  assert.equal(r.status,503);assert.equal(calls.length,1);
});
test("JWT, explicit fields, owner RLS filter, and redacted response",async()=>{
  const {service,calls}=setup();const r=await service.getLedgerConnections({access:"test-jwt"},owner);
  assert.equal(r.status,200);assert.equal(calls.length,2);
  const q=new URL(calls[1].url).searchParams;assert.equal(q.get("user_id"),"eq."+owner);
  assert.equal(q.get("limit"),"25");
  assert.equal(q.get("select"),"id,venue,connection_status,last_verified_at,updated_at");
  assert.equal(calls[1].headers.Authorization,"Bearer test-jwt");
  assert.equal(r.body.source,"owner_scoped_ledger");
  assert.equal((r.body.connections as unknown[]).length,1);
  assert(!JSON.stringify(r.body).includes("SECRET_TO_REDACT"));
  assert(!JSON.stringify(r.body).includes("vault:"));
  assert(!JSON.stringify(r.body).includes("test-jwt"));
});
test("empty ledger is truly empty, not a fabricated connection",async()=>{
  const {service}=setup({rows:[]});const r=await service.getLedgerConnections({access:"test-jwt"},owner);
  assert.equal(r.status,200);assert.deepEqual(r.body.connections,[]);
});
test("missing schema and upstream failures are unavailable, never empty",async()=>{
  const {service}=setup({dbStatus:404,dbCode:"PGRST205"});
  const r=await service.getLedgerConnections({access:"test-jwt"},owner);
  assert.equal(r.status,503);assert.equal(r.body.code,"ledger_not_ready");
  const q=await setup({outage:true}).service.getLedgerConnections({access:"test-jwt"},owner);
  assert.equal(q.status,503);assert(!JSON.stringify(q).includes("secret"));
});
test("untrusted status and dates fail closed",async()=>{
  for(const bad of [{...connection,connection_status:"EXECUTE"},{...connection,id:"invalid"},{...connection,last_verified_at:"tomorrow"}]){
    const r=await setup({rows:[bad]}).service.getLedgerConnections({access:"test-jwt"},owner);
    assert.equal(r.status,502);assert.equal(r.body.code,"ledger_invalid");
  }
});

