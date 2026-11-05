import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Copy Center and BTCC control room have separate pages", () => {
  assert.ok(existsSync(new URL("../src/app/page.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../src/app/copy-trading/page.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../src/app/copy-trading/layout.tsx", import.meta.url)));
  assert.match(read("src/app/page.tsx"), /ManagerShell/);
  assert.match(read("src/app/copy-trading/page.tsx"), /IntelligenceEngine/);
});

test("all Copy Center components and supporting files are present", () => {
  for (const name of [
    "CloudAccountPanel.tsx", "storage.ts", "styles.css",
    "engine/IntelligenceEngine.tsx", "engine/AnalysisTabs.tsx",
    "engine/OpsTabs.tsx", "engine/AgentTab.tsx", "engine/ui.tsx"
  ]) assert.ok(existsSync(new URL(`../src/app/copy-trading/${name}`, import.meta.url)), name);
});

test("desktop and phone navigation use the actual Copy Center route", () => {
  const shell = read("src/components/manager-shell.tsx");
  assert.equal((shell.match(/window\.location\.assign\("\/copy-trading"\)/g) || []).length, 2);
  assert.doesNotMatch(shell, /window\.location\.assign\("\/copy-center"\)/);
});

test("core execution and read-only paths remain mounted separately", () => {
  for (const path of [
    "src/app/api/v1/live/status/route.ts",
    "src/app/api/v1/live/execute/route.ts",
    "src/app/api/v1/sentinel/health/route.ts",
    "src/app/api/workspace/route.ts",
    "src/app/api/auth/session/route.ts",
    "src/app/api/connections/bitget/verify/route.ts",
  ]) assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
});
