// Read-only production smoke tests. Never submit credentials, sign transactions, or place orders.
import assert from "node:assert/strict";

const base = (process.env.COPY_MANAGER_SMOKE_URL || "https://btcc-copy-manager.vercel.app").replace(/\/$/, "");
const targetPaths = ["/", "/copy-center", "/copy-trading", "/opportunities"];
let failures = 0;

async function check(path, verify) {
  const url = base + path;
  const abort = AbortSignal.timeout(20000);
  try {
    const response = await fetch(url, { signal: abort, redirect: "follow", headers: { "User-Agent": "GEM-Copy-Manager-CI-Smoke/1.0", "Accept": "text/html, application/json" } });
    const type = response.headers.get("content-type") || "";
    const body = await response.text();
    verify(response, type, body);
    console.log("PASS", path, "HTTP", response.status, "type", type.split(";")[0]);
  } catch (e) {
    failures++;
    console.error("FAIL", path, String(e).slice(0, 400));
  }
}

for (const path of targetPaths) {
  await check(path, (res, type, body) => {
    assert.equal(res.status, 200, "Page must respond HTTP 200");
    assert.match(type, /text\/html/i, "Expected HTML (not a login, gateway or protection error)");
    assert.match(body, /<html/i, "Expected an HTML document");
    assert.match(body, /<body/i, "Expected an HTML body");
    assert.doesNotMatch(body, /Authentication Required|Vercel Authentication|Deployment Protection/i, "Deployment protection must not intercept production");
  });
}

await check("/api/auth/session", (res, type, body) => {
  assert.equal(res.status, 200, "Session status must be publicly readable");
  assert.match(type, /application\/json/i);
  const data = JSON.parse(body);
  assert.equal(data.authenticated, false, "Anonymous request must not be signed in");
  assert.equal(data.configured, true, "Cloud auth must be configured");
});

await check("/api/workspace", (res, type, body) => {
  assert.equal(res.status, 401, "Anonymous workspace access must be denied");
  assert.match(type, /application\/json/i);
  const data = JSON.parse(body);
  assert.equal(data.code, "not_authenticated");
});

if (failures) {
  console.error(`${failures} production smoke test(s) failed`);
  process.exitCode = 1;
} else {
  console.log("All production smoke checks passed (no trading actions performed).");
}
