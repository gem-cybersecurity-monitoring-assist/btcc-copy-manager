import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.GEM_QA_APP_URL;
assert.ok(
  base && /^http:\/\/(localhost|127\.0\.0\.1):[0-9]+$/.test(base),
  "Synthetic session checks are local-only",
);
const owner = "gem_cc_access=owner-jwt";
const other = "gem_cc_access=other-jwt";
const gates = [];
for (const group of ["live", "purchase", "browserbase", "steel"])
  for (const name of fs.readdirSync(
    process.cwd() + "/src/app/api/v1/" + group,
  )) {
    const file =
      process.cwd() + "/src/app/api/v1/" + group + "/" + name + "/route.ts";
    if (!fs.existsSync(file)) continue;
    for (const method of [
      ...fs
        .readFileSync(file, "utf8")
        .matchAll(/export async function (GET|POST|DELETE)\(/g),
    ].map((m) => m[1])) {
      const path = "/api/v1/" + group + "/" + name;
      const init = {
        method,
        headers: { "Content-Type": "application/json", Origin: base },
        ...(method === "GET" ? {} : { body: "{}" }),
      };
      for (const [cookie, expected] of [
        ["", 401],
        [other, 403],
      ]) {
        const r = await fetch(base + path, {
          ...init,
          headers: { ...init.headers, Cookie: cookie },
        });
        assert.equal(r.status, expected, path + " " + method);
        assert.match(r.headers.get("cache-control"), /no-store/);
        const body = await r.json();
        assert.ok(["not_authenticated", "owner_required"].includes(body.code));
      }
      gates.push(method + " " + path);
    }
  }
// Verify the mounted credential route rejects nonowners before parsing credentials.
for (const [cookie, expected] of [["", 401], [other, 403]]) {
  const r = await fetch(base + "/api/connections/bitget/verify", {
    method: "POST",
    headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(r.status, expected, "Bitget owner boundary");
  assert.match(r.headers.get("cache-control"), /no-store/);
}
// Persistent read-only connection routes: owner-only, same-origin writes, and
// without server-only storage keys the owner gets an explicit unconfigured state.
for (const [path, method] of [
  ["/api/connections/bitget", "GET"],
  ["/api/connections/bitget", "POST"],
  ["/api/connections/bitget", "DELETE"],
  ["/api/connections/bitget/refresh", "POST"],
]) {
  const body = method === "GET" ? {} : { body: "{}" };
  for (const [cookie, expected] of [["", 401], [other, 403]]) {
    const r = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, ...body });
    assert.equal(r.status, expected, path + " " + method);
    assert.match(r.headers.get("cache-control"), /no-store/);
  }
  if (method !== "GET") {
    const cross = await fetch(base + path, { method, headers: { Cookie: owner, Origin: "https://attacker.example", "Content-Type": "application/json" }, ...body });
    assert.equal(cross.status, 403, path + " cross-site");
  }
  const ownerResult = await fetch(base + path, { method, headers: { Cookie: owner, Origin: base, "Content-Type": "application/json" },
    ...(method === "POST" && path.endsWith("/bitget") ? { body: JSON.stringify({ apiKey: "k", secret: "s", passphrase: "p" }) } : body) });
  assert.equal(ownerResult.status, 503, path + " " + method + " unconfigured");
  const result = await ownerResult.json();
  assert.equal(result.code, "connection_storage_not_configured");
  assert.ok(result.missing.includes("SUPABASE_SERVICE_ROLE_KEY") && result.missing.includes("CONNECTION_SECRETS_KEY"));
  gates.push(method + " " + path);
}
// MT5: owner-only; without storage keys the owner gets an explicit unconfigured state and bridge status.
for (const [path, method] of [
  ["/api/connections/mt5", "GET"],
  ["/api/connections/mt5", "POST"],
  ["/api/connections/mt5", "DELETE"],
  ["/api/connections/mt5/refresh", "POST"],
]) {
  const body = method === "GET" ? {} : { body: path.endsWith("/mt5") && method === "POST" ? JSON.stringify({ login: "10000001", server: "Example-MT5", investorPassword: "p" }) : "{}" };
  for (const [cookie, expected] of [["", 401], [other, 403]]) {
    const r = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, ...body });
    assert.equal(r.status, expected, path + " " + method);
    assert.match(r.headers.get("cache-control"), /no-store/);
  }
  if (method !== "GET") {
    const cross = await fetch(base + path, { method, headers: { Cookie: owner, Origin: "https://attacker.example", "Content-Type": "application/json" }, ...body });
    assert.equal(cross.status, 403, path + " cross-site");
  }
  const r = await fetch(base + path, { method, headers: { Cookie: owner, Origin: base, "Content-Type": "application/json" }, ...body });
  assert.equal(r.status, 503, path + " " + method + " owner");
  assert.equal((await r.json()).code, "connection_storage_not_configured");
  gates.push(method + " " + path);
}
// BTCC: owner-only; provider unavailable without server credentials; imports refused without storage.
for (const [path, method, ownerStatus] of [
  ["/api/connections/btcc", "GET", 200],
  ["/api/connections/btcc/check", "POST", 200],
  ["/api/connections/btcc/import", "POST", 503],
  ["/api/connections/btcc/import?kind=positions", "DELETE", 503],
]) {
  const body = method === "POST" ? { body: path.endsWith("/import") ? JSON.stringify({ kind: "positions", csv: "Symbol,Side,Size\nBTCUSDT,long,1\n" }) : "{}" } : {};
  for (const [cookie, expected] of [["", 401], [other, 403]]) {
    const r = await fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, ...body });
    assert.equal(r.status, expected, path + " " + method);
    assert.match(r.headers.get("cache-control"), /no-store/);
  }
  if (method !== "GET") {
    const cross = await fetch(base + path, { method, headers: { Cookie: owner, Origin: "https://attacker.example", "Content-Type": "application/json" }, ...body });
    assert.equal(cross.status, 403, path + " cross-site");
  }
  const r = await fetch(base + path, { method, headers: { Cookie: owner, Origin: base, "Content-Type": "application/json" }, ...body });
  assert.equal(r.status, ownerStatus, path + " " + method + " owner");
  const result = await r.json();
  if (ownerStatus === 200) {
    assert.equal(result.adapter.status, "provider_unavailable");
    assert.match(result.adapter.reason, /13 February 2026/);
  } else assert.equal(result.code, "connection_storage_not_configured");
  gates.push(method + " " + path);
}
for (const [cookie, expected] of [["", 401], [other, 403], [owner, 200]]) {
  const r = await fetch(base + "/api/v1/capabilities", { headers: { Cookie: cookie } });
  assert.equal(r.status, expected);
  assert.match(r.headers.get("cache-control"), /no-store/);
  if (expected === 200) {
    const result = await r.json();
    assert.equal(result.mode, "disabled");
    assert.equal(result.capabilities.nativeCopyTrading.state, "UNVERIFIED");
    assert.equal(result.capabilities.futuresExecution.state, "BLOCKED");
  }
}
const ordinarySnapshots = await fetch(base + "/api/v1/ledger/snapshots", { headers: { Cookie: other } });
assert.equal(ordinarySnapshots.status, 403);
assert.equal((await ordinarySnapshots.json()).code, "owner_required");
const refreshedVerifier = await fetch(base + "/api/connections/bitget/verify", {
  method: "POST",
  headers: { Cookie: "gem_cc_access=expired-jwt; gem_cc_refresh=fixture-refresh", Origin: base, "Content-Type": "application/json" },
  body: "{}",
});
assert.equal(refreshedVerifier.status, 400);
assert.equal(refreshedVerifier.headers.getSetCookie().length, 2);
for (const path of [
  "/copy-center",
  "/copy-center?view=settings",
  "/copy-trading",
  "/automation",
  "/opportunities",
  "/advanced-btcc",
  "/purchase",
  "/steel",
  "/copy-center/positions",
]) {
  const r = await fetch(base + path, { redirect: "manual" });
  assert.equal(r.status, 307, path);
  assert.ok(r.headers.get("location").endsWith("/sign-in"));
  assert.match(r.headers.get("cache-control"), /no-store/);
}
assert.equal(
  (await fetch(base + "/api/auth/owner", { headers: { Cookie: owner } }))
    .status,
  200,
);
for (const path of ["/api/v1/live/execute", "/api/v1/purchase/execute"]) {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      Cookie: owner,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, "approval_ledger_not_ready");
}
const cross = await fetch(base + "/api/v1/live/execute", {
  method: "POST",
  headers: {
    Cookie: owner,
    Origin: "https://other.invalid",
    "Content-Type": "application/json",
  },
  body: "{}",
});
assert.equal(cross.status, 403);
assert.equal((await cross.json()).code, "cross_site");
const expired = await fetch(base + "/api/auth/owner", {
  headers: {
    Cookie: "gem_cc_access=expired-jwt; gem_cc_refresh=fixture-refresh",
  },
});
assert.equal(expired.status, 200);
const renewed = expired.headers.getSetCookie();
assert.equal(renewed.length, 2);
for (const cookie of renewed) {
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=lax/i);
}
const revoked = await fetch(base + "/api/auth/owner", {
  headers: {
    Cookie: "gem_cc_access=revoked-jwt; gem_cc_refresh=revoked-refresh",
  },
});
assert.equal(revoked.status, 401);
assert.ok(revoked.headers.getSetCookie().every((c) => /Max-Age=0/.test(c)));
const outage = await fetch(base + "/api/auth/owner", {
  headers: { Cookie: "gem_cc_access=outage-jwt" },
});
assert.equal(outage.status, 503);
assert.equal(outage.headers.getSetCookie().length, 0);
const fresh = await (
  await fetch(base + "/api/workspace", { headers: { Cookie: owner } })
).json();
const first = {
  workspace: { ...fresh.workspace, savedReviews: ["QA first session"] },
  expectedUpdatedAt: fresh.updatedAt,
};
const second = {
  workspace: { ...fresh.workspace, savedReviews: ["QA stale session"] },
  expectedUpdatedAt: fresh.updatedAt,
};
const save = (body) =>
  fetch(base + "/api/workspace", {
    method: "PUT",
    headers: {
      Cookie: owner,
      Origin: base,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
const saves = await Promise.all([save(first), save(second)]);
assert.deepEqual(saves.map((r) => r.status).sort(), [200, 409]);
const blind = await save({ workspace: fresh.workspace });
assert.equal(blind.status, 428);
const logout = await fetch(base + "/api/auth/logout", {
  method: "POST",
  headers: { Cookie: owner, Origin: base },
});
assert.equal(logout.status, 200);
assert.ok(logout.headers.getSetCookie().every((c) => /Max-Age=0/.test(c)));
console.log(
  JSON.stringify(
    {
      result: "PASS",
      mountedApiMethods: gates.length,
      pageRedirects: 9,
      checks: [
        "owner ACL",
        "ordinary-account denial",
        "CSRF rejection",
        "financial hard stop",
        "refresh cookies",
        "revoked session",
        "auth outage",
        "concurrent cloud save",
        "blind save rejection",
        "logout",
      ],
    },
    null,
    2,
  ),
);
