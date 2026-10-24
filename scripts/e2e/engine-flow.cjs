// End-to-end browser check for the intelligence engine against a running build (no Supabase needed).
// Uses simulated data, a CSV fixture, and an injected fake EVM wallet. No real accounts, funds, or trades.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " — " + detail : "")); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gem-engine-e2e-"));

function csvFixture(days) {
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 1);
  const rows = ["date,return_pct"];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86400000).toISOString().slice(0, 10);
    rows.push(`${d},${(0.15 + 0.6 * Math.sin(i * 1.3)).toFixed(3)}`);
  }
  return rows.join("\n");
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.addInitScript(() => {
    // Fake EIP-1193 wallet: only answers read-only requests.
    window.ethereum = { isMetaMask: true, request: async ({ method }) => {
      if (method === "eth_requestAccounts") return ["0x1234567890abcdef1234567890abcdef12345678"];
      if (method === "eth_chainId") return "0x1";
      if (method === "eth_getBalance") return "0x de0b6b3a7640000".replace(" ", ""); // 1 ETH
      if (method === "wallet_revokePermissions") return null;
      throw new Error("unsupported " + method);
    } };
  });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const seen = (text, root = page) => root.getByText(text).first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  const tab = (name) => page.getByRole("tab", { name }).click();
  const engine = page.locator("#engine");

  await page.goto(BASE + "/copy-trading");
  check("engine section renders with honesty notice", await seen("What it does not do:"));
  check("built-in providers listed, untracked", await engine.getByRole("button", { name: "Track BTCC" }).isVisible() && await engine.getByRole("button", { name: "Track Bitget" }).isVisible());

  // A · provider status machine
  await engine.getByRole("button", { name: "Track BTCC" }).click();
  const btcc = engine.locator(".engine-card", { hasText: "BTCC" }).first();
  const options = await btcc.locator("select").first().locator("option").allTextContents();
  check("cannot jump straight to Copy active", !options.includes("Copy active") && options.includes("Account linked"), options.join("|"));
  await btcc.locator("select").first().selectOption("ACCOUNT_LINKED");
  await btcc.getByRole("button", { name: "Record status" }).click();
  check("status change requires evidence note", await seen("Describe what you saw", btcc));
  await btcc.getByLabel(/What you saw on BTCC/).fill("Signed in on btcc.com");
  await btcc.getByRole("button", { name: "Record status" }).click();
  check("status recorded as user-confirmed", await seen("Account linked", btcc) && await seen("Confirmed by you on the platform; not independently verified by GEM.", btcc));

  // B · opportunities
  await tab("B · Opportunities");
  check("research sources honestly labelled", await seen("Live: none"));
  await engine.getByRole("button", { name: "Load simulated sample (testing)" }).click();
  const simRows = engine.locator("tbody tr", { hasText: "SIM ·" });
  check("6 simulated strategies loaded and labelled", (await simRows.count()) === 6 && (await engine.locator("tbody .pill-sim").count()) === 6);
  check("simulated strategies are not eligible for real money", (await engine.locator("tbody tr", { hasText: "SIM ·" }).filter({ hasText: "Eligible" }).filter({ hasNotText: "Not eligible" }).count()) === 0);
  const form = engine.locator(".engine-form");
  await form.getByLabel("Provider").selectOption("bitget");
  await form.getByLabel("Trader / strategy name").fill("Real ETH swing");
  await form.getByLabel("Assets traded").fill("ETH");
  await form.getByLabel("Max leverage (x)").fill("3");
  await form.getByLabel("Profit share (%)").fill("10");
  await form.getByLabel("Minimum copy (USD)").fill("10");
  await form.locator("textarea").fill("date,return_pct\n2026-10-02,1\n2026-10-01,2");
  await form.getByRole("button", { name: "Add strategy" }).click();
  check("malformed CSV rejected with reason", await seen("History not saved: Row 3: dates must be strictly increasing"));
  await form.locator("textarea").fill(csvFixture(90));
  await form.getByRole("button", { name: "Add strategy" }).click();
  check("strategy with CSV history saved", await seen("Real ETH swing saved."));
  const realRow = engine.locator("tbody tr", { hasText: "Real ETH swing" });
  check("real strategy with history is eligible", (await realRow.innerText()).includes("Eligible") && !(await realRow.innerText()).includes("Not eligible"), (await realRow.innerText()).replace(/\s+/g, " ").slice(0, 160));

  // C · intelligence
  await tab("C · Strategy intelligence");
  check("score explanation and invalidators shown", await seen(/Why .* scored/) && await seen("What could invalidate this ranking"));
  check("correlation matrix and clusters shown", await seen("Risk clusters") && (await engine.locator(".matrix td.corr-high").count()) > 0);

  // D · allocation (real mode excludes simulated)
  await tab("D · Capital allocation");
  const allocRows = engine.locator("table").first().locator("tbody tr");
  const allocText = await allocRows.allInnerTexts();
  check("real proposal uses only real data: $10 to the real strategy", allocText.length === 1 && allocText[0].includes("Real ETH swing") && allocText[0].includes("$10.00"), allocText.join(" / ").slice(0, 160));
  check("unallocated capital is shown", await seen("Held unallocated"));
  await engine.getByLabel("Include simulated data (testing only)").check();
  check("simulated mode shows a SIMULATED warning", await seen("This proposal uses generated data"));
  await engine.getByLabel("Include simulated data (testing only)").uncheck();
  await engine.getByRole("button", { name: "Track this proposal as a paper portfolio" }).click();
  check("paper portfolio saved", await seen("Saved as a paper portfolio"));

  // A again · record an allocation on Bitget
  await tab("A · Providers");
  await engine.getByRole("button", { name: "Track Bitget" }).click();
  const bitget = engine.locator(".engine-card", { hasText: "Bitget" }).first();
  for (const [status, note] of [["ACCOUNT_LINKED", "signed in"], ["ACCOUNT_VERIFIED", "KYC complete"], ["TRADER_SELECTED", "picked"]]) {
    await bitget.locator("select").first().selectOption(status);
    if (status === "TRADER_SELECTED") await bitget.getByLabel("Trader / strategy").selectOption({ label: "Real ETH swing" });
    await bitget.getByLabel(/What you saw on Bitget/).fill(note);
    await bitget.getByRole("button", { name: "Record status" }).click();
  }
  check("trader selected is not copy active", await seen("Trader selected", bitget) && !(await bitget.innerText()).includes("Copy active"));
  await bitget.getByRole("button", { name: /Update figures/ }).click();
  await bitget.getByLabel("Allocated to copying (USD)").fill("20");
  await bitget.getByRole("button", { name: /Save figures/ }).click();
  check("allocated amount recorded", await seen("$20.00", bitget));

  // E · risk
  await tab(/E · Risk center/);
  check("provider concentration detected across portfolio", await seen("Bitget holds 66.7% of capital"));
  check("stop-copy vs close-positions distinction explained", await seen("may leave existing copied positions open"));

  // F · monitoring
  await tab("F · Monitoring & audit");
  check("scheduler status stated honestly", await seen("No background server job is deployed"));
  await engine.getByRole("button", { name: "Run review now" }).click();
  check("review raises alerts and suggests reallocation review", await seen(/new alert\(s\)/) && await seen("Nothing has been changed on any platform"));
  await engine.getByRole("button", { name: "Run review now" }).click();
  check("second review is idempotent (0 new alerts)", await seen(/, 0 new alert\(s\)/));
  check("audit trail records user and engine actions", await seen("status changed") && await seen("monitor run") && await seen("alert raised"));

  // G · lab
  await tab("G · Simulation lab");
  await engine.getByRole("button", { name: "Run backtest" }).click();
  check("backtest runs with assumptions, limitations and SIMULATED label", await seen("Out-of-sample:") && await seen("Survivorship bias") && await seen("SIMULATED DATA."));
  check("backtest compares 3 methods + cash", (await engine.locator("article table").first().locator("tbody tr").count()) === 4);
  check("paper portfolio listed as paper", await seen("Paper only"));

  // H · wallets
  await tab("H · Wallets");
  await engine.getByRole("button", { name: "Connect MetaMask" }).click();
  check("EVM wallet shows public address, network, balance only", await seen("0x1234…5678") && await seen("Ethereum mainnet") && await seen(/^1$/));
  await engine.getByRole("button", { name: "Connect Phantom" }).click();
  check("missing Phantom handled", await seen("Phantom not detected"));
  await engine.getByRole("button", { name: "Disconnect" }).click();
  check("wallet disconnects", await engine.getByRole("button", { name: "Connect MetaMask" }).isVisible());

  // persistence + backup
  await page.reload();
  await tab("B · Opportunities");
  check("engine data persists across reload", await seen("Real ETH swing"));
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export backup" }).click()]);
  const backup = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  check("backup includes engine state", backup.engine && backup.engine.strategies.length === 7 && backup.engine.audit.length > 5);

  // mobile
  const m = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await m.goto(BASE + "/copy-trading#engine");
  for (const t of ["A · Providers", "D · Capital allocation", "E · Risk center"]) {
    await m.getByRole("tab", { name: t }).click();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`no horizontal page overflow on mobile (${t})`, overflow <= 1, "overflow=" + overflow);
  }
  await m.screenshot({ path: path.join(dir, "engine-mobile.png") });
  await tab("D · Capital allocation");
  await page.locator("#engine").screenshot({ path: path.join(dir, "engine-allocation.png") });

  check("no uncaught page errors", errors.length === 0, errors.join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} engine browser checks passed (artifacts: ${dir})`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
