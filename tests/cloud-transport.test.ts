import assert from "node:assert/strict";
import test from "node:test";
import { CloudService } from "../lib/cloud-core.ts";
const config = {url:"https://isolated.supabase.co",key:"public-key"};
test("cloud requests prohibit redirects and carry a bounded cancellation signal", async()=>{
 let seen: RequestInit | undefined;
 const service = new CloudService(config,async(_url,init)=>{seen=init;return new Response(JSON.stringify({id:"owner"}));});
 const result = await service.getSession({access:"private-jwt"});
 assert.equal(result.state,"authenticated");assert.equal(seen?.redirect,"error");assert.ok(seen?.signal instanceof AbortSignal);
});
test("oversized streamed Auth responses fail closed even without Content-Length",async()=>{
 let cancelled=false;
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(600000));c.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}});
 const service=new CloudService(config,async()=>new Response(body));
 const result=await service.getSession({access:"private-jwt"});
 assert.equal(result.state,"unavailable");assert.equal(cancelled,true);assert.ok(!JSON.stringify(result).includes("private-jwt"));
});
test("malformed Auth JSON cannot establish a session",async()=>{
 const service=new CloudService(config,async()=>new Response("{not-json"));
 assert.notEqual((await service.getSession({access:"private-jwt"})).state,"authenticated");
});
