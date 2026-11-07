import test from "node:test";
import assert from "node:assert/strict";
import { localEngineReply } from "../lib/agent/local-assistant.ts";
import { defaultEngineState } from "../lib/engine/state.ts";

const now=new Date("2026-11-07T12:00:00Z");
test("free assistant summarizes real recorded risk without external API",()=>{
 const s=defaultEngineState();
 const answer=localEngineReply("Explain my current risk",s,now);
 assert.match(answer,/Recorded portfolio exposure/);
 assert.match(answer,/independently synchronized live exchange balances/);
});
test("no verified strategies yields a fail-closed $30 allocation answer",()=>{
 const answer=localEngineReply("I have $30. What should I do?",defaultEngineState(),now);
 assert.match(answer,/\$30/);
 assert.match(answer,/No strategy currently meets the eligibility requirements/);
 assert.doesNotMatch(answer,/guaranteed/i);
});
test("best traders response does not invent winning profiles",()=>{
 const answer=localEngineReply("Find the best trader",defaultEngineState(),now);
 assert.match(answer,/No recorded strategy currently qualifies/);
});
test("risk-control explanation distinguishes local screening from exchange stops",()=>{
 const answer=localEngineReply("Set stop loss on my trader",defaultEngineState(),now);
 assert.match(answer,/NOT automatically enforced stop-loss orders/);
});
test("sensitive commands never initiate trading",()=>{
 for (const prompt of ["Execute an order now", "Withdraw my funds", "Transfer money"]) {
  const result=localEngineReply(prompt,defaultEngineState(),now);
  assert.match(result,/cannot place orders, initiate copying, transfer or withdraw/);
 }
});
test("monitoring and account responses are grounded in saved data",()=>{
 const state=defaultEngineState();
 assert.match(localEngineReply("Show automation monitoring status",state,now),/last saved local engine review/);
 assert.match(localEngineReply("Are my accounts connected?",state,now),/No tracked provider record/);
});
