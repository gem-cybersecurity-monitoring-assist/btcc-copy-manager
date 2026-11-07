import { NextRequest, NextResponse } from "next/server";
import {
  cloudService,
  sessionCookiesFrom,
  toResponse,
} from "../lib/cloud-auth.ts";
import { authorizeSentinelOwner } from "../lib/sentinel-access.ts";

export async function proxy(request: NextRequest) {
  const access = await authorizeSentinelOwner(
    cloudService(),
    sessionCookiesFrom(request),
    process.env.COPY_CENTER_OWNER_USER_ID,
  );
  const response = access.allowed
    ? NextResponse.next()
    : NextResponse.redirect(
        new URL(
          "/sign-in" +
            (access.result.status === 403 ? "?reason=owner_required" : ""),
          request.url,
        ),
      );
  response.headers.set("Cache-Control", "private, no-store");
  for (const cookie of toResponse(access.result).headers.getSetCookie())
    response.headers.append("Set-Cookie", cookie);
  return response;
}
export const config = {
  matcher: [
    "/copy-center/:path*",
    "/copy-trading/:path*",
    "/automation/:path*",
    "/opportunities/:path*",
    "/advanced-btcc/:path*",
    "/purchase/:path*",
    "/steel/:path*",
  ],
};
