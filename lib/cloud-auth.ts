// Next.js adapter for lib/cloud-core.ts: reads cookies/headers, applies request guards,
// and writes results (including HttpOnly session cookies) to NextResponse.
import { NextRequest, NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  CloudService,
  REFRESH_COOKIE,
  createRateLimiter,
  isJsonContentType,
  isSameOriginRequest,
  readCloudConfig,
  type Result,
  type SessionCookies,
} from "./cloud-core.ts";

const NO_STORE = { "Cache-Control": "no-store" };

export function cloudService(): CloudService | null {
  const config = readCloudConfig(process.env);
  return config ? new CloudService(config) : null;
}

export function notConfigured() {
  return NextResponse.json(
    { configured: false, authenticated: false, error: "Cloud sync is not configured yet. Set SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see CLOUD_SETUP.md).", code: "not_configured" },
    { status: 503, headers: NO_STORE },
  );
}

export function sessionCookiesFrom(request: NextRequest): SessionCookies {
  return { access: request.cookies.get(ACCESS_COOKIE)?.value, refresh: request.cookies.get(REFRESH_COOKIE)?.value };
}

export function toResponse(result: Result, extraHeaders: Record<string, string> = {}) {
  const response = NextResponse.json(result.body, { status: result.status, headers: { ...NO_STORE, ...extraHeaders } });
  const secure = process.env.NODE_ENV === "production";
  for (const cookie of result.cookies ?? []) {
    response.cookies.set(cookie.name, cookie.value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: cookie.maxAge });
  }
  return response;
}

const limiters = {
  auth: createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
  email: createRateLimiter({ limit: 3, windowMs: 15 * 60 * 1000 }),
  workspace: createRateLimiter({ limit: 60, windowMs: 10 * 60 * 1000 }),
  agent: createRateLimiter({ limit: 40, windowMs: 10 * 60 * 1000 }),
};

function clientKey(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/**
 * Guards for state-changing requests: same-origin only, JSON body required (blocks HTML-form CSRF),
 * and a per-client rate limit. Returns a response when the request must be rejected.
 */
export function guardMutation(request: NextRequest, bucket: keyof typeof limiters, options: { requireJson?: boolean } = {}) {
  const allowedHosts = [request.nextUrl.host, request.headers.get("host"), request.headers.get("x-forwarded-host")];
  if (!isSameOriginRequest({ origin: request.headers.get("origin"), secFetchSite: request.headers.get("sec-fetch-site") }, allowedHosts)) {
    return toResponse({ status: 403, body: { error: "Cross-site requests are not allowed.", code: "cross_site" } });
  }
  if (options.requireJson !== false && !isJsonContentType(request.headers.get("content-type"))) {
    return toResponse({ status: 415, body: { error: "Requests must use Content-Type: application/json.", code: "unsupported_media_type" } });
  }
  const limit = limiters[bucket].check(bucket + ":" + clientKey(request));
  if (!limit.allowed) {
    return toResponse({ status: 429, body: { error: "Too many requests. Wait a few minutes and try again.", code: "rate_limited" } }, { "Retry-After": String(limit.retryAfterSeconds) });
  }
  return null;
}

const MAX_AUTH_BODY = 16_384;

/** Parses a small JSON body (auth routes). Oversized or malformed bodies yield null and fail validation. */
export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    const text = await request.text();
    if (text.length > MAX_AUTH_BODY) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Where Supabase confirmation links should send the user. Must be in the Supabase redirect allow-list. */
export function confirmationRedirect(request: NextRequest) {
  const configured = process.env.COPY_CENTER_SITE_URL?.trim().replace(/\/+$/, "");
  return (configured || request.nextUrl.origin) + "/copy-center";
}
