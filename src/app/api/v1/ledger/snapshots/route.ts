import type { NextRequest } from "next/server";
import { cloudService, notConfigured, sessionCookiesFrom, toResponse } from "../../../../../../lib/cloud-auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only. Uses the signed-in owner's JWT and database RLS. */
export async function GET(request: NextRequest) {
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.getLedgerSnapshots(sessionCookiesFrom(request), process.env.COPY_CENTER_OWNER_USER_ID));
}
