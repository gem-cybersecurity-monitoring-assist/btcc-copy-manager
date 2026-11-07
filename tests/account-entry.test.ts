import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL("../" + name, import.meta.url), "utf8");

test("account and sign-in entry routes reuse existing authentication instead of duplicating it", () => {
  for (const path of ["src/app/account/page.tsx", "src/app/sign-in/page.tsx"]) {
    assert.match(read(path), /CopyCenterWorkspace accountOnly/);
    assert.doesNotMatch(read(path), /redirect/);
  }
  assert.match(read("src/proxy.ts"), /authorizeSentinelOwner/);
});
test("Copy Center recognizes account registration deep link", () => {
  const component = read("src/components/copy-center-workspace.tsx");
  assert.match(component, /requested === "settings" && params\.get\("auth"\) === "signup"/);
  assert.match(component, /setAuthMode\("signup"\)/);
  assert.match(component, /setView\(requested as View\)/);
});
