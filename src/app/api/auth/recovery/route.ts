import { createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { cloudService, confirmationRedirect, guardMutation, notConfigured, readJson, toResponse } from "../../../../../lib/cloud-auth.ts";
import { RECOVERY_COOKIE, RECOVERY_MAX_AGE, RECOVERY_VERIFIER_COOKIE } from "../../../../../lib/cloud-core.ts";
export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "email");
  if (blocked) return blocked;
  if (process.env.COPY_CENTER_PASSWORD_RECOVERY_ENABLED !== "true")
    return toResponse({ status: 503, body: { code: "recovery_not_configured", error: "Password recovery is awaiting verified email redirect configuration. Your account and saved workspace are unchanged." } });
  const service = cloudService();
  if (!service) return notConfigured();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirect = new URL("/reset-password", confirmationRedirect(request)).toString();
  const result = await service.requestRecovery(await readJson(request), challenge, redirect);
  if (result.status === 200) result.cookies = [
    { name: RECOVERY_VERIFIER_COOKIE, value: verifier, maxAge: RECOVERY_MAX_AGE },
    { name: RECOVERY_COOKIE, value: "", maxAge: 0 },
  ];
  return toResponse(result);
}
