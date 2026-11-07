import assert from "node:assert/strict";
import test from "node:test";
import { CloudService } from "../lib/cloud-core.ts";

const owner = "11111111-1111-4111-8111-111111111111";
const workspace = { traders: [], savedReviews: [], portfolioSnapshots: [] };
const initial = "2026-11-07T12:00:00.123456+00:00";
function fixture(options: { version?: string | null; unavailable?: boolean; denied?: boolean } = {}) {
  let version: string | null = options.version === undefined ? initial : options.version;
  let stored: unknown = workspace;
  const writes: { method: string; query: URLSearchParams; body: Record<string, unknown> }[] = [];
  const service = new CloudService({ url: "https://project.supabase.co", key: "public-key" }, async (url, init = {}) => {
    if (url.endsWith("/auth/v1/user")) return Response.json({ id: owner });
    const body = JSON.parse(String(init.body));
    const method = init.method!;
    const query = new URL(url).searchParams;
    writes.push({ method, query, body });
    if (options.unavailable) throw new Error("private upstream details");
    if (options.denied) return Response.json({ detail: "private database error" }, { status: 403 });
    if (method === "POST" && version !== null) return Response.json({ code: "23505" }, { status: 409 });
    if (method === "PATCH" && query.get("updated_at") !== "eq." + version) return Response.json([]);
    stored = body.payload;
    version = String(body.updated_at);
    return Response.json([{ updated_at: version }], { status: method === "POST" ? 201 : 200 });
  });
  return { service, writes, version: () => version, stored: () => stored };
}
test("two saves of the same revision cannot both overwrite the cloud", async () => {
  const f = fixture();
  const first = JSON.stringify({ workspace, expectedUpdatedAt: initial });
  const changed = { ...workspace, copyCenter: { budget: "20", maxLoss: "2", activity: [] } };
  const second = JSON.stringify({ workspace: changed, expectedUpdatedAt: initial });
  const result = await Promise.all([f.service.putWorkspace({ access: "jwt" }, first), f.service.putWorkspace({ access: "jwt" }, second)]);
  assert.deepEqual(result.map(r => r.status).sort(), [200, 409]);
  assert.deepEqual(f.stored(), workspace);
  assert.equal(f.writes[0].method, "PATCH");
  assert.equal(f.writes[0].query.get("user_id"), "eq." + owner);
  assert.equal(f.writes[0].query.get("updated_at"), "eq." + initial);
  assert.equal("user_id" in f.writes[0].body, false);
});
test("two first saves race safely without upserting over each other", async () => {
  const f = fixture({ version: null });
  const body = JSON.stringify({ workspace, expectedUpdatedAt: null, user_id: "attacker" });
  const results = await Promise.all([f.service.putWorkspace({ access: "jwt" }, body), f.service.putWorkspace({ access: "jwt" }, body)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.writes[0].method, "POST");
  assert.equal(f.writes[0].body.user_id, owner);
  assert.equal(f.writes[0].query.has("on_conflict"), false);
});
test("blind saves and invalid revisions never write to the database", async () => {
  const f = fixture();
  assert.equal((await f.service.putWorkspace({ access: "jwt" }, JSON.stringify({ workspace }))).status, 428);
  for (const expectedUpdatedAt of ["invalid", "", 42, {}, "eq.some-filter"]) {
    assert.equal((await f.service.putWorkspace({ access: "jwt" }, JSON.stringify({ workspace, expectedUpdatedAt }))).status, 400);
  }
  assert.equal(f.writes.length, 0);
});
test("revision advances even when the server clock is behind the previous save", async () => {
  const f = fixture();
  const result = await f.service.putWorkspace({ access: "jwt" }, JSON.stringify({ workspace, expectedUpdatedAt: initial }), new Date("2026-11-01"));
  assert.equal(result.status, 200);
  assert.ok(Date.parse(f.version()!) > Date.parse(initial));
  const next = await f.service.putWorkspace({ access: "jwt" }, JSON.stringify({ workspace, expectedUpdatedAt: f.version() }));
  assert.equal(next.status, 200);
});
test("outages and forbidden writes do not pretend a save succeeded or leak private errors", async () => {
  for (const options of [{ unavailable: true }, { denied: true }]) {
    const f = fixture(options);
    const result = await f.service.putWorkspace({ access: "jwt" }, JSON.stringify({ workspace, expectedUpdatedAt: initial }));
    assert.equal(result.status, options.unavailable ? 503 : 403);
    assert.equal(f.version(), initial);
    assert.ok(!JSON.stringify(result.body).includes("private"));
  }
});
test("anonymous saves never contact auth or storage", async () => {
  const f = fixture();
  assert.equal((await f.service.putWorkspace({}, JSON.stringify({ workspace, expectedUpdatedAt: null }))).status, 401);
  assert.equal(f.writes.length, 0);
});
