import { NextRequest, NextResponse } from "next/server";
import { authRequest, safeErrorMessage, setSessionCookies, type SupabaseTokens } from "@/lib/cloud-auth";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password || password.length > 256) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    const tokens = await authRequest("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) }) as SupabaseTokens;
    if (!tokens.access_token || !tokens.refresh_token || !tokens.user?.id) return NextResponse.json({ error: "Sign-in did not return a valid session." }, { status: 401 });
    const response = NextResponse.json({ ok: true, user: { id: tokens.user.id, email: tokens.user.email } });
    setSessionCookies(response, tokens);
    return response;
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return NextResponse.json({ error: status === 400 || status === 401 ? "Email or password is incorrect, or email confirmation is required." : safeErrorMessage(error) }, { status: status >= 400 && status < 500 ? status : 500 });
  }
}
