import assert from "node:assert/strict";
import test from "node:test";
import { sentinelRequest } from "../src/lib/sentinel-client.ts";

// Synthetic transports only: no hosted service or real control token is used.
test("Sentinel transport accepts bounded JSON and locks redirect/cache/auth options", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(new Headers(init.headers).get("accept"), "application/json");
    return Response.json({ ok: true });
  });
  assert.deepEqual(await sentinelRequest("/health", { redirect: "follow", cache: "force-cache", headers: new Headers({ accept: "application/json" }) }), { ok: true });
});

test("Sentinel transport rejects declared and streamed oversized bodies", async (t) => {
  let cancelled = false;
  let mode = "declared";
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { if (mode === "streamed") controller.enqueue(new Uint8Array(1_048_577)); },
    cancel() { cancelled = true; },
  }), { headers: mode === "declared" ? { "content-length": "1048577" } : {} }));
  await assert.rejects(sentinelRequest("/health"), /exceeds the supported size/);
  assert.equal(cancelled, true);
  cancelled = false;
  mode = "streamed";
  await assert.rejects(sentinelRequest("/health"), /exceeds the supported size/);
  assert.equal(cancelled, true);
});

test("Sentinel transport never echoes upstream errors or invalid JSON", async (t) => {
  let mode = "status";
  t.mock.method(globalThis, "fetch", async () => {
    if (mode === "status") return new Response("private-upstream-body", { status: 503 });
    if (mode === "json") return new Response("private-invalid-json");
    throw new Error("private-upstream-network-error");
  });
  for (const value of ["status", "json", "network"]) {
    mode = value;
    await assert.rejects(sentinelRequest("/health"), (error: Error) => {
      assert.doesNotMatch(error.message, /private-/);
      return true;
    });
  }
});

test("Sentinel transport rejects malformed internal paths before fetch", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({}); });
  for (const path of ["//other.example/health", "https://other.example/health", "/health?token=x", "/health#fragment", "/health\\elsewhere"])
    await assert.rejects(sentinelRequest(path), /Invalid Sentinel request path/);
  assert.equal(calls, 0);
});

test("Sentinel transport sanitizes streaming failures", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({
    start(controller) { controller.error(new Error("private-stream-content")); },
  })));
  await assert.rejects(sentinelRequest("/health"), /^Error: Sentinel response could not be read\.$/);
});

test("Sentinel transport preserves server control headers with Headers input", async (t) => {
  const original = process.env.SENTINEL_CONTROL_TOKEN;
  process.env.SENTINEL_CONTROL_TOKEN = "synthetic-control-token";
  t.after(() => {
    if (original === undefined) delete process.env.SENTINEL_CONTROL_TOKEN;
    else process.env.SENTINEL_CONTROL_TOKEN = original;
  });
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), "Bearer synthetic-control-token");
    assert.equal(headers.get("x-sentinel-control"), "synthetic-control-token");
    return Response.json({ ok: true });
  });
  await sentinelRequest("/health", { headers: new Headers({ authorization: "wrong", "x-sentinel-control": "wrong" }) });
});
