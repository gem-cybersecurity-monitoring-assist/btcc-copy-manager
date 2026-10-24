import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_COOKIE,
  CloudService,
  REFRESH_COOKIE,
  createRateLimiter,
  describeAuthFailure,
  isJsonContentType,
  isSameOriginRequest,
  readCloudConfig,
  readConfirmationRedirect,
  validateCredentials,
} from "../lib/cloud-core.ts";

type Call = { url: string; init: RequestInit };
type Reply = { status: number; body?: unknown } | "network-error";

/** Mock Supabase: routes by path prefix and records every request. */
function mockSupabase(routes: Record<string, Reply | ((call: Call) => Reply)>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const path = url.replace("https://proj.supabase.co", "");
    const key = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    if (!key) throw new Error("Unexpected request " + path);
    const route = routes[key];
    const reply = typeof route === "function" ? route({ url, init }) : route;
    if (reply === "network-error") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status, headers: { "Content-Type": "application/json" } });
  };
  return { service: new CloudService({ url: "https://proj.supabase.co", key: "anon-key" }, fetchImpl), calls };
}

const USER_A = { id: "11111111-1111-1111-1111-111111111111", email: "a@example.com" };
const workspace = { traders: [], savedReviews: ["Alpha"], portfolioSnapshots: [] };
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name];

// ---- configuration ---------------------------------------------------------

