import { NextRequest } from "next/server";
import { cloudService, guardMutation, notConfigured, sessionCookiesFrom, toResponse } from "../../../../lib/cloud-auth.ts";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.getWorkspace(sessionCookiesFrom(request)));
}
export async function PUT(request: NextRequest) {
  const blocked = guardMutation(request, "workspace");
  if (blocked) return blocked;
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.putWorkspace(sessionCookiesFrom(request), await request.text()));
}
