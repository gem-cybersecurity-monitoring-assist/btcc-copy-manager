import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { NextRequest, NextResponse } from "next/server";
import {
  BTCC_ASSETS_URL,
  isBtccSignedInUrl,
  prepareSteelSession,
  probeSteelSession,
  releaseSteelSession,
  safePageLocation,
  steelConfigStatus,
  withSteelCdp,
  type SteelBrowserState,
} from "@/lib/steel-browser";
import { jsonError, protectedRoute, readSteelState, setSteelState } from "@/lib/steel-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function liveViewerUrl(value?: string) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    url.searchParams.set("interactive", "true");
    return url.toString();
  } catch {
    return undefined;
  }
}

function publicState(state: SteelBrowserState, live: boolean) {
  const started = state.startedAt ? Date.parse(state.startedAt) : 0;
  const timeoutMs = state.timeoutMs || 0;
  const remainingMs = live && started && timeoutMs
    ? Math.max(0, started + timeoutMs - Date.now())
    : 0;
  return {
    sessionLive: live,
    profileAvailable: Boolean(state.profileId),
    startedAt: state.startedAt || null,
    timeoutMs: state.timeoutMs || null,
    remainingMs,
    viewerUrl: live ? liveViewerUrl(state.viewerUrl) : undefined,
  };
}

async function ownerGET(request: NextRequest) {
  const denied = protectedRoute(request);
  if (denied) return denied;
  const config = steelConfigStatus();
  if (!config.ready) return jsonError("Steel environment is not fully configured.", 503);

  const state = readSteelState(request);
  const live = await probeSteelSession(state.sessionId);
  return NextResponse.json({
    ok: true,
    ...publicState(state, live),
    policy: {
      timeoutMs: config.timeoutMs,
      captchaSolving: config.captchaSolving,
      inactivityTimeoutDisabled: config.inactivityTimeoutDisabled,
      persistentProfiles: config.persistentProfiles,
    },
  }, { headers: { "cache-control": "no-store, max-age=0" } });
}

async function ownerPOST(request: NextRequest) {
  const denied = protectedRoute(request);
  if (denied) return denied;
  const config = steelConfigStatus();
  if (!config.ready) return jsonError("Steel environment is not fully configured.", 503);

  let action = "ensure";
  try {
    const body = await request.json() as { action?: unknown };
    if (typeof body.action === "string") action = body.action;
  } catch {
    // Empty JSON is equivalent to ensure.
  }

  let state = readSteelState(request);

  try {
    if (action === "ensure" || action === "home") {
      const prepared = await prepareSteelSession(state);
      state = prepared.state;
      if (!state.sessionId) throw new Error("Steel did not create a session.");
      if (action === "home") {
        await withSteelCdp(state.sessionId, async (cdp) => cdp.navigate(BTCC_ASSETS_URL));
      }
      const response = NextResponse.json({
        ok: true,
        recreated: prepared.recreated,
        ...publicState(state, true),
      }, { headers: { "cache-control": "no-store, max-age=0" } });
      setSteelState(response, state);
      return response;
    }

    if (action === "finish") {
      if (!state.sessionId) return jsonError("There is no active Steel session to finish.", 409);
      if (!await probeSteelSession(state.sessionId)) {
        state = { profileId: state.profileId };
        const response = jsonError("The Steel session already expired. Start a new session; the saved profile will be reused if available.", 409);
        setSteelState(response, state);
        return response;
      }
      const currentUrl = await withSteelCdp(state.sessionId, async (cdp) => cdp.currentUrl());
      if (!isBtccSignedInUrl(currentUrl)) {
        return NextResponse.json({
          ok: false,
          error: "BTCC still appears to be on the sign-in flow. Complete sign-in before saving the profile.",
          currentPage: safePageLocation(currentUrl),
        }, { status: 409, headers: { "cache-control": "no-store, max-age=0" } });
      }
      await releaseSteelSession(state.sessionId);
      state = { profileId: state.profileId };
      const response = NextResponse.json({
        ok: true,
        profilePersisting: Boolean(state.profileId),
        message: "BTCC sign-in was verified and the Steel session was released so its profile can persist.",
      }, { headers: { "cache-control": "no-store, max-age=0" } });
      setSteelState(response, state);
      return response;
    }

    if (action === "release") {
      if (state.sessionId) await releaseSteelSession(state.sessionId);
      state = { profileId: state.profileId };
      const response = NextResponse.json({ ok: true, released: true, profileAvailable: Boolean(state.profileId) }, {
        headers: { "cache-control": "no-store, max-age=0" },
      });
      setSteelState(response, state);
      return response;
    }

    if (action === "reset-profile") {
      if (state.sessionId) await releaseSteelSession(state.sessionId);
      state = {};
      const response = NextResponse.json({ ok: true, reset: true }, {
        headers: { "cache-control": "no-store, max-age=0" },
      });
      setSteelState(response, state);
      return response;
    }

    return jsonError("Unknown Steel session action.", 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Steel session operation failed.";
    return jsonError(message, 502);
  }
}

export async function GET(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerGET(request));
}

export async function POST(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerPOST(request), { mutation: true });
}
