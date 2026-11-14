import test from "node:test";
import assert from "node:assert/strict";
import {validateMusePublicTask} from "../scripts/muse-public-task-guard.mjs";
const base={version:1,taskId:"a35bd510-bb63-4d9e-8f10-52282ef08e81",repository:"gem-cybersecurity-monitoring-assist/btcc-copy-manager",kind:"add_function",instruction:"Write the small addition helper as a pure JavaScript function."};
test("accepts and safely scopes a public addition request",()=>{const x=validateMusePublicTask(base);assert.equal(x.path,"scripts/muse-proposals/ai-task-a35bd510.mjs");assert.equal(x.branch,"muse/ai-task-a35bd510-20261114")});
test("rejects wrong repository, task types and versions",()=>{for(const v of [{repository:"other/repo"},{kind:"modify_app"},{version:2}])assert.throws(()=>validateMusePublicTask({...base,...v}))});
test("rejects unknown fields and invalid IDs",()=>{for(const v of [{extra:true},{taskId:"../../etc/passwd"},{taskId:"not-a-uuid"}])assert.throws(()=>validateMusePublicTask({...base,...v}))});
test("rejects secrets and oversized instructions",()=>{for(const instruction of ["Bearer abcdefghijklmnopqrstuvwxyz", "github_pat_abcdefghijk123456", "x".repeat(401), "short"])assert.throws(()=>validateMusePublicTask({...base,instruction}))});
test("does not allow injected target paths or model selection",()=>{assert.throws(()=>validateMusePublicTask({...base,path:"src/app"}));assert.throws(()=>validateMusePublicTask({...base,model:"paid"}))});
