import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL("../" + name, import.meta.url), "utf8");

test("account and sign-in entry routes reuse existing authentication instead of duplicating it", () => {
  assert.match(read("src/app/account/page.tsx"), /redirect\("\/copy-center\?view=settings&auth=signup"\)/);
  assert.match(read("src/app/sign-in/page.tsx"), /redirect\("\/copy-center\?view=settings&auth=signin"\)/);
});
test("Copy Center recognizes account registration deep link", () => {
  const component = read("src/components/copy-center-workspace.tsx");
  assert.match(component, /requested === "settings" && params\.get\("auth"\) === "signup"/);
  assert.match(component, /setAuthMode\("signup"\)/);
  assert.match(component, /setView\(requested as View\)/);
});
