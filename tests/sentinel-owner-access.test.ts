import test from "node:test";
import assert from "node:assert/strict";
import { authorizeSentinelOwner } from "../lib/sentinel-access.ts";
import type { CloudService } from "../lib/cloud-core.ts";

const OWNER = "11223344-5566-4777-8899-aabbccddeeff";
const OTHER = "00000000-0000-4000-8000-000000000001";
const cookies = { access: "test-session" };
const makeService = (value: unknown) => ({ getSession: async () => value }) as Pick<CloudService, "getSession">;
const signedIn = (id: string) => ({
  state: "authenticated", session: { user: { id }, accessToken: "test-session" }, cookies: [],
});

test("anonymous and missing account service fail closed before lookup", async () => {
  let calls = 0;
  const service = { getSession: async () => { calls++; return signedIn(OWNER); } } as Pick<CloudService, "getSession">;
  assert.equal((await authorizeSentinelOwner(service, {}, OWNER)).result.status, 401);
  assert.equal(calls, 0);
  assert.equal((await authorizeSentinelOwner(null, cookies, OWNER)).result.status, 503);
});

test("an ordinary signed-in account cannot access the shared Sentinel", async () => {
  assert.equal((await authorizeSentinelOwner(makeService(signedIn(OTHER)), cookies, OWNER)).result.status, 403);
  assert.equal((await authorizeSentinelOwner(makeService(signedIn(OWNER)), cookies, undefined)).result.status, 503);
});

test("verified owner access requires an exact configured UUID", async () => {
  const good = await authorizeSentinelOwner(makeService(signedIn(OWNER)), cookies, OWNER.toUpperCase());
  assert.equal(good.allowed, true);
  assert.equal(good.result.status, 200);
  assert.equal((await authorizeSentinelOwner(makeService(signedIn(OWNER)), cookies, "not-a-uuid")).allowed, false);
});

test("identity outage and revoked session fail closed", async () => {
  assert.equal((await authorizeSentinelOwner(makeService({ state: "unavailable", cookies: [] }), cookies, OWNER)).result.status, 503);
  assert.equal((await authorizeSentinelOwner(makeService({ state: "anonymous", cookies: [] }), cookies, OWNER)).result.status, 401);
});
