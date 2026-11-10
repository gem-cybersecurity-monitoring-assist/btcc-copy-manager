import type { CloudService, Result, SessionCookies } from "./cloud-core.ts";

type Access = { allowed: boolean; result: Result; userId?: string };
/** Shared Sentinel data is owner-only; ordinary workspace signup grants no access. */
export async function authorizeSentinelOwner(
  service: Pick<CloudService, "getSession"> | null,
  cookies: SessionCookies,
  ownerUserId: string | undefined,
): Promise<Access> {
  const deny = (
    status: number,
    code: string,
    error: string,
    updatedCookies: Result["cookies"] = [],
  ): Access => ({
    allowed: false,
    result: {
      status,
      body: { connected: false, code, error },
      cookies: updatedCookies,
    },
  });
  if (!cookies.access && !cookies.refresh)
    return deny(
      401,
      "not_authenticated",
      "Sign in to GEM Copy Center to access owner tools.",
    );
  if (!service)
    return deny(
      503,
      "auth_not_configured",
      "The account service is not configured.",
    );
  const lookup = await service.getSession(cookies);
  if (lookup.state === "unavailable")
    return deny(
      503,
      "auth_unreachable",
      "The account service could not be reached.",
      lookup.cookies,
    );
  if (lookup.state !== "authenticated")
    return deny(
      401,
      "not_authenticated",
      "Sign in to GEM Copy Center to access owner tools.",
      lookup.cookies,
    );
  const owner = ownerUserId?.trim().toLowerCase();
  if (
    !owner ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      owner,
    )
  )
    return deny(
      503,
      "owner_not_configured",
      "Workspace owner access has not been configured.",
      lookup.cookies,
    );
  if (lookup.session.user.id.toLowerCase() !== owner)
    return deny(
      403,
      "owner_required",
      "This service is restricted to the workspace owner.",
      lookup.cookies,
    );
  return {
    allowed: true,
    userId: owner,
    result: { status: 200, body: {}, cookies: lookup.cookies },
  };
}
