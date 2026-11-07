import test from "node:test";
import assert from "node:assert/strict";
import { dedupeNotification, scoreOpportunity, selectWatchlist, getOpportunities, scan, getMarketStatus } from "../src/lib/opportunities.ts";
test("score penalizes leverage and drawdown", () => { const safe = scoreOpportunity({roi30d:15,winRate:65,maxDrawdown:5,leverage:2,liquidity:"HIGH",market:"CONFIRMED"}); const risky = scoreOpportunity({roi30d:15,winRate:65,maxDrawdown:20,leverage:5,liquidity:"LOW",market:"STALE"}); assert.ok(safe > risky); });
test("watchlist is capped and diversified by symbol", () => { const result = selectWatchlist(Array.from({length:8},(_,i)=>({id:String(i),symbol:i<2?"BTCUSDT":`X${i}`,direction:"LONG",trader:"t",roi30d:1,winRate:50,maxDrawdown:1,followers:1,leverage:1,liquidity:"HIGH",score:80-i,risk:"LOW",market:"CONFIRMED",freshness:"now",rationale:[],source:"test"} as const))); assert.equal(result.length,5); assert.equal(result.filter(x=>x.symbol==="BTCUSDT").length,1); });
test("notification dedupe is idempotent", () => { const seen = new Set<string>(); assert.equal(dedupeNotification("x",seen),true); assert.equal(dedupeNotification("x",seen),false); });

test("unconfigured discovery fails closed without fictional trader records", () => { assert.deepEqual(getOpportunities(), []); assert.deepEqual(scan().watchlist, []); assert.equal(getMarketStatus().state, "UNKNOWN"); assert.equal(getMarketStatus().checkedAt, null); });
