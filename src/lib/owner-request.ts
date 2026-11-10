import type { NextRequest } from "next/server";
import {
  cloudService,
  guardMutation,
  sessionCookiesFrom,
  toResponse,
} from "../../lib/cloud-auth.ts";
import { authorizeSentinelOwner } from "../../lib/sentinel-access.ts";

/** Owner authorization precedes provider access, diagnostics, billing or execution. */
export async function withOwnerRequest(
  request: NextRequest,
  operation: (owner: { userId: string }) => Promise<Response>,
  options: {
    mutation?: boolean;
    requireJson?: boolean;
    financialExecution?: boolean;
    /**
     * Actions that can operate an exchange account through a remote browser
     * (taps, OTP entry, automated logins). Stage 1 is read-only, so these are
     * refused unless COPY_CENTER_ACCOUNT_CONTROL_ENABLED is exactly "true".
     */
    accountControl?: boolean;
  } = {},
) {
  if (options.mutation) {
    const blocked = guardMutation(request, "workspace", {
      requireJson: options.requireJson,
    });
    if (blocked) return blocked;
  }
  const access = await authorizeSentinelOwner(
    cloudService(),
    sessionCookiesFrom(request),
    process.env.COPY_CENTER_OWNER_USER_ID,
  );
  if (!access.allowed) return toResponse(access.result);
  if (options.accountControl && process.env.COPY_CENTER_ACCOUNT_CONTROL_ENABLED !== "true")
    return toResponse({
      status: 403,
      body: {
        code: "read_only_stage",
        error:
          "Account control is disabled: the Copy Center is in read-only mode. No exchange action was taken.",
      },
      cookies: access.result.cookies,
    });
  if (options.financialExecution)
    return toResponse({
      status: 503,
      body: {
        code: "approval_ledger_not_ready",
        error:
          "Financial execution is disabled until durable owner approval and provider acceptance are verified.",
      },
      cookies: access.result.cookies,
    });
  const response = await operation({ userId: access.userId! });
  response.headers.set("Cache-Control", "no-store");
  for (const cookie of toResponse(access.result).headers.getSetCookie())
    response.headers.append("Set-Cookie", cookie);
  return response;
}
