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
  operation: () => Promise<Response>,
  options: {
    mutation?: boolean;
    requireJson?: boolean;
    financialExecution?: boolean;
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
  const response = await operation();
  response.headers.set("Cache-Control", "no-store");
  for (const cookie of toResponse(access.result).headers.getSetCookie())
    response.headers.append("Set-Cookie", cookie);
  return response;
}
