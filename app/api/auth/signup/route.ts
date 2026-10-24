import { NextRequest, NextResponse } from "next/server";
import { authRequest, safeErrorMessage, setSessionCookies, type SupabaseTokens } from "../../../../lib/cloud-auth";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || password.length < 12 || password.length > 256) return NextResponse.json({ error: "Enter a valid email and a password between 12 and 256 characters." }, { status: 400 });
    const result = await authRequest("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email, password }) }) as SupabaseTokens;
    if (!result.access_token || !result.refresh_token || !result.user?.id) return NextResponse.json({ ok: true, needsEmailConfirmation: true, message: "Check your email to confirm your account, then sign in." });
    const response = NextResponse.json({ ok: true, user: { id: result.user.id, email: result.user.email } });
    setSessionCookies(response, result);
    return response;
  } catch (error) {
    const status = typeof error === "object" && error && "status" in error && typeof error.status === "number" ? error.status : 500;
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: status >= 400 && status < 500 ? status : 500 });
  }
}
