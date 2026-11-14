/** Fail-closed extraction for two isolated open-weight coding proofs.
 * Not a general-purpose JavaScript sandbox or authorization for application edits. */
import { createHash } from "node:crypto";
import vm from "node:vm";

const KINDS = Object.freeze({
 add_function: Object.freeze({
   regex: /\b(?:export\s+)?function\s+add\s*\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s+a\s*\+\s*b\s*;?\s*\}/g,
   name: "add",
   tests: [[2, 3, 5],[-4, 1, -3],[0, 0, 0]]
 }),
 clamp_function: Object.freeze({
   regex: /\b(?:export\s+)?function\s+clamp\s*\(\s*value\s*,\s*min\s*,\s*max\s*\)\s*\{\s*return\s+Math\.min\s*\(\s*Math\.max\s*\(\s*value\s*,\s*min\s*\)\s*,\s*max\s*\)\s*;?\s*\}/g,
   name: "clamp",
   tests: [[-5, 0, 10, 0],[12, 0, 10, 10],[4, 0, 10, 4],[10, 10, 10, 10]]
 })
});

export function validateMuseModelOutput(output, { kind = "add_function" } = {}) {
 if (typeof output !== "string" || output.length < 12 || output.length > 10000) throw Error("invalid_model_output");
 if (typeof kind !== "string" || !Object.hasOwn(KINDS,kind)) throw Error("model_task_not_supported");
 const spec=KINDS[kind];
 const cleaned=output.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");
 const matches=[...cleaned.matchAll(spec.regex)];
 if(matches.length!==1)throw Error("model_code_not_in_allowlist");
 const code=matches[0][0].trim();
 const executable=code.replace(/^export\s+/,"");
 const name=spec.name;
 const f=new vm.Script(executable+"; "+name+";", {filename:"verified-model-"+name+".js"})
   .runInNewContext(Object.create(null),{timeout:350});
 if(typeof f!=="function")throw Error("model_functional_check_failed");
 for(const testCase of spec.tests){
   const args=testCase.slice(0,-1), expected=testCase.at(-1);
   if(f(...args)!==expected)throw Error("model_functional_check_failed");
 }
 const source=code+"\n";
 return Object.freeze({
   source,
   sha256:createHash("sha256").update(source,"utf8").digest("hex"),
   verified:true,
   modelUsed:true,
   allowedScope:"single_"+spec.name+"_function",
   kind,
   generalSandbox:false
 });
}
