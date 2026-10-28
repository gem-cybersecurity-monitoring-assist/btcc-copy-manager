// End-to-end browser check for GEM Copy Center against a running build and scripts/e2e/mock-supabase.mjs.
// No real accounts, emails, exchange credentials, or trades are involved. See README "Browser end-to-end check".
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const MOCK = process.env.E2E_MOCK_URL || "http://localhost:54321";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : "")); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gem-copy-center-e2e-"));
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const dialogs = []; let nextDialog = "accept";
  page.on("dialog", async (d) => { dialogs.push(d.message()); nextDialog === "accept" ? await d.accept() : await d.dismiss(); });
  const status = () => page.locator(".cloud-account .form-message").innerText();
  const seen = (text) => page.getByText(text).first().waitFor({ timeout: 4000 }).then(() => true, () => false);

  // Home workspace links to the engine; then the empty state on /copy-trading
  await page.goto(BASE + "/");
  check("home shows the Copy Center workspace with a link to the engine", await seen("MONITORING ONLY") && await page.getByRole("link", { name: /Open copy-trading engine/ }).first().isVisible());
  await page.goto(BASE + "/copy-trading");
  await page.getByRole("button", { name: "Hide demo rows" }).first().click();
  check("empty trader table shows guidance", await seen("No trader records yet"));
  check("empty snapshot table shows guidance", await seen("No portfolio snapshots yet"));
  check("CSV exports disabled when empty", await page.getByRole("button", { name: "Export trader CSV" }).isDisabled());

  // Create trader
  const f = page.locator(".manual-entry-form");
  await f.getByLabel("Trader name").fill("=Alpha Trader");
  await f.getByLabel("ROI (%)").fill("8.5"); await f.getByLabel("Max drawdown (%)").fill("12");
  await f.getByLabel("Win rate (%)").fill("55"); await f.getByLabel("Trade count").fill("120");
  await f.getByRole("button", { name: "Save trader profile" }).click();
  check("trader created", await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 1);

  // Edit trader
  await page.getByRole("button", { name: "Edit =Alpha Trader" }).click();
  await f.getByLabel("ROI (%)").fill("9.25");
  await f.getByRole("button", { name: "Update trader profile" }).click();
  check("trader edited", await page.locator("tbody tr", { hasText: "=Alpha Trader" }).innerText().then((t) => t.includes("9.3%")));
  await page.getByRole("button", { name: "Save review" }).click();
  check("bookmark saved", await page.getByRole("button", { name: "Saved ✓" }).isVisible());

  // Snapshot
  const sf = page.locator(".snapshot-form");
  await sf.getByLabel("Account equity (USDT equivalent)").fill("250");
  await sf.getByLabel("Available balance (USDT equivalent)").fill("300");
  await sf.getByRole("button", { name: "Save snapshot" }).click();
  check("snapshot rejects available > equity", await seen("available balance cannot exceed equity"));
  await sf.getByLabel("Available balance (USDT equivalent)").fill("180");
  await sf.getByRole("button", { name: "Save snapshot" }).click();
  check("snapshot saved", await page.locator(".portfolio-ledger tbody tr", { hasText: "BTCC" }).count() === 1);

  // Persistence across reload
  await page.reload();
  check("records persist after reload", await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 1 && await page.locator(".portfolio-ledger tbody tr", { hasText: "BTCC" }).count() === 1);

  // CSV export
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export trader CSV" }).click()]);
  const csv = fs.readFileSync(await csvDl.path(), "utf8");
  check("CSV has real line breaks and formula guard", csv.split("\r\n").length === 2 && csv.includes(`"'=Alpha Trader"`), JSON.stringify(csv.slice(0, 80)));

  // Backup export
  const [bk] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export backup" }).click()]);
  const backupPath = path.join(dir, "backup.json"); await bk.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  check("backup export contains records", backup.schema === "gem-copy-center-backup-v2" && backup.traders.length === 1 && backup.portfolioSnapshots.length === 1);

  // Malformed import is rejected, data untouched
  const bad = path.join(dir, "bad.json"); fs.writeFileSync(bad, "{not json");
  await page.locator('input[type=file]').setInputFiles(bad);
  check("malformed JSON import rejected", await seen("The file is not valid JSON. Your current records were not changed."));
  const invalid = path.join(dir, "invalid.json"); fs.writeFileSync(invalid, JSON.stringify({ ...backup, traders: [{ name: "x", drawdown: 500 }] }));
  await page.locator('input[type=file]').setInputFiles(invalid);
  check("invalid record import rejected", await seen("Trader record 1 is invalid"));
  check("records unchanged after failed imports", await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 1);

  // Import with confirmation: dismiss keeps data
  const other = path.join(dir, "other.json"); fs.writeFileSync(other, JSON.stringify({ ...backup, traders: [{ ...backup.traders[0], name: "Imported One" }] }));
  nextDialog = "dismiss"; dialogs.length = 0;
  await page.locator('input[type=file]').setInputFiles(other);
  await page.getByText("Import cancelled").waitFor({ timeout: 3000 }).catch(() => {});
  check("import asks before replacing records", dialogs.some((d) => d.includes("Replace this browser's")));
  check("cancelled import leaves records", await seen("Import cancelled") && await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 1);
  nextDialog = "accept";

  // Corrupt local storage does not crash
  await page.evaluate(() => { localStorage.setItem("gem-copy-center-traders-v1", JSON.stringify([{ name: 5 }, ...JSON.parse(localStorage.getItem("gem-copy-center-traders-v1"))])); localStorage.setItem("gem-copy-center-snapshots-v1", "{broken"); });
  await page.reload();
  check("corrupt storage skipped with notice", await page.locator(".storage-notice").isVisible() && await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 1);
  // re-add snapshot lost to corruption
  await sf.getByLabel("Account equity (USDT equivalent)").fill("250"); await sf.getByLabel("Available balance (USDT equivalent)").fill("180");
  await sf.getByRole("button", { name: "Save snapshot" }).click();

  // Signup -> confirmation-needed, not claiming delivery
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.locator(".cloud-auth-form").getByLabel("Email").fill("owner@example.com");
  await page.locator(".cloud-auth-form").getByLabel(/Password/).fill("a-long-test-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForTimeout(500);
  const signupMsg = await status();
  check("signup reports unverified delivery honestly", signupMsg.includes("Delivery is not confirmed"), signupMsg.slice(0, 90));
  check("resend option offered", await page.getByRole("button", { name: "Resend confirmation email" }).isVisible());

  // Login before confirmation
  await page.locator(".cloud-auth-form").getByLabel(/Password/).fill("a-long-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  check("login before confirmation explains why", await seen("has not been confirmed yet"));
  // Wrong password
  await fetch(MOCK + "/__confirm?email=owner@example.com", { headers: { apikey: "anon-test-key" } });
  await page.locator(".cloud-auth-form").getByLabel(/Password/).fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  check("wrong password rejected", await seen("Email or password is incorrect"));

  // Confirmation redirect landing strips tokens from URL
  await page.goto("about:blank"); // a confirmation email link is a fresh page load
  await page.goto(BASE + "/copy-trading#access_token=fake&refresh_token=fake&type=signup");
  await page.waitForTimeout(400);
  check("confirmation landing message + fragment removed", (await status()).includes("Email confirmed") && !page.url().includes("access_token"));

  // Sign in
  await page.locator(".cloud-auth-form").getByLabel("Email").fill("owner@example.com");
  await page.locator(".cloud-auth-form").getByLabel(/Password/).fill("a-long-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Signed in as").waitFor();
  const cookies = await ctx.cookies();
  const acc = cookies.find((c) => c.name === "gem_cc_access");
  check("session cookie is HttpOnly + SameSite=Lax", acc && acc.httpOnly && acc.sameSite === "Lax");
  await page.reload(); await page.getByText("Signed in as").waitFor({ timeout: 5000 });
  check("session restored after reload", true);

  // Upload with confirmation
  dialogs.length = 0;
  await page.getByRole("button", { name: "Upload local records" }).click(); await page.waitForTimeout(500);
  check("upload confirms and succeeds", dialogs[0]?.includes("replaces the current cloud copy") && (await status()).includes("Uploaded 1 trader record(s)"), await status());

  // Change local, then restore: cancel first
  await page.getByRole("button", { name: "Delete =Alpha Trader" }).click(); await page.waitForTimeout(200);
  check("delete trader with confirmation", dialogs.some((d) => d.includes("Delete the BTCC trader record")) && await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 0);
  nextDialog = "dismiss";
  await page.getByRole("button", { name: "Restore from cloud" }).click(); await page.waitForTimeout(500);
  check("cancelled restore leaves local records", (await status()).includes("Restore cancelled") && await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 0);
  nextDialog = "accept"; dialogs.length = 0;
  const dlPromise = page.waitForEvent("download", { timeout: 3000 }).catch(() => null);
  await page.getByRole("button", { name: "Restore from cloud" }).click();
  const preRestoreBackup = await dlPromise; await page.waitForTimeout(400);
  check("restore confirms, downloads pre-restore backup, restores", dialogs[0]?.includes("Replace this browser's") && preRestoreBackup && preRestoreBackup.suggestedFilename().includes("before-cloud-restore") && await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 1, preRestoreBackup?.suggestedFilename());

  // Delete snapshot
  await page.locator(".portfolio-ledger").getByRole("button", { name: /Delete snapshot/ }).first().click(); await page.waitForTimeout(200);
  check("delete snapshot", await seen("No portfolio snapshots yet"));

  // Cross-origin request from page context is refused
  const crossSite = await page.evaluate(async () => (await fetch("/api/workspace", { method: "PUT", headers: { "Content-Type": "text/plain" }, body: "{}" })).status);
  check("non-JSON PUT refused from browser", crossSite === 415);

  // Sign out
  await page.getByRole("button", { name: "Sign out" }).click(); await page.waitForTimeout(400);
  const after = (await ctx.cookies()).filter((c) => c.name.startsWith("gem_cc_"));
  check("sign-out clears cookies and keeps local records", after.length === 0 && await page.locator("tbody tr", { hasText: "=Alpha Trader" }).count() === 1);
  const unauth = await page.evaluate(async () => (await fetch("/api/workspace")).status);
  check("workspace API 401 after sign-out", unauth === 401);

  // Mobile
  const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await m.goto(BASE + "/copy-trading");
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("no horizontal page overflow at 375px", overflow <= 1, "overflow=" + overflow);
  await m.screenshot({ path: path.join(dir, "mobile.png"), fullPage: false });
  await page.screenshot({ path: path.join(dir, "desktop.png"), fullPage: true });

  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed (artifacts: ${dir})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
