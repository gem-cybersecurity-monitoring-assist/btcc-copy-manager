import { NextRequest, NextResponse } from "next/server";
import {
  STEEL_AUTH_COOKIE,
  STEEL_STATE_COOKIE,
  expectedAuthCookie,
  sealSteelState,
  unsealSteelState,
  verifyAuthCookie,
  type SteelBrowserState,
} from "./steel-browser";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    return originUrl.host === request.nextUrl.host && originUrl.protocol === request.nextUrl.protocol;
  } catch {
    return false;
  }
}

export function isSteelAuthorized(request: NextRequest) {
  return verifyAuthCookie(request.cookies.get(STEEL_AUTH_COOKIE)?.value);
}

export function readSteelState(request: NextRequest) {
  return unsealSteelState(request.cookies.get(STEEL_STATE_COOKIE)?.value);
}

export function setSteelState(response: NextResponse, state: SteelBrowserState) {
  response.cookies.set(STEEL_STATE_COOKIE, sealSteelState(state), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function setSteelAuth(response: NextResponse) {
  response.cookies.set(STEEL_AUTH_COOKIE, expectedAuthCookie(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearSteelAuth(response: NextResponse) {
  response.cookies.set(STEEL_AUTH_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, {
    status,
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export function protectedRoute(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Cross-origin request blocked.", 403);
  if (!isSteelAuthorized(request)) return jsonError("Steel controller authorization required.", 401);
  return null;
}
