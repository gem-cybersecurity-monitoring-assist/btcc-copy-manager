/** Narrow, fail-closed validator for a public open-weight coding-model proof.
 * This does NOT provide a general sandbox for arbitrary model-generated code. */
import { createHash } from "node:crypto";
import vm from "node:vm";

const ALLOWED = /\b(?:export\s+)?function\s+add\s*\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s+a\s*\+\s*b\s*;?\s*\}/g;

export function validateMuseModelOutput(output) {
  if (typeof output !== "string" || output.length < 12 || output.length > 10000) throw Error("invalid_model_output");
  const cleaned = output.replace(/\u001b\[[0-9;]*m/g, "").replace(/\r/g, "");
  const matches = [...cleaned.matchAll(ALLOWED)];
  if (matches.length !== 1) throw Error("model_code_not_in_allowlist");
  const code = matches[0][0].trim();
  // Only the explicitly recognized function is extracted. No surrounding model text is executed.
  const executable = code.replace(/^export\s+/, "");
  const f = new vm.Script(executable + "; add;", { filename: "verified-model-add.js" }).runInNewContext(
    Object.create(null), { timeout: 350 });
  if (typeof f !== "function" || f(2, 3) !== 5 || f(-4, 1) !== -3 || f(0, 0) !== 0) {
    throw Error("model_functional_check_failed");
  }
  const source = code + "\n";
  return Object.freeze({
    source,
    sha256: createHash("sha256").update(source, "utf8").digest("hex"),
    verified: true,
    modelUsed: true,
    allowedScope: "single_add_function",
    generalSandbox: false
  });
}
