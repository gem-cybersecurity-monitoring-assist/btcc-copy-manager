import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { NextRequest, NextResponse } from "next/server";
import { BTCC_ASSETS_URL, prepareSteelSession, steelConfigStatus, withSteelCdp } from "@/lib/steel-browser";
import { jsonError, protectedRoute, readSteelState, setSteelState } from "@/lib/steel-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type InputBody = {
  action?: unknown;
  x?: unknown;
  y?: unknown;
  value?: unknown;
};

async function ownerPOST(request: NextRequest) {
  const denied = protectedRoute(request);
  if (denied) return denied;
  if (!steelConfigStatus().ready) return jsonError("Steel environment is not fully configured.", 503);

  let body: InputBody;
  try {
    body = await request.json() as InputBody;
  } catch {
    return jsonError("Invalid input request.", 400);
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!new Set(["tap", "otp", "reload", "home"]).has(action)) {
    return jsonError("Unsupported browser input action.", 400);
  }

  try {
    const prepared = await prepareSteelSession(readSteelState(request));
    const state = prepared.state;
    if (!state.sessionId) return jsonError("Steel session is unavailable.", 502);

    await withSteelCdp(state.sessionId, async (cdp) => {
      if (action === "tap") {
        const x = Number(body.x);
        const y = Number(body.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 4096 || y > 4096) {
          throw new Error("Tap coordinates are invalid.");
        }
        await cdp.tap(x, y);
        await new Promise((resolve) => setTimeout(resolve, 450));
        return;
      }
      if (action === "otp") {
        const value = typeof body.value === "string" ? body.value.trim() : "";
        if (!/^\d{4,8}$/.test(value)) throw new Error("OTP must contain 4 to 8 digits.");
        await cdp.insertOtp(value);
        return;
      }
      if (action === "reload") {
        await cdp.reload();
        return;
      }
      if (action === "home") {
        await cdp.navigate(BTCC_ASSETS_URL);
      }
    });

    const response = NextResponse.json({
      ok: true,
      recreated: prepared.recreated,
    }, { headers: { "cache-control": "no-store, max-age=0" } });
    setSteelState(response, state);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Steel browser input failed.";
    return jsonError(message, 502);
  }
}

export async function POST(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerPOST(request), { mutation: true });
}
