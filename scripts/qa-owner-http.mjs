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
