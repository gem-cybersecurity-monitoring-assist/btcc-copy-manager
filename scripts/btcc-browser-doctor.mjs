#!/usr/bin/env node

const SENTINEL = (process.env.SENTINEL_URL || "http://127.0.0.1:8421").replace(/\/$/, "");
const MANAGER = (process.env.BTCC_MANAGER_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const CDP = (process.env.BTCC_CDP_HTTP || "http://127.0.0.1:9222").replace(/\/$/, "");

function row(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(18)} ${detail}`);
  return ok;
}

async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

let all = true;
const major = Number(process.versions.node.split(".")[0]);
all = row("Node.js", major >= 24, process.version) && all;

try {
  const health = await json(`${SENTINEL}/health`);
  all = row("Sentinel", Boolean(health?.ok), `${SENTINEL} ${health?.version || ""}`.trim()) && all;
} catch (error) {
  all = row("Sentinel", false, `${SENTINEL} — ${error.message}`) && all;
}

try {
  const health = await json(`${MANAGER}/api/v1/sentinel/health`);
  const connected = health?.connected === true || health?.ok === true || health?.sentinel?.ok === true;
  all = row("Manager bridge", connected, MANAGER) && all;
} catch (error) {
  all = row("Manager bridge", false, `${MANAGER} — ${error.message}`) && all;
}

try {
  const targets = await json(`${CDP}/json`);
  const btcc = Array.isArray(targets) ? targets.find((target) => {
    try {
      const host = new URL(target.url || "").hostname.toLowerCase();
      return target.type === "page" && (host === "btcc.com" || host.endsWith(".btcc.com"));
    } catch { return false; }
  }) : null;
  all = row("Chrome DevTools", Array.isArray(targets), CDP) && all;
  all = row("BTCC tab", Boolean(btcc), btcc ? btcc.url : "Open BTCC and sign in in the dedicated Chrome window") && all;
} catch (error) {
  all = row("Chrome DevTools", false, `${CDP} — ${error.message}`) && all;
  all = row("BTCC tab", false, "Run: pnpm browser:chrome, then sign into BTCC") && all;
}

console.log("");
if (all) {
  console.log("READY — run `pnpm browser:scan:dry` for the first read-only snapshot.");
  process.exit(0);
}
console.log("NOT READY — fix the FAIL rows above. No trading action was attempted.");
process.exit(1);
