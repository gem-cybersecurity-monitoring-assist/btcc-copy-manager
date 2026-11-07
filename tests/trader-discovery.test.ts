import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTraderRankings } from "../src/lib/trader-discovery.ts";

test("normalizes provider-reported fractions without granting execution",()=>{
 const data={data:{traders:[
  {traderId:"leader-1",name:"Trader A",roi:0.25,maxDrawdown:0.08,winRate:0.67,aum:20000,copiers:34},
  {traderId:"leader-2",name:"Trader B",roi:2.2,maxDrawdown:0.55,winRate:0.49,aum:100000,copiers:3},
 ]}};
 const rows=normalizeTraderRankings(data,"Bitget");
 assert.equal(rows.length,2);
 assert.equal(rows[0].roi30dPct,25);
 assert.equal(rows[0].maxDrawdownPct,8);
 assert.equal(rows[0].verdict,"REVIEW");
 assert.equal(rows[1].verdict,"HIGH_RISK");
 assert.ok(rows.every(r=>r.executable===false));
});
test("missing critical risk fields cannot become automatically eligible",()=>{
 const rows=normalizeTraderRankings({data:{traders:[{traderId:"a",name:"Unknown",roi:3}]}}, "Gate");
 assert.equal(rows[0].score,null);
 assert.equal(rows[0].verdict,"INSUFFICIENT");
});
test("invalid, duplicated or malformed data never generates candidates",()=>{
 assert.deepEqual(normalizeTraderRankings({error:"quota"},"Bitget"),[]);
 assert.deepEqual(normalizeTraderRankings({}, "Gate"),[]);
 const rows=normalizeTraderRankings({data:{traders:[
  {traderId:"id",name:"A",roi:0.3,maxDrawdown:0.15,winRate:0.6},
  {traderId:"id",name:"Duplicate",roi:0.9,maxDrawdown:0.01,winRate:0.9},
 ]}},"Bitget");
 assert.equal(rows.length,1);
});
