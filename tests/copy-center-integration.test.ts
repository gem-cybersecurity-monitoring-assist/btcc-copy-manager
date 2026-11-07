import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Copy Center and BTCC control room have separate pages", () => {
  assert.ok(existsSync(new URL("../src/app/page.tsx", import.meta.url)));
  assert.ok(
    existsSync(new URL("../src/app/copy-center/page.tsx", import.meta.url)),
  );
  assert.ok(
    existsSync(new URL("../src/app/copy-trading/page.tsx", import.meta.url)),
  );
  assert.ok(
    existsSync(new URL("../src/app/copy-trading/layout.tsx", import.meta.url)),
  );
  assert.match(read("src/app/page.tsx"), /redirect/);
  assert.ok(read("src/app/page.tsx").includes('redirect("/copy-center")'));
  assert.match(read("src/app/advanced-btcc/page.tsx"), /ManagerShell/);
  assert.match(read("src/app/copy-trading/page.tsx"), /IntelligenceEngine/);
});

test("all Copy Center components and supporting files are present", () => {
  for (const name of [
    "CloudAccountPanel.tsx",
    "storage.ts",
    "styles.css",
    "engine/IntelligenceEngine.tsx",
    "engine/AnalysisTabs.tsx",
    "engine/OpsTabs.tsx",
    "engine/AgentTab.tsx",
    "engine/ui.tsx",
  ])
    assert.ok(
      existsSync(new URL(`../src/app/copy-trading/${name}`, import.meta.url)),
      name,
    );
});

test("desktop and phone navigation expose both Copy Center and research", () => {
  const shell = read("src/components/manager-shell.tsx");
  assert.equal(
    (shell.match(/window\.location\.assign\("\/copy-trading"\)/g) || []).length,
    2,
  );
  assert.equal(
    (shell.match(/window\.location\.assign\("\/copy-center"\)/g) || []).length,
    2,
  );
  assert.match(read("src/app/copy-center/page.tsx"), /CopyCenterWorkspace/);
});

test("Copy Center advanced tools link routes to the existing protected browser controller", () => {
  const dashboard = read("src/components/copy-center-workspace.tsx");
  assert.ok(dashboard.includes('href="/steel"'));
  assert.ok(!dashboard.includes('href="/advanced-btcc"'));
  assert.ok(dashboard.includes('href="/copy-center/positions"'));
});

test("iPhone navigation remains scrollable with both Copy Center choices", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.mobile-nav \{[^}]*overflow-x:auto/);
  assert.match(css, /\.mobile-nav button \{[^}]*flex:0 0 76px/);
});

test("core execution and read-only paths remain mounted separately", () => {
  for (const path of [
    "src/app/api/v1/live/status/route.ts",
    "src/app/api/v1/live/execute/route.ts",
    "src/app/api/v1/sentinel/health/route.ts",
    "src/app/api/workspace/route.ts",
    "src/app/api/auth/session/route.ts",
    "src/app/api/connections/bitget/verify/route.ts",
  ])
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)), path);
});
