import { NextRequest } from "next/server";
import { cloudService, confirmationRedirect, guardMutation, notConfigured, readJson, toResponse } from "../../../../lib/cloud-auth.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "email");
  if (blocked) return blocked;
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.signup(await readJson(request), confirmationRedirect(request)));
}
