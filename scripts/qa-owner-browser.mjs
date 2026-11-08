const { chromium } = await import(
  process.env.GEM_QA_PLAYWRIGHT_MODULE || "playwright"
);
import assert from "node:assert/strict";
const base = process.env.GEM_QA_APP_URL;
const browser = await chromium.launch({ headless: true });
const summary = [];
for (const width of [320, 390, 1440]) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  // External public research is deliberately unavailable in this isolated UI test.
  await page.route("**/api/v1/market/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "QA public feed unavailable" }),
    }),
  );
  const fit = async (label) => {
    const result = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      width: innerWidth,
    }));
    assert.ok(
      result.scroll <= result.width + 1,
      label + " overflow " + JSON.stringify(result),
    );
  };
  await page.goto(base + "/copy-center");
  await page.waitForURL(base + "/sign-in");
  assert.equal(
    await page.getByRole("button", { name: "Accounts", exact: true }).count(),
    0,
  );
  await fit("Sign-in");
  await page.goto(base + "/account");
  assert.equal(
    await page.getByRole("link", { name: "Accounts", exact: true }).count(),
    0,
  );
  assert.equal(
    await page.getByText("Connection status", { exact: true }).count(),
    0,
  );
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page
    .getByLabel("Password", { exact: false })
    .fill("synthetic-only-passphrase");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: /Sign-up request accepted/ })
    .waitFor();
  await fit("Registration");
  await page
    .getByRole("button", { name: "I have an account", exact: true })
    .click();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(base + "/copy-center");
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .waitFor();
  await fit("Home");
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore cloud data", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: /restored/ })
    .waitFor();
  await page.getByRole("button", { name: "Limits", exact: true }).click();
  await page.getByLabel("Planned amount per provider").fill("15");
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: /Workspace saved/ })
    .waitFor();
  await fit("Cloud settings");
  // A second authenticated client changes the cloud after this browser's restore.
  const current = await context.request.get(base + "/api/workspace");
  const latest = await current.json();
  const external = await context.request.put(base + "/api/workspace", {
    headers: { Origin: base },
    data: {
      workspace: { ...latest.workspace, savedReviews: ["QA second browser"] },
      expectedUpdatedAt: latest.updatedAt,
    },
  });
  assert.equal(external.status(), 200);
  await page
    .getByRole("button", { name: "Save to cloud", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: /changed in another session/ })
    .waitFor();
  for (const path of [
    "/copy-center?view=providers",
    "/copy-center?view=portfolio",
    "/copy-center?view=performance",
    "/copy-center?view=risk",
    "/copy-trading",
    "/automation",
    "/opportunities",
  ]) {
    await page.goto(base + path);
    await page.locator("body").waitFor();
    await fit(path);
  }
  // Synthetic observation payload: never a real provider account.
  let evidenceMode = "records";
  await page.route("**/api/v1/ledger/snapshots", route => route.fulfill({
    status: evidenceMode === "unavailable" ? 503 : 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, source: "owner_scoped_ledger", snapshots: evidenceMode === "empty" ? [] : [{
      id: "synthetic-snapshot", connectionId: "synthetic-account", capturedAt: "2020-01-01T00:00:00Z", recordedAt: "2020-01-01T00:00:01Z", sourceKind: "official_api", quoteCurrency: "USDT", equityQuote: "99999999999999999999.12345678", availableQuote: null, realizedPnlQuote: null, unrealizedPnlQuote: "-1.23"
    }, { id: "synthetic-manual", connectionId: "synthetic-account", capturedAt: "2020-01-01T00:00:00Z", recordedAt: "2020-01-01T00:00:01Z", sourceKind: "manual_attestation", quoteCurrency: "USD", equityQuote: "50", availableQuote: null, realizedPnlQuote: null, unrealizedPnlQuote: null }] }),
  }));
  await page.goto(base + "/copy-center?view=portfolio");
  const evidence = page.getByRole("region", { name: "Saved account evidence" });
  await evidence.getByText("99999999999999999999.12345678 USDT", { exact: true }).waitFor();
  await evidence.getByText("Manual record — not exchange verified", { exact: true }).waitFor();
  assert.equal(await evidence.getByText(/Stale observation/).count(), 2);
  assert.ok(await evidence.getByText("Unavailable", { exact: true }).count() >= 2);
  await fit("Account evidence with exact decimals");
  evidenceMode = "empty";
  await evidence.getByRole("button", { name: "Refresh account evidence" }).click();
  await evidence.getByText(/No saved account observations yet/).waitFor();
  evidenceMode = "unavailable";
  await evidence.getByRole("button", { name: "Refresh account evidence" }).click();
  await evidence.getByText(/Account evidence is unavailable/).waitFor();
  assert.equal(await evidence.getByText("99999999999999999999.12345678 USDT", { exact: true }).count(), 0);
  await page.goto(base + "/copy-center?view=providers");
  await page
    .getByRole("button", { name: "Check read-only access", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await fit("Bitget form");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("button", { name: "My account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL(base + "/sign-in");
  assert.equal(
    (await context.request.get(base + "/api/workspace")).status(),
    401,
  );
  await page.goto(base + "/automation");
  await page.waitForURL(base + "/sign-in");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/gem-owner-signin-" + width + ".png" });
  summary.push({
    width,
    status: "PASS",
    checks: [
      "private redirect",
      "signup confirmation",
      "sign in",
      "restore",
      "save",
      "second-session conflict",
      "7 views",
      "read-only form",
      "logout",
      "no overflow",
      "no JS errors",
    ],
  });
  await context.close();
}
await browser.close();
console.log(JSON.stringify(summary, null, 2));
