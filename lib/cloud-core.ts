// Framework-free Supabase Auth + workspace logic for GEM Copy Center.
// The Next.js route handlers in app/api are thin adapters around this module,
// which keeps the security-relevant behaviour unit-testable with a mocked fetch.
//
// Security rules enforced here:
// - Only the Supabase project URL and the public anon/publishable key are used. Never a service-role key.
// - Database calls carry the signed-in user's JWT, so Postgres row-level security decides access.
// - The workspace owner id always comes from the verified Supabase session, never from the request body.
// - Passwords and tokens are never logged or echoed back to the browser.

import { LIMITS, parseWorkspace, type Workspace } from "./workspace.ts";

export const ACCESS_COOKIE = "gem_cc_access";
export const REFRESH_COOKIE = "gem_cc_refresh";
export const REFRESH_MAX_AGE = 60 * 60 * 24 * 30;

export type CloudConfig = { url: string; key: string };
export type CloudUser = { id: string; email?: string };
export type CookieOp = { name: string; value: string; maxAge: number };
export type Result = { status: number; body: Record<string, unknown>; cookies?: CookieOp[] };
export type SessionCookies = { access?: string; refresh?: string };
export type Session = { user: CloudUser; accessToken: string };
export type SessionLookup =
  | { state: "anonymous"; cookies: CookieOp[] }
  | { state: "authenticated"; session: Session; cookies: CookieOp[] }
  | { state: "unavailable"; cookies: CookieOp[] };

type Tokens = { access_token?: string; refresh_token?: string; expires_in?: number; user?: { id?: string; email?: string } };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readCloudConfig(env: Record<string, string | undefined>): CloudConfig | null {
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return null;
  } catch {
    return null;
  }
  return { url, key };
}

export function sessionCookies(tokens: { access_token: string; refresh_token: string; expires_in?: number }): CookieOp[] {
  const accessMaxAge = Math.max(60, Math.min(tokens.expires_in ?? 3600, 86400));
  return [
    { name: ACCESS_COOKIE, value: tokens.access_token, maxAge: accessMaxAge },
    { name: REFRESH_COOKIE, value: tokens.refresh_token, maxAge: REFRESH_MAX_AGE },
  ];
}

export function clearedCookies(): CookieOp[] {
  return [ACCESS_COOKIE, REFRESH_COOKIE].map((name) => ({ name, value: "", maxAge: 0 }));
}

export type AuthFailure = { status: number; code?: string; message?: string };

/**
 * Converts a Supabase Auth failure into a safe, actionable message. Raw upstream text is only
 * passed through for known-safe validation errors; everything else gets a fixed message.
 */
export function describeAuthFailure(context: "signup" | "login" | "resend" | "session", failure: AuthFailure): Result {
  const code = failure.code ?? "";
  const text = (failure.message ?? "").toLowerCase();
  if (failure.status === 0) return { status: 503, body: { error: "The authentication service could not be reached. Check your connection and try again.", code: "auth_unreachable" } };
  if (failure.status === 429 || code.startsWith("over_") || text.includes("rate limit")) {
    const emailLimit = code === "over_email_send_rate_limit" || text.includes("email rate limit");
    return { status: 429, body: { error: emailLimit
      ? "The email-sending limit for this project has been reached. Wait before requesting another email; if this keeps happening the project needs a custom SMTP provider."
      : "Too many attempts. Wait a few minutes and try again.", code: emailLimit ? "email_rate_limited" : "rate_limited" } };
  }
  if (code === "email_not_confirmed" || text.includes("email not confirmed")) {
    return { status: 403, body: { error: "This email address has not been confirmed yet. Open the confirmation link from your inbox, or request a new confirmation email.", code: "email_not_confirmed" } };
  }
  if (context === "login" && (failure.status === 400 || failure.status === 401 || code === "invalid_credentials")) {
    return { status: 401, body: { error: "Email or password is incorrect.", code: "invalid_credentials" } };
  }
  if (context === "signup" && (code === "user_already_exists" || code === "email_exists" || text.includes("already registered"))) {
    return { status: 409, body: { error: "An account with this email already exists. Sign in instead, or request a new confirmation email.", code: "user_exists" } };
  }
  if (code === "weak_password" || text.includes("password should") || text.includes("pwned") || text.includes("weak")) {
    return { status: 422, body: { error: "This password was rejected by the account service as too weak or previously leaked. Choose a different, longer password.", code: "weak_password" } };
  }
  if (code === "signup_disabled" || text.includes("signups not allowed")) {
    return { status: 403, body: { error: "New account registration is currently disabled for this workspace.", code: "signup_disabled" } };
  }
  if (code === "email_address_invalid" || code === "email_address_not_authorized" || text.includes("not authorized")) {
    return { status: 422, body: { error: "The account service cannot send email to this address. The project's email provider may be restricted to team members until custom SMTP is configured.", code: "email_not_authorized" } };
  }
  if (failure.status >= 500 && (text.includes("sending") || text.includes("smtp") || text.includes("email"))) {
    return { status: 502, body: { error: "Your account request reached the server, but the confirmation email could not be sent. The project's email (SMTP) configuration needs attention; no email was delivered.", code: "email_send_failed" } };
  }
  if (failure.status >= 400 && failure.status < 500) {
    return { status: 400, body: { error: "The account service rejected the request. Check the email address and password and try again.", code: "auth_rejected" } };
  }
  return { status: 502, body: { error: "The authentication service returned an unexpected error. Try again later.", code: "auth_upstream_error" } };
}

