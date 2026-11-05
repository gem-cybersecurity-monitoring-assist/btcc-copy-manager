import { NextRequest } from "next/server";
import { cloudService, guardMutation, sessionCookiesFrom, toResponse } from "../../../../../lib/cloud-auth.ts";
import { clearedCookies } from "../../../../../lib/cloud-core.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "auth", { requireJson: false });
  if (blocked) return blocked;
  const service = cloudService();
  // Always clear local session cookies, even when cloud sync is not configured.
  if (!service) return toResponse({ status: 200, body: { ok: true }, cookies: clearedCookies() });
  return toResponse(await service.logout(sessionCookiesFrom(request)));
}
