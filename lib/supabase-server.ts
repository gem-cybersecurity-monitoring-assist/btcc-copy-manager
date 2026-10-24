import { NextRequest, NextResponse } from "next/server";

export type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  user?: { id: string; email?: string; [key: string]: unknown };
};

const ACCESS_COOKIE = "gem_copy_access";
const REFRESH_COOKIE = "gem_copy_refresh";

export function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    new URL(url);
  } catch {
    return null;
  }
  return { url, anonKey };
}

export function setSessionCookies(response: NextResponse, session: SupabaseSession) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_COOKIE, session.access_token, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: Math.max(60, Math.min(session.expires_in ?? 3600, 3600)),
  });
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, {
    httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}

export function requestHasValidOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}

export async function supabaseAuthRequest(path: string, body: unknown) {
  const config = getSupabaseConfig();
  if (!config) return { configured: false as const, response: null };
  const response = await fetch(`${config.url}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  return { configured: true as const, response };
}

export async function getAuthenticatedUser(request: NextRequest): Promise<{
  config: NonNullable<ReturnType<typeof getSupabaseConfig>>;
  accessToken: string;
  user: { id: string; email?: string; [key: string]: unknown };
  refreshedSession?: SupabaseSession;
} | null> {
  const config = getSupabaseConfig();
  if (!config) return null;
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  if (accessToken) {
    try {
      const response = await fetch(`${config.url}/auth/v1/user`, {
        headers: { apikey: config.anonKey, Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      if (response.ok) {
        const user = await response.json();
        if (typeof user?.id === "string") return { config, accessToken, user };
      }
    } catch {
      // Attempt a refresh below if a refresh token is available.
    }
  }

  if (!refreshToken) return null;
  try {
    const refreshed = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: config.anonKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: "no-store",
    });
    if (!refreshed.ok) return null;
    const session = await refreshed.json() as SupabaseSession;
    if (!session.access_token || !session.refresh_token || !session.user?.id) return null;
    return { config, accessToken: session.access_token, user: session.user, refreshedSession: session };
  } catch {
    return null;
  }
}

export function applyRefreshedSession(response: NextResponse, session?: SupabaseSession) {
  if (session) setSessionCookies(response, session);
  return response;
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