export function validateCredentials(body: unknown, mode: "signup" | "login"): { ok: true; email: string; password: string } | { ok: false; result: Result } {
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const password = typeof record.password === "string" ? record.password : "";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) return { ok: false, result: { status: 400, body: { error: "Enter a valid email address.", code: "invalid_email" } } };
  if (mode === "signup" && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
    return { ok: false, result: { status: 400, body: { error: `Use a password between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`, code: "invalid_password" } } };
  }
  if (mode === "login" && (!password || password.length > PASSWORD_MAX)) {
    return { ok: false, result: { status: 400, body: { error: "Enter your password.", code: "invalid_password" } } };
  }
  return { ok: true, email, password };
}

export class CloudService {
  private readonly config: CloudConfig;
  private readonly fetchImpl: FetchLike;

  // Explicit fields (not parameter properties) so Node's type-stripping test runner can load this file.
  constructor(config: CloudConfig, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private async call(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
    try {
      const response = await this.fetchImpl(this.config.url + path, {
        ...init,
        cache: "no-store",
        headers: { apikey: this.config.key, "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
      });
      const data = await response.json().catch(() => ({}));
      return { ok: response.ok, status: response.status, data };
    } catch {
      return { ok: false, status: 0, data: {} };
    }
  }

  private static failure(status: number, data: any): AuthFailure {
    const code = typeof data?.error_code === "string" ? data.error_code : typeof data?.error === "string" ? data.error : undefined;
    const message = [data?.msg, data?.message, data?.error_description].find((v) => typeof v === "string");
    return { status, code, message };
  }

  async getSession(cookies: SessionCookies): Promise<SessionLookup> {
    if (!cookies.access && !cookies.refresh) return { state: "anonymous", cookies: [] };
    let upstreamDown = false;
    if (cookies.access) {
      const user = await this.call("/auth/v1/user", { headers: { Authorization: "Bearer " + cookies.access } });
      if (user.ok && typeof user.data?.id === "string") {
        return { state: "authenticated", session: { user: { id: user.data.id, email: user.data.email }, accessToken: cookies.access }, cookies: [] };
      }
      if (user.status === 0 || user.status >= 500) upstreamDown = true;
    }
    if (cookies.refresh && !upstreamDown) {
      const refreshed = await this.call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: cookies.refresh }) });
      const tokens = refreshed.data as Tokens;
      if (refreshed.ok && tokens.access_token && tokens.refresh_token && typeof tokens.user?.id === "string") {
        return {
          state: "authenticated",
          session: { user: { id: tokens.user.id, email: tokens.user.email }, accessToken: tokens.access_token },
          cookies: sessionCookies({ access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expires_in }),
        };
      }
      if (refreshed.status === 0 || refreshed.status >= 500) upstreamDown = true;
    }
    // Keep cookies when Supabase is temporarily unreachable; clear them when they are definitively invalid.
    if (upstreamDown) return { state: "unavailable", cookies: [] };
    return { state: "anonymous", cookies: clearedCookies() };
  }

  async sessionStatus(cookies: SessionCookies): Promise<Result> {
    const lookup = await this.getSession(cookies);
    if (lookup.state === "unavailable") {
      return { status: 200, body: { configured: true, authenticated: false, user: null, error: "The authentication service could not be reached. Your browser-local records still work." }, cookies: lookup.cookies };
    }
    const user = lookup.state === "authenticated" ? { id: lookup.session.user.id, email: lookup.session.user.email } : null;
    return { status: 200, body: { configured: true, authenticated: Boolean(user), user }, cookies: lookup.cookies };
  }

  async signup(body: unknown, redirectTo?: string): Promise<Result> {
    const creds = validateCredentials(body, "signup");
    if (!creds.ok) return creds.result;
    const query = redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : "";
    const result = await this.call("/auth/v1/signup" + query, { method: "POST", body: JSON.stringify({ email: creds.email, password: creds.password }) });
    if (!result.ok) return describeAuthFailure("signup", CloudService.failure(result.status, result.data));
    const data = result.data as Tokens & { confirmation_sent_at?: string };
    if (data.access_token && data.refresh_token && typeof data.user?.id === "string") {
      // Email confirmation is disabled for this project: Supabase returned a live session.
      return { status: 200, body: { ok: true, user: { id: data.user.id, email: data.user.email } }, cookies: sessionCookies(data as { access_token: string; refresh_token: string; expires_in?: number }) };
    }
    // Supabase answers an already-registered address with an obfuscated look-alike user (and sends no
    // email) to prevent account enumeration. Keep the response identical for both cases.
    const confirmationSentAt = typeof data.confirmation_sent_at === "string" ? data.confirmation_sent_at : null;
    return {
      status: 200,
      body: {
        ok: true,
        needsEmailConfirmation: true,
        confirmationRequestedAt: confirmationSentAt,
        message: "Sign-up request accepted. If this address is new, the account service has been asked to send a confirmation email. "
          + "Delivery is not confirmed by this dashboard: check your inbox and spam folder. If nothing arrives within a few minutes, request a new confirmation email or try signing in if you already have an account.",
      },
    };
  }

  async login(body: unknown): Promise<Result> {
    const creds = validateCredentials(body, "login");
    if (!creds.ok) return creds.result;
    const result = await this.call("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: creds.email, password: creds.password }) });
    if (!result.ok) return describeAuthFailure("login", CloudService.failure(result.status, result.data));
    const tokens = result.data as Tokens;
    if (!tokens.access_token || !tokens.refresh_token || typeof tokens.user?.id !== "string") {
      return { status: 502, body: { error: "Sign-in did not return a valid session.", code: "invalid_session" } };
    }
    return { status: 200, body: { ok: true, user: { id: tokens.user.id, email: tokens.user.email } }, cookies: sessionCookies(tokens as { access_token: string; refresh_token: string; expires_in?: number }) };
  }

  async resendConfirmation(body: unknown, redirectTo?: string): Promise<Result> {
    const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
    const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
    if (!EMAIL_PATTERN.test(email) || email.length > 254) return { status: 400, body: { error: "Enter a valid email address.", code: "invalid_email" } };
    const query = redirectTo ? "?redirect_to=" + encodeURIComponent(redirectTo) : "";
    const result = await this.call("/auth/v1/resend" + query, { method: "POST", body: JSON.stringify({ type: "signup", email }) });
    if (!result.ok) {
      const failure = describeAuthFailure("resend", CloudService.failure(result.status, result.data));
      // Avoid revealing whether an address is registered: only surface rate-limit/delivery/service problems.
      if (failure.status === 400) return { status: 200, body: { ok: true, message: "If this address has an unconfirmed account, a new confirmation email has been requested." } };
      return failure;
    }
    return { status: 200, body: { ok: true, message: "If this address has an unconfirmed account, a new confirmation email has been requested. Delivery is not confirmed by this dashboard; check your inbox and spam folder." } };
  }

  async logout(cookies: SessionCookies): Promise<Result> {
    if (cookies.access) {
      // Best effort: revoke this refresh-token session at Supabase. Cookies are cleared regardless.
      await this.call("/auth/v1/logout?scope=local", { method: "POST", headers: { Authorization: "Bearer " + cookies.access } });
    }
    return { status: 200, body: { ok: true }, cookies: clearedCookies() };
  }

  private async requireSession(cookies: SessionCookies, action: string): Promise<{ session: Session; cookies: CookieOp[] } | Result> {
    const lookup = await this.getSession(cookies);
    if (lookup.state === "authenticated") return { session: lookup.session, cookies: lookup.cookies };
    if (lookup.state === "unavailable") return { status: 503, body: { error: "The authentication service could not be reached. Try again shortly.", code: "auth_unreachable" } };
    return { status: 401, body: { error: `Sign in to ${action} your cloud workspace.`, code: "not_authenticated" }, cookies: lookup.cookies };
  }

  async getWorkspace(cookies: SessionCookies): Promise<Result> {
    const auth = await this.requireSession(cookies, "access");
    if ("status" in auth) return auth;
    const { session } = auth;
    const result = await this.call(
      "/rest/v1/copy_center_workspaces?select=payload,updated_at&user_id=eq." + encodeURIComponent(session.user.id) + "&limit=1",
      { headers: { Authorization: "Bearer " + session.accessToken } },
    );
    if (!result.ok || !Array.isArray(result.data)) {
      return { status: result.status === 0 ? 503 : 502, body: { error: "The cloud workspace could not be read. Your browser-local records were not changed.", code: "workspace_read_failed" }, cookies: auth.cookies };
    }
    const row = result.data[0];
    if (!row) return { status: 200, body: { ok: true, workspace: null, updatedAt: null }, cookies: auth.cookies };
    const parsed = parseWorkspace(row.payload);
    if (!parsed.ok) {
      return { status: 422, body: { error: `The stored cloud workspace is not in a valid format (${parsed.error}). Your browser-local records were not changed.`, code: "workspace_invalid" }, cookies: auth.cookies };
    }
    return { status: 200, body: { ok: true, workspace: parsed.value, updatedAt: row.updated_at ?? null }, cookies: auth.cookies };
  }

  async putWorkspace(cookies: SessionCookies, rawBody: string, now = new Date()): Promise<Result> {
    if (new TextEncoder().encode(rawBody).byteLength > LIMITS.maxBytes) {
      return { status: 413, body: { error: "Workspace backup is too large (maximum 750 KB).", code: "payload_too_large" } };
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { status: 400, body: { error: "Request body must be valid JSON.", code: "invalid_json" } };
    }
    const parsed = parseWorkspace((body as { workspace?: unknown } | null)?.workspace);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error, code: "invalid_workspace" } };
    const auth = await this.requireSession(cookies, "save");
    if ("status" in auth) return auth;
    const { session } = auth;
    const workspace: Workspace = parsed.value;
    const result = await this.call("/rest/v1/copy_center_workspaces?on_conflict=user_id", {
      method: "POST",
      headers: { Authorization: "Bearer " + session.accessToken, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ user_id: session.user.id, payload: workspace, updated_at: now.toISOString() }),
    });
    if (!result.ok) {
      const denied = result.status === 401 || result.status === 403;
      return {
        status: result.status === 0 ? 503 : denied ? 403 : 502,
        body: { error: denied ? "The database refused this workspace write for your account." : "The cloud workspace could not be saved. Try again later.", code: denied ? "workspace_forbidden" : "workspace_write_failed" },
        cookies: auth.cookies,
      };
    }
    const updatedAt = Array.isArray(result.data) && typeof result.data[0]?.updated_at === "string" ? result.data[0].updated_at : now.toISOString();
    return { status: 200, body: { ok: true, updatedAt }, cookies: auth.cookies };
  }
}

