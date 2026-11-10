import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("remote-browser account control is gated by the read-only switch", () => {
  const gate = read("src/lib/owner-request.ts");
  assert.match(gate, /options\.accountControl && process\.env\.COPY_CENTER_ACCOUNT_CONTROL_ENABLED !== "true"/);
  assert.match(gate, /code: "read_only_stage"/);
  for (const route of [
    "src/app/api/v1/steel/input/route.ts",
    "src/app/api/v1/browserbase/btcc-login-bcc195fa-5093-4d1e-8790-527dbc9eb915/route.ts",
    "src/app/api/v1/browserbase/btcc-google-login-3d7c4b8a/route.ts",
  ]) {
    const posts = read(route).match(/export async function POST[\s\S]*?\n}/)?.[0] ?? "";
    assert.match(posts, /accountControl: true/, route + " POST must be account-control gated");
  }
});

test("financial execution routes remain hard-stopped", () => {
  for (const route of ["src/app/api/v1/live/execute/route.ts", "src/app/api/v1/purchase/execute/route.ts"])
    assert.match(read(route), /financialExecution: true/, route);
});
