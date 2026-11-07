import test from "node:test";
import assert from "node:assert/strict";
import { addCandidateResearch } from "../src/lib/trader-research-handoff.ts";
import { defaultEngineState, parseEngineState } from "../lib/engine/state.ts";
import { evaluateStrategy } from "../lib/engine/scoring.ts";
import type { TraderCandidate } from "../src/lib/trader-discovery.ts";
const candidate:TraderCandidate = {
 id:"trader-123",venue:"Bitget",name:"A public trader",roi30dPct:23,winRatePct:61,
 maxDrawdownPct:11,aumUsd:10000,copiers:14,score:60,
 verdict:"REVIEW",reasons:[],provenance:"Kopyon third-party ranking",executable:false,
};
const at=new Date("2026-11-07T12:00:00Z");
test("research handoff records third-party evidence without granting trading eligibility",()=>{
 const saved=addCandidateResearch(defaultEngineState(),candidate,at);
 assert.equal(saved.ok,true);
 if(!saved.ok)return;
 const strategy=saved.state.strategies[0];
 assert.equal(strategy.externalId,"trader-123");
 assert.equal(strategy.series,null);
 assert.equal(strategy.maxLeverage,null);
 assert.equal(strategy.observations[0].verified,false);
 assert.equal(strategy.observations[0].source,"provider_profile");
 assert.equal(saved.state.providers.length,0);
 assert.equal(parseEngineState(saved.state).ok,true);
 const evaluation=evaluateStrategy(strategy,saved.state.policy,at);
 assert.equal(evaluation.eligible,false);
 assert.ok(saved.state.audit.some(x=>x.action==="research_candidate_saved"));
});
test("duplicate IDs and malformed source never overwrite engine",()=>{
 const saved=addCandidateResearch(defaultEngineState(),candidate,at);
 assert.equal(saved.ok,true);
 if(!saved.ok)return;
 assert.equal(addCandidateResearch(saved.state,candidate,at).ok,false);
 assert.equal(addCandidateResearch(defaultEngineState(),{...candidate,executable:true} as unknown as TraderCandidate,at).ok,false);
});
