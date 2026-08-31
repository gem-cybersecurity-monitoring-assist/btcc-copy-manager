import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { steelConfigStatus, verifyControlSecret } from "@/lib/steel-browser";
import { clearSteelAuth, isSteelAuthorized, jsonError, sameOrigin, setSteelAuth } from "@/lib/steel-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function verifyLegacyControlSecret(candidate: string) {
  const legacy = process.env.STELL_CONTROL_SECRET?.trim();
  if (!legacy) return false;
  const expected = Buffer.from(legacy, "utf8");
  const supplied = Buffer.from(candidate, "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function GET(request: NextRequest) {
  const config = steelConfigStatus();
  return NextResponse.json({
    ok: true,
    configured: config.ready,
    authorized: config.ready ? isSteelAuthorized(request) : false,
    missing: config.missing,
    controlSecretStrongEnough: config.controlSecretStrongEnough,
    legacyControlSecretPresent: Boolean(process.env.STELL_CONTROL_SECRET?.trim()),
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Cross-origin request blocked.", 403);
  const config = steelConfigStatus();
  if (!config.ready) return jsonError("Steel controller environment is not fully configured.", 503);

  let secret = "";
  try {
    const body = await request.json() as { secret?: unknown };
    secret = typeof body.secret === "string" ? body.secret.trim() : "";
  } catch {
    return jsonError("Invalid request.", 400);
  }

  if (!verifyControlSecret(secret) && !verifyLegacyControlSecret(secret)) {
    await new Promise((resolve) => setTimeout(resolve, 350));
    return jsonError("Authorization failed.", 401);
  }

  const response = NextResponse.json({ ok: true, authorized: true }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
  setSteelAuth(response);
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Cross-origin request blocked.", 403);
  const response = NextResponse.json({ ok: true, authorized: false }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
  clearSteelAuth(response);
  return response;
}