// ---- Request guards -------------------------------------------------------

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin on cross-site POST/PUT,
 * so a present-but-different Origin is refused; Sec-Fetch-Site is used as a second signal.
 */
export function isSameOriginRequest(headers: { origin?: string | null; secFetchSite?: string | null }, allowedHosts: Array<string | null | undefined>) {
  if (headers.secFetchSite && !["same-origin", "none"].includes(headers.secFetchSite)) return false;
  if (!headers.origin) return true;
  try {
    const originHost = new URL(headers.origin).host.toLowerCase();
    return allowedHosts.some((host) => typeof host === "string" && host.split(",")[0].trim().toLowerCase() === originHost);
  } catch {
    return false;
  }
}

export function isJsonContentType(contentType: string | null | undefined) {
  return Boolean(contentType && contentType.split(";")[0].trim().toLowerCase() === "application/json");
}

/** Small fixed-window limiter. In-memory, so it is best-effort per serverless instance; Supabase applies its own limits too. */
export function createRateLimiter(options: { limit: number; windowMs: number; now?: () => number }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const now = options.now ?? Date.now;
  return {
    check(key: string): { allowed: boolean; retryAfterSeconds: number } {
      const time = now();
      if (buckets.size > 5000) for (const [k, b] of buckets) if (b.resetAt <= time) buckets.delete(k);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= time) {
        buckets.set(key, { count: 1, resetAt: time + options.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      bucket.count += 1;
      return { allowed: bucket.count <= options.limit, retryAfterSeconds: Math.ceil((bucket.resetAt - time) / 1000) };
    },
  };
}

/** Reads the result of a Supabase email-confirmation redirect (URL fragment) without trusting or storing tokens from it. */
export function readConfirmationRedirect(hash: string): { kind: "confirmed" } | { kind: "error"; message: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("error") || params.get("error_code")) {
    const code = params.get("error_code") ?? params.get("error") ?? "";
    if (code === "otp_expired") return { kind: "error", message: "This confirmation link has expired or was already used. Request a new confirmation email, or sign in if you already confirmed." };
    return { kind: "error", message: "The confirmation link could not be verified. Request a new confirmation email and use the newest link." };
  }
  const type = params.get("type");
  if (params.get("access_token") && (type === "signup" || type === "email" || type === "magiclink")) return { kind: "confirmed" };
  return null;
}
