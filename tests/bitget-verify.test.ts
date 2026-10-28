import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../app/api/connections/bitget/verify/route.ts";

test("Bitget verification requires an authenticated GEM session", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;
  const called: string[] = [];
  process.env.SUPABASE_URL = "https://project.example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    called.push(String(input));
    throw new Error("Should not call upstream without a session");
  }) as typeof fetch;
  try {
    const request = new NextRequest("https://btcc-copy-manager.vercel.app/api/connections/bitget/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://btcc-copy-manager.vercel.app" },
      body: JSON.stringify({ apiKey: "test-key", secret: "test-secret", passphrase: "test-passphrase" })
    });
    const response = await POST(request);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.match(body.error, /sign in/i);
    assert.deepEqual(called, []);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});

test("Bitget verification never echoes raw exchange errors", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;
  const called: string[] = [];
  process.env.SUPABASE_URL = "https://project.example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    called.push(url);
    if (url.includes("/auth/v1/user")) return new Response(JSON.stringify({ id: "11111111-1111-1111-1111-111111111111", email: "test@example.com" }), { status: 200, headers: { "content-type": "application/json" } });
    if (url === "https://api.bitget.com/api/v3/account/assets") return new Response(JSON.stringify({ code: "40009", msg: "PRIVATE UPSTREAM ERROR DETAILS" }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error("Unexpected upstream route");
  }) as typeof fetch;
  try {
    const request = new NextRequest("https://btcc-copy-manager.vercel.app/api/connections/bitget/verify", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://btcc-copy-manager.vercel.app", cookie: "gem_cc_access=test-access-token" },
      body: JSON.stringify({ apiKey: "test-key", secret: "test-secret", passphrase: "test-passphrase" })
    });
    const response = await POST(request);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.ok, false);
    assert.equal(JSON.stringify(body).includes("PRIVATE UPSTREAM ERROR DETAILS"), false);
    assert.equal(called.some((url) => url.includes("/api/v3/account/assets")), true);
    assert.equal(called.some((url) => /place-order|withdraw|transfer/i.test(url)), false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
  }
});
