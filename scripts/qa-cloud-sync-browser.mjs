// Two-device cloud sync acceptance against the local synthetic fixture.
// Run: GEM_QA_BROWSER_SCRIPT=scripts/qa-cloud-sync-browser.mjs node scripts/test-owner-boundaries.mjs
import assert from "node:assert/strict";
const pw = await import(process.env.GEM_QA_PLAYWRIGHT_MODULE || "playwright");
const { chromium } = pw.chromium ? pw : pw.default;
const base = process.env.GEM_QA_APP_URL;
const browser = await chromium.launch({ headless: true, ...(process.env.GEM_QA_CHROMIUM_PATH ? { executablePath: process.env.GEM_QA_CHROMIUM_PATH } : {}) });
const results = {};
async function device(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: "gem_cc_access", value: "owner-jwt", url: base }]);
  await context.setExtraHTTPHeaders({ "x-forwarded-for": "10.0.0." + (name === "A" ? 1 : 2) });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("dialog", (d) => d.accept());
  await page.route("**/api/v1/market/**", (r) => r.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  return { context, page, errors };
}
const budgetInput = (page) => page.getByLabel(/Planned amount per provider/);
async function openLimits(page) {
  await page.goto(base + "/copy-center", { waitUntil: "load" });
  await page.getByRole("button", { name: "Limits" }).first().click();
  await page.waitForTimeout(2500);
}
const cloudBudget = async (page) => page.evaluate(async () => (await (await fetch("/api/workspace", { cache: "no-store" })).json()).workspace?.copyCenter?.budget ?? null);

const A = await device("A");
await openLimits(A.page);
await budgetInput(A.page).fill("33");
await A.page.waitForTimeout(4500);
results.autoSavedFromA = await cloudBudget(A.page);

const B = await device("B");
await openLimits(B.page);
results.autoRestoredOnB = await budgetInput(B.page).inputValue();
await budgetInput(B.page).fill("44");
await B.page.waitForTimeout(4500);
results.autoSavedFromB = await cloudBudget(B.page);

await A.page.evaluate(() => window.dispatchEvent(new Event("focus")));
await A.page.waitForTimeout(3000);
results.pickedUpOnAFocus = await budgetInput(A.page).inputValue();

// Conflict: A goes offline from the workspace API, edits; B edits; A comes back.
await A.page.route("**/api/workspace", (r) => r.abort());
await budgetInput(A.page).fill("55");
await A.page.waitForTimeout(3500);
await budgetInput(B.page).fill("66");
await B.page.waitForTimeout(4500);
await A.page.unroute("**/api/workspace");
await A.page.evaluate(() => window.dispatchEvent(new Event("focus")));
await A.page.waitForTimeout(3000);
await A.page.getByRole("button", { name: "Settings" }).first().click();
await A.page.waitForTimeout(800);
results.conflictShown = await A.page.getByText("Two versions of your preferences").isVisible();
results.statusA = await A.page.locator('[aria-live="polite"]').first().innerText().catch(() => "none");

results.cloudUntouchedDuringConflict = await cloudBudget(B.page);
await A.page.getByRole("button", { name: "Keep this device's version" }).click();
await A.page.waitForTimeout(3000);
results.afterKeepLocal = await cloudBudget(A.page);
results.errors = [...A.errors, ...B.errors];
await browser.close();
assert.deepEqual(
  { ...results, statusA: undefined },
  { autoSavedFromA: "33", autoRestoredOnB: "33", autoSavedFromB: "44", pickedUpOnAFocus: "44", conflictShown: true,
    statusA: undefined, cloudUntouchedDuringConflict: "66", afterKeepLocal: "55", errors: [] },
);
console.log(JSON.stringify({ cloudSync: "PASS", ...results }));
