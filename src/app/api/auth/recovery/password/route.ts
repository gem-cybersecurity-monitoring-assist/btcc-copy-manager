import { NextRequest } from "next/server";
import { cloudService, guardMutation, notConfigured, readJson, toResponse } from "../../../../../../lib/cloud-auth.ts";
import { RECOVERY_COOKIE } from "../../../../../../lib/cloud-core.ts";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const service = cloudService();
  return service ? toResponse(await service.recoveryStatus(request.cookies.get(RECOVERY_COOKIE)?.value)) : notConfigured();
}
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "auth");
  if (blocked) return blocked;
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.resetPassword(await readJson(request), request.cookies.get(RECOVERY_COOKIE)?.value));
}
