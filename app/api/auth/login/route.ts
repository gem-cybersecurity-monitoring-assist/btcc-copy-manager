import { NextRequest } from "next/server";
import { cloudService, guardMutation, notConfigured, readJson, toResponse } from "../../../../lib/cloud-auth.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "auth");
  if (blocked) return blocked;
  const service = cloudService();
  if (!service) return notConfigured();
  return toResponse(await service.login(await readJson(request)));
}
