import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { NextRequest, NextResponse } from "next/server";
import { prepareSteelSession, steelConfigStatus, withSteelCdp } from "@/lib/steel-browser";
import { jsonError, protectedRoute, readSteelState, setSteelState } from "@/lib/steel-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function ownerGET(request: NextRequest) {
  const denied = protectedRoute(request);
  if (denied) return denied;
  if (!steelConfigStatus().ready) return jsonError("Steel environment is not fully configured.", 503);

  try {
    const prepared = await prepareSteelSession(readSteelState(request));
    const state = prepared.state;
    if (!state.sessionId) return jsonError("Steel session is unavailable.", 502);
    const png = await withSteelCdp(state.sessionId, async (cdp) => cdp.screenshot());
    const response = new NextResponse(png, {
      status: 200,
      headers: {
        "content-type": "image/png",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "x-steel-recreated": prepared.recreated ? "1" : "0",
      },
    });
    setSteelState(response, state);
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Steel screenshot failed.";
    return jsonError(message, 502);
  }
}

export async function GET(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerGET(request));
}
