import type { NextRequest } from "next/server";
import { cloudService, guardMutation, sessionCookiesFrom, toResponse } from "../../lib/cloud-auth.ts";
import type { Result } from "../../lib/cloud-core.ts";
import { authorizeSentinelOwner } from "../../lib/sentinel-access.ts";

/** Authorize before any upstream fetch; preserve refreshed/cleared HttpOnly cookies. */
export async function withSentinelOwner(
  request: NextRequest,
  handler: () => Promise<Result>,
  options: { mutation?: boolean } = {},
) {
  if (options.mutation) {
    const blocked = guardMutation(request, "workspace");
    if (blocked) return blocked;
  }
  const access = await authorizeSentinelOwner(cloudService(), sessionCookiesFrom(request), process.env.COPY_CENTER_OWNER_USER_ID);
  if (!access.allowed) return toResponse(access.result);
  const result = await handler();
  return toResponse({ ...result, cookies: access.result.cookies });
}
