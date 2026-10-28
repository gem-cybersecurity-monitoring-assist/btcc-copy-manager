import { NextRequest, NextResponse } from "next/server";
import { cloudService, sessionCookiesFrom, toResponse } from "../../../../lib/cloud-auth.ts";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const service = cloudService();
  // 200 so the dashboard can render a "setup required" state instead of an error.
  if (!service) return NextResponse.json({ configured: false, authenticated: false, user: null }, { headers: { "Cache-Control": "no-store" } });
  return toResponse(await service.sessionStatus(sessionCookiesFrom(request)));
}
