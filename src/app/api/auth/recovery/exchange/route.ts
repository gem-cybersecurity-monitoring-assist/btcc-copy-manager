import { NextRequest } from "next/server";
import { cloudService, guardMutation, notConfigured, readJson, toResponse } from "../../../../../../lib/cloud-auth.ts";
import { RECOVERY_VERIFIER_COOKIE } from "../../../../../../lib/cloud-core.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "auth");
  if (blocked) return blocked;
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.exchangeRecovery(await readJson(request), request.cookies.get(RECOVERY_VERIFIER_COOKIE)?.value));
}
