import { NextRequest, NextResponse } from "next/server";
export type CloudUser = { id: string; email?: string };
export type SupabaseTokens = { access_token: string; refresh_token: string; expires_in?: number; user?: CloudUser };
export type CloudSession = { user: CloudUser; accessToken: string; refreshed?: SupabaseTokens };
function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Cloud sync is not configured. Set SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel.");
  return { url, key };
}
export function cloudConfigured() { return Boolean(process.env.SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); }
export function setSessionCookies(response: NextResponse, tokens: SupabaseTokens) {
  const secure = process.env.NODE_ENV === "production";
  const maxAge = Math.max(60, Math.min(tokens.expires_in ?? 3600, 86400));
  response.cookies.set("gem_cc_access", tokens.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge });
  response.cookies.set("gem_cc_refresh", tokens.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 2592000 });
}
export function clearSessionCookies(response: NextResponse) {
  for (const name of ["gem_cc_access", "gem_cc_refresh"]) response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
}
export async function authRequest(path: string, init: RequestInit = {}) {
  const { url, key } = config();
  const response = await fetch(url + path, { ...init, cache: "no-store", headers: { apikey: key, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.msg === "string" ? data.msg : typeof data?.message === "string" ? data.message : typeof data?.error_description === "string" ? data.error_description : typeof data?.error === "string" ? data.error : "Authentication request failed.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return data;
}
export async function getCloudSession(request: NextRequest): Promise<CloudSession | null> {
  const accessToken = request.cookies.get("gem_cc_access")?.value;
  const refreshToken = request.cookies.get("gem_cc_refresh")?.value;
  if (!accessToken && !refreshToken) return null;
  if (accessToken) {
    try {
      const user = await authRequest("/auth/v1/user", { headers: { Authorization: "Bearer " + accessToken } });
      if (user?.id) return { user: { id: user.id, email: user.email }, accessToken };
    } catch { /* Refresh below when possible. */ }
  }
  if (!refreshToken) return null;
  try {
    const tokens = await authRequest("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: refreshToken }) }) as SupabaseTokens;
    if (!tokens.access_token || !tokens.refresh_token || !tokens.user?.id) return null;
    return { user: tokens.user, accessToken: tokens.access_token, refreshed: tokens };
  } catch { return null; }
}
export function applyRefreshedSession(response: NextResponse, session: CloudSession | null) { if (session?.refreshed) setSessionCookies(response, session.refreshed); }
export function safeErrorMessage(error: unknown) { return error instanceof Error ? error.message : "Unexpected server error."; }
