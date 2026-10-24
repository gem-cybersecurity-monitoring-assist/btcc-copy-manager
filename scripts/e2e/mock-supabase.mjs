// Local stand-in for Supabase Auth + PostgREST used only by scripts/e2e/copy-center-flow.cjs.
// Enforces per-user row ownership the way the RLS policies do. Never point a real deployment at it.
import http from "node:http";
const users = new Map(); // email -> {id,password,confirmed}
const tokens = new Map(); // access -> userId
const refresh = new Map(); // refresh -> userId
const rows = new Map(); // userId -> {payload, updated_at}
let n = 0;
const send = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const issue = (user) => { const a = "at-" + (++n), r = "rt-" + n; tokens.set(a, user.id); refresh.set(r, user.id); return { access_token: a, refresh_token: r, expires_in: 3600, user: { id: user.id, email: user.email } }; };
const authed = (req) => tokens.get((req.headers.authorization || "").replace("Bearer ", ""));
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  const json = body ? JSON.parse(body) : {};
  const url = new URL(req.url, "http://x");
  if (req.headers.apikey !== "anon-test-key") return send(res, 401, { message: "bad apikey" });
  if (url.pathname === "/__confirm") { const u = users.get(url.searchParams.get("email")); if (u) u.confirmed = true; return send(res, 200, { ok: true }); }
  if (url.pathname === "/auth/v1/signup") {
    if (users.has(json.email)) return send(res, 200, { id: "obf", identities: [] });
    const u = { id: crypto.randomUUID(), email: json.email, password: json.password, confirmed: false }; users.set(json.email, u);
    return send(res, 200, { id: u.id, email: u.email, confirmation_sent_at: new Date().toISOString(), identities: [{}], redirect_to: url.searchParams.get("redirect_to") });
  }
  if (url.pathname === "/auth/v1/resend") return send(res, 200, {});
  if (url.pathname === "/auth/v1/token") {
    if (url.searchParams.get("grant_type") === "password") {
      const u = users.get(json.email);
      if (!u || u.password !== json.password) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
      if (!u.confirmed) return send(res, 400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
      return send(res, 200, issue(u));
    }
    const id = refresh.get(json.refresh_token); if (!id) return send(res, 400, { error: "invalid_grant" });
    refresh.delete(json.refresh_token); return send(res, 200, issue([...users.values()].find((u) => u.id === id)));
  }
  if (url.pathname === "/auth/v1/user") { const id = authed(req); if (!id) return send(res, 401, { msg: "invalid JWT" }); const u = [...users.values()].find((x) => x.id === id); return send(res, 200, { id, email: u.email }); }
  if (url.pathname === "/auth/v1/logout") { tokens.delete((req.headers.authorization || "").replace("Bearer ", "")); res.writeHead(204); return res.end(); }
  if (url.pathname === "/rest/v1/copy_center_workspaces") {
    const id = authed(req); if (!id) return send(res, 401, { message: "JWT expired" });
    if (req.method === "GET") { const filter = url.searchParams.get("user_id")?.replace("eq.", ""); const row = filter === id ? rows.get(id) : undefined; return send(res, 200, row ? [row] : []); }
    if (json.user_id !== id) return send(res, 403, { message: "new row violates row-level security policy" });
    const row = { payload: json.payload, updated_at: json.updated_at }; rows.set(id, row); return send(res, 201, [row]);
  }
  send(res, 404, { message: "not found" });
}).listen(Number(process.env.MOCK_SUPABASE_PORT || 54321), () => console.log("mock supabase on 54321"));
