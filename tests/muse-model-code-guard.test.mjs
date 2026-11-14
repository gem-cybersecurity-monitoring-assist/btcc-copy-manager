import test from "node:test";
import assert from "node:assert/strict";
import { validateMuseModelOutput } from "../scripts/muse-model-code-guard.mjs";

test("accepts restricted function and verifies behavior", () => {
 const r = validateMuseModelOutput("function add(a, b) { return a + b; }");
 assert.equal(r.verified, true); assert.equal(r.modelUsed, true);
 assert.equal(r.generalSandbox, false); assert.match(r.sha256, /^[a-f0-9]{64}$/);
 assert.equal(r.source.trim(), "function add(a, b) { return a + b; }");
});
test("rejects non-allowlisted model programs", () => {
 for (const bad of ["", "const add=(a,b)=>a+b;", "function add(a,b){return a-b;}", "function add(a,b){process.exit(0);return a+b;}", "import fs from 'node:fs';"]) {
   assert.throws(() => validateMuseModelOutput(bad));
 }
});
test("strips untrusted text outside recognized function instead of executing it", () => {
 const result = validateMuseModelOutput("process.exit(91);\nfunction add(a,b){return a+b;}\nrequire('node:fs').readFileSync('/etc/passwd')");
 assert.equal(result.source, "function add(a,b){return a+b;}\n");
 assert(!result.source.includes("process.exit"));
 assert(!result.source.includes("readFileSync"));
});
test("rejects ambiguous multiple matching functions", () => {
 assert.throws(() => validateMuseModelOutput("function add(a,b){return a+b;}\nfunction add(a,b){return a+b;}"), /allowlist/);
});
test("accepts an export keyword without granting any extra code", () => {
 const result = validateMuseModelOutput("Model answer: export function add(a, b) { return a + b; }");
 assert.equal(result.source.trim(), "export function add(a, b) { return a + b; }");
});
test("rejects excessive input and invalid input types", () => {
 for (const value of [null, {x:1}, "a".repeat(10001)]) assert.throws(() => validateMuseModelOutput(value));
});
