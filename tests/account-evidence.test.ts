import assert from "node:assert/strict";
import test from "node:test";
import { parseAccountEvidence, evidenceFreshness, evidenceAmount } from "../lib/account-evidence.ts";
const row = { id:"1", connectionId:"account",capturedAt:"2026-11-08T01:00:00Z",recordedAt:"2026-11-08T01:00:01Z",sourceKind:"official_api",quoteCurrency:"USDT",equityQuote:"99999999999999999999.12345678",availableQuote:null,realizedPnlQuote:null,unrealizedPnlQuote:"-1.12345678" };
const body = (snapshots: unknown[]) => ({ok:true,source:"owner_scoped_ledger",snapshots});
test("account evidence preserves exact decimals, unknowns and source/currency boundaries",()=>{
 const rows=parseAccountEvidence(body([row,{...row,id:"2",sourceKind:"manual_attestation"},{...row,id:"3",quoteCurrency:"USD"}]));
 assert.equal(rows.length,3);assert.equal(evidenceAmount(rows[0].equityQuote,"USDT"),"99999999999999999999.12345678 USDT");assert.equal(evidenceAmount(null,"USD"),"Unavailable");
});
test("latest observation selection is order-independent and per account",()=>{
 const latest={...row,id:"new",capturedAt:"2026-11-08T02:00:00Z"};assert.deepEqual(parseAccountEvidence(body([row,latest,row])).map(r=>r.id),["new"]);
});
test("unavailable or malformed evidence fails closed",()=>{
 for(const v of [{},body([{...row,equityQuote:""}]),body([{...row,sourceKind:"simulation"}]),body([{...row,availableQuote:Infinity}]),body(Array(26).fill(row))])assert.throws(()=>parseAccountEvidence(v));
});
test("freshness follows capture time and becomes stale without a new fetch",()=>{
 const t=Date.parse(row.capturedAt);assert.equal(evidenceFreshness(row.capturedAt,t),"recent");assert.equal(evidenceFreshness(row.capturedAt,t+300001),"stale");assert.equal(evidenceFreshness(row.capturedAt,t-60001),"future");
});
