import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("service-worker activation removes legacy response caches and preserves unrelated caches", async () => {
  const handlers: Record<string, Function> = {};
  const names = new Set(["btcc-live-manager-v2", "btcc-live-manager-v1", "unrelated"]);
  let claimed = 0, skipped = 0;
  vm.runInNewContext(source, {
    self: { addEventListener: (name: string, fn: Function) => handlers[name] = fn, skipWaiting: async () => skipped++, clients: { claim: async () => claimed++ } },
    caches: { keys: async () => [...names], delete: async (name: string) => names.delete(name) },
  });
  let pending: Promise<unknown>;
  handlers.install({ waitUntil: (promise: Promise<unknown>) => pending = promise }); await pending!;
  handlers.activate({ waitUntil: (promise: Promise<unknown>) => pending = promise }); await pending!;
  assert.equal(skipped, 1); assert.equal(claimed, 1);
  assert.deepEqual([...names], ["unrelated"]);
});
test("authenticated responses are network-only and offline failures never reveal cached data", async () => {
  const handlers: Record<string, Function> = {};
  let offline = false;
  const calls: unknown[] = [];
  const response = { body: "private-workspace" };
  vm.runInNewContext(source, {
    self: { addEventListener: (name: string, fn: Function) => handlers[name] = fn },
    caches: new Proxy({}, { get() { throw Error("fetch must never consult or populate the response cache"); } }),
    fetch: async (request: unknown, options: unknown) => { calls.push({ request, options }); if (offline) throw Error("offline"); return response; },
  });
  let pending: Promise<unknown>;
  const request = { url: "https://app.test/api/workspace", method: "GET" };
  handlers.fetch({ request, respondWith: (promise: Promise<unknown>) => pending = promise });
  assert.equal(await pending!, response);
  assert.equal((calls[0] as any).options.cache, "no-store");
  offline = true;
  handlers.fetch({ request, respondWith: (promise: Promise<unknown>) => pending = promise });
  await assert.rejects(pending!, /offline/);
});
