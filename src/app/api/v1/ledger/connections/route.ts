import type { NextRequest } from "next/server";
import { cloudService, notConfigured, sessionCookiesFrom, toResponse } from "../../../../../../lib/cloud-auth.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Read-only owner connection status. No credential/vault fields. */
export async function GET(request: NextRequest) {
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.getLedgerConnections(sessionCookiesFrom(request), process.env.COPY_CENTER_OWNER_USER_ID));
}