test("config requires both URL and anon key and rejects non-https URLs", () => {
  assert.equal(readCloudConfig({}), null);
  assert.equal(readCloudConfig({ SUPABASE_URL: "https://x.supabase.co" }), null);
  assert.equal(readCloudConfig({ SUPABASE_URL: "http://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }), null);
  assert.equal(readCloudConfig({ SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" }), null);
  assert.deepEqual(readCloudConfig({ SUPABASE_URL: "https://x.supabase.co/", NEXT_PUBLIC_SUPABASE_ANON_KEY: " k " }), { url: "https://x.supabase.co", key: "k" });
});

// ---- credential validation and auth errors ---------------------------------

test("credential validation", () => {
  assert.equal(validateCredentials({ email: "bad", password: "x".repeat(12) }, "signup").ok, false);
  assert.equal(validateCredentials({ email: "a@example.com", password: "short" }, "signup").ok, false);
  assert.equal(validateCredentials({ email: "a@example.com", password: "x".repeat(257) }, "login").ok, false);
  assert.equal(validateCredentials(null, "login").ok, false);
  const ok = validateCredentials({ email: " A@Example.com ", password: "pw" }, "login");
  assert.equal(ok.ok && ok.email, "a@example.com");
});

test("auth failures map to safe, specific messages", () => {
  assert.equal(describeAuthFailure("login", { status: 400, code: "invalid_credentials", message: "Invalid login credentials" }).status, 401);
  assert.equal(describeAuthFailure("login", { status: 400, code: "email_not_confirmed" }).body.code, "email_not_confirmed");
  assert.equal(describeAuthFailure("signup", { status: 429, code: "over_email_send_rate_limit" }).body.code, "email_rate_limited");
  assert.equal(describeAuthFailure("signup", { status: 500, code: "unexpected_failure", message: "Error sending confirmation email" }).body.code, "email_send_failed");
  assert.equal(describeAuthFailure("signup", { status: 422, code: "weak_password" }).body.code, "weak_password");
  assert.equal(describeAuthFailure("signup", { status: 422, code: "user_already_exists" }).status, 409);
  assert.equal(describeAuthFailure("login", { status: 0 }).status, 503);
  // Unknown upstream text is never echoed back.
  const unknown = describeAuthFailure("signup", { status: 500, message: "db password=hunter2 at 10.0.0.1" });
  assert.equal(JSON.stringify(unknown.body).includes("hunter2"), false);
});

// ---- signup / email confirmation ------------------------------------------

test("signup with confirmation enabled does not claim the email was delivered", async () => {
  const { service, calls } = mockSupabase({ "/auth/v1/signup": { status: 200, body: { id: USER_A.id, email: USER_A.email, confirmation_sent_at: "2026-10-24T10:00:00Z", identities: [{}] } } });
  const result = await service.signup({ email: USER_A.email, password: "correct horse battery" }, "https://app.example/copy-trading");
  assert.equal(result.status, 200);
  assert.equal(result.body.needsEmailConfirmation, true);
  assert.equal(result.body.confirmationRequestedAt, "2026-10-24T10:00:00Z");
  assert.match(String(result.body.message), /not confirmed by this dashboard/);
  assert.equal(result.cookies, undefined, "no session cookies before confirmation");
  assert.match(calls[0].url, /redirect_to=https%3A%2F%2Fapp\.example%2Fcopy-trading/);
});

test("signup response for an existing address is indistinguishable from a new one", async () => {
  const fresh = mockSupabase({ "/auth/v1/signup": { status: 200, body: { id: USER_A.id, email: USER_A.email, identities: [{}] } } });
  const existing = mockSupabase({ "/auth/v1/signup": { status: 200, body: { id: "obfuscated", email: USER_A.email, identities: [] } } });
  const a = await fresh.service.signup({ email: USER_A.email, password: "correct horse battery" });
  const b = await existing.service.signup({ email: USER_A.email, password: "correct horse battery" });
  assert.deepEqual(a, b);
});

test("signup surfaces SMTP failure honestly", async () => {
  const { service } = mockSupabase({ "/auth/v1/signup": { status: 500, body: { code: 500, error_code: "unexpected_failure", msg: "Error sending confirmation email" } } });
  const result = await service.signup({ email: USER_A.email, password: "correct horse battery" });
  assert.equal(result.status, 502);
  assert.match(String(result.body.error), /no email was delivered/);
});

test("signup with confirmation disabled starts a session", async () => {
  const { service } = mockSupabase({ "/auth/v1/signup": { status: 200, body: { access_token: "at", refresh_token: "rt", expires_in: 3600, user: USER_A } } });
  const result = await service.signup({ email: USER_A.email, password: "correct horse battery" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.cookies?.map((c) => c.name), [ACCESS_COOKIE, REFRESH_COOKIE]);
});

test("resend does not reveal whether an address is registered", async () => {
  const { service } = mockSupabase({ "/auth/v1/resend": { status: 400, body: { error_code: "validation_failed" } } });
  const result = await service.resendConfirmation({ email: "nobody@example.com" });
  assert.equal(result.status, 200);
  const limited = mockSupabase({ "/auth/v1/resend": { status: 429, body: { error_code: "over_email_send_rate_limit" } } });
  assert.equal((await limited.service.resendConfirmation({ email: "a@example.com" })).status, 429);
});

// ---- login / session / logout ---------------------------------------------

test("login sets HttpOnly session cookies and never returns tokens in the body", async () => {
  const { service } = mockSupabase({ "/auth/v1/token": { status: 200, body: { access_token: "at", refresh_token: "rt", expires_in: 999999, user: USER_A } } });
  const result = await service.login({ email: USER_A.email, password: "pw" });
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.body).includes("rt"), false);
  assert.equal(result.cookies?.[0].maxAge, 86400, "access cookie lifetime is capped at one day");
});

test("login with wrong password returns 401 with a generic message", async () => {
  const { service } = mockSupabase({ "/auth/v1/token": { status: 400, body: { error: "invalid_grant", error_description: "Invalid login credentials" } } });
  const result = await service.login({ email: USER_A.email, password: "nope" });
  assert.equal(result.status, 401);
  assert.equal(result.cookies, undefined);
});

test("session refresh issues new cookies; invalid tokens clear cookies", async () => {
  const refreshed = mockSupabase({ "/auth/v1/user": { status: 401 }, "/auth/v1/token": { status: 200, body: { access_token: "at2", refresh_token: "rt2", user: USER_A } } });
  const ok = await refreshed.service.sessionStatus({ access: "expired", refresh: "rt" });
  assert.equal(ok.body.authenticated, true);
  assert.equal(ok.cookies?.[0].value, "at2");

  const invalid = mockSupabase({ "/auth/v1/user": { status: 401 }, "/auth/v1/token": { status: 400, body: { error: "invalid_grant" } } });
  const anon = await invalid.service.sessionStatus({ access: "bad", refresh: "bad" });
  assert.equal(anon.body.authenticated, false);
  assert.deepEqual(anon.cookies?.map((c) => c.maxAge), [0, 0]);
});

test("session keeps cookies when Supabase is unreachable", async () => {
  const { service } = mockSupabase({ "/auth/v1/user": "network-error" });
  const result = await service.sessionStatus({ access: "at", refresh: "rt" });
  assert.equal(result.body.authenticated, false);
  assert.ok(result.body.error);
  assert.deepEqual(result.cookies, []);
});

test("logout revokes the session upstream and clears cookies even if revocation fails", async () => {
  const { service, calls } = mockSupabase({ "/auth/v1/logout": "network-error" });
  const result = await service.logout({ access: "at", refresh: "rt" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.cookies?.map((c) => [c.name, c.maxAge]), [[ACCESS_COOKIE, 0], [REFRESH_COOKIE, 0]]);
  assert.equal(header(calls[0], "Authorization"), "Bearer at");
});

// ---- workspace authorization and ownership --------------------------------

test("workspace endpoints reject unauthenticated requests without calling the database", async () => {
  const { service, calls } = mockSupabase({});
  assert.equal((await service.getWorkspace({})).status, 401);
  assert.equal((await service.putWorkspace({}, JSON.stringify({ workspace }))).status, 401);
  assert.equal(calls.length, 0);
});

test("workspace read uses the user's JWT and filters by the verified user id", async () => {
  const { service, calls } = mockSupabase({
    "/auth/v1/user": { status: 200, body: USER_A },
    "/rest/v1/copy_center_workspaces": { status: 200, body: [{ payload: workspace, updated_at: "2026-10-24T00:00:00Z" }] },
  });
  const result = await service.getWorkspace({ access: "user-a-jwt" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.workspace, workspace);
  const db = calls[1];
  assert.match(db.url, new RegExp("user_id=eq\\." + USER_A.id));
  assert.equal(header(db, "Authorization"), "Bearer user-a-jwt");
  assert.equal(header(db, "apikey"), "anon-key");
});

test("workspace write takes the owner id from the session, not the request body", async () => {
  let written: any;
  const { service, calls } = mockSupabase({
    "/auth/v1/user": { status: 200, body: USER_A },
    "/rest/v1/copy_center_workspaces": (call) => { written = JSON.parse(String(call.init.body)); return { status: 201, body: [{ updated_at: "2026-10-24T01:00:00Z" }] }; },
  });
  const spoofed = JSON.stringify({ user_id: "22222222-2222-2222-2222-222222222222", workspace: { ...workspace, user_id: "evil" } });
  const result = await service.putWorkspace({ access: "user-a-jwt" }, spoofed);
  assert.equal(result.status, 200);
  assert.equal(written.user_id, USER_A.id);
  assert.equal("user_id" in written.payload, false, "unknown fields are stripped from the stored payload");
  assert.equal(header(calls[1], "Authorization"), "Bearer user-a-jwt");
});

test("workspace write validates the payload before touching auth or the database", async () => {
  const { service, calls } = mockSupabase({});
  assert.equal((await service.putWorkspace({ access: "x" }, "{oops")).status, 400);
  assert.equal((await service.putWorkspace({ access: "x" }, JSON.stringify({ workspace: { traders: [{ name: 1 }], savedReviews: [], portfolioSnapshots: [] } }))).status, 400);
  assert.equal((await service.putWorkspace({ access: "x" }, "x".repeat(750_001))).status, 413);
  assert.equal(calls.length, 0);
});

test("RLS denial and database outages produce safe errors", async () => {
  const denied = mockSupabase({ "/auth/v1/user": { status: 200, body: USER_A }, "/rest/v1/": { status: 403, body: { message: "new row violates row-level security policy for table copy_center_workspaces" } } });
  const result = await denied.service.putWorkspace({ access: "at" }, JSON.stringify({ workspace }));
  assert.equal(result.status, 403);
  assert.equal(JSON.stringify(result.body).includes("row-level"), false);

  const down = mockSupabase({ "/auth/v1/user": { status: 200, body: USER_A }, "/rest/v1/": "network-error" });
  assert.equal((await down.service.getWorkspace({ access: "at" })).status, 503);
});

test("missing and corrupt cloud workspaces are reported without changing local data", async () => {
  const missing = mockSupabase({ "/auth/v1/user": { status: 200, body: USER_A }, "/rest/v1/": { status: 200, body: [] } });
  const none = await missing.service.getWorkspace({ access: "at" });
  assert.equal(none.status, 200);
  assert.equal(none.body.workspace, null);

  const corrupt = mockSupabase({ "/auth/v1/user": { status: 200, body: USER_A }, "/rest/v1/": { status: 200, body: [{ payload: { traders: "nope" } }] } });
  assert.equal((await corrupt.service.getWorkspace({ access: "at" })).status, 422);
});

// ---- request guards --------------------------------------------------------

test("cross-site and non-JSON mutations are rejected", () => {
  const origin = "https://btcc-copy-manager.vercel.app";
  const hosts = ["localhost:3000", "btcc-copy-manager.vercel.app", null];
  assert.equal(isSameOriginRequest({ origin }, hosts), true, "public host behind a proxy is accepted");
  assert.equal(isSameOriginRequest({ origin, secFetchSite: "same-origin" }, ["btcc-copy-manager.vercel.app, internal"]), true);
  assert.equal(isSameOriginRequest({}, hosts), true);
  assert.equal(isSameOriginRequest({ origin: "https://evil.example" }, hosts), false);
  assert.equal(isSameOriginRequest({ origin: "https://btcc-copy-manager.vercel.app.evil.example" }, hosts), false);
  assert.equal(isSameOriginRequest({ origin: "null" }, hosts), false);
  assert.equal(isSameOriginRequest({ secFetchSite: "cross-site" }, hosts), false);
  assert.equal(isJsonContentType("application/json; charset=utf-8"), true);
  assert.equal(isJsonContentType("text/plain"), false);
  assert.equal(isJsonContentType(null), false);
});

test("rate limiter blocks after the limit and resets after the window", () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(limiter.check("ip").allowed, true);
  assert.equal(limiter.check("ip").allowed, true);
  assert.equal(limiter.check("ip").allowed, false);
  assert.equal(limiter.check("other").allowed, true);
  now = 1001;
  assert.equal(limiter.check("ip").allowed, true);
});

test("confirmation redirect parsing never needs the tokens", () => {
  assert.deepEqual(readConfirmationRedirect("#access_token=x&refresh_token=y&type=signup"), { kind: "confirmed" });
  assert.equal(readConfirmationRedirect("#error=access_denied&error_code=otp_expired")?.kind, "error");
  assert.equal(readConfirmationRedirect(""), null);
  assert.equal(readConfirmationRedirect("#exchanges"), null);
});
