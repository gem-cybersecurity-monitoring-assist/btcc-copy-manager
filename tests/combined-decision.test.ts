import test from "node:test";
import assert from "node:assert/strict";
import { defaultEngineState } from "../lib/engine/state.ts";
import { assessCombinedDecision } from "../src/lib/combined-decision.ts";
import type { LiquidityObservation } from "../src/lib/liquidity.ts";

const NOW = new Date("2026-11-07T12:00:00Z");
const book=(symbol:"BTC"|"ETH",provider:"Bitget"|"OKX",age=1000):LiquidityObservation=>({
  provider,symbol,quoteCurrency:"USDT",bid:100,ask:101,mid:100.5,
  spreadBps:5,bidDepthQuote:15000,askDepthQuote:16000,
  depthImbalancePct:-3,levels:10,sourceTimestamp:new Date(NOW.getTime()-age).toISOString(),
  retrievedAt:NOW.toISOString(),
});

test("empty workspace cannot inherit execution permission from public data",()=>{
  const result=assessCombinedDecision(null,[],false,NOW);
  assert.equal(result.executionPermitted,false);
  assert.equal(result.researchStatus,"RESEARCH_HOLD");
  assert.equal(result.checks.length,4);
  assert.ok(result.checks.every(c=>c.status==="blocked"));
});

test("fresh independent spot books enable context without granting orders",()=>{
  const result=assessCombinedDecision(defaultEngineState(),[
    book("BTC","Bitget"),book("ETH","Bitget"),book("BTC","OKX"),book("ETH","OKX"),
  ],true,NOW);
  assert.equal(result.verifiedBooks,4);
  assert.equal(result.checks.find(c=>c.id==="liquidity")?.status,"observed");
  assert.equal(result.checks.find(c=>c.id==="service")?.status,"review");
  assert.equal(result.executionPermitted,false);
});

test("stale source timestamps fail closed even with venue coverage",()=>{
  const result=assessCombinedDecision(defaultEngineState(),[
    book("BTC","Bitget",300000),book("ETH","OKX",300000),
  ],false,NOW);
  assert.equal(result.verifiedBooks,0);
  assert.equal(result.checks.find(c=>c.id==="liquidity")?.status,"blocked");
});

test("critical saved risk alerts veto new exposure despite favorable public spreads",()=>{
  const engine=defaultEngineState();
  engine.alerts.push({
    key:"maxloss",kind:"risk",severity:"critical",subject:"portfolio",
    message:"Drawdown exceeds policy",recommendation:"Reduce exposure",
    createdAt:NOW.toISOString(),acknowledgedAt:null,resolvedAt:null,
  });
  const result=assessCombinedDecision(engine,[book("BTC","Bitget"),book("ETH","OKX")],true,NOW);
  assert.equal(result.checks.find(c=>c.id==="portfolio")?.status,"blocked");
  assert.equal(result.executionPermitted,false);
});
