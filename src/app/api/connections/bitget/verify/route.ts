import { NextRequest, NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import {
  BitgetReadError,
  bitgetGet,
  checkPermissions,
  numberOrNull,
  parseCredentials,
} from "../../../../../../lib/bitget-read-client.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/**
 * One-time verification of a Bitget UTA API key: read-only permission check,
 * then account assets. Credentials are held only in request memory, never
 * logged or persisted. Uses the GET-only allowlisted client, so this route
 * cannot place orders, change account settings, or withdraw funds.
 * To save a connection, use POST /api/connections/bitget instead.
 */
async function verify(request: NextRequest) {
  const credentials = parseCredentials(await request.json().catch(() => null));
  if (!credentials) {
    return NextResponse.json({ ok: false, error: "Enter the Bitget API key, secret, and passphrase." }, { status: 400, headers: noStore });
  }
  try {
    let permission;
    try {
      permission = await checkPermissions(credentials);
    } catch (error) {
      if (error instanceof BitgetReadError && error.code !== "provider_unreachable")
        return NextResponse.json({ ok: false, error: "Bitget rejected the credentials. Check the API key, secret and passphrase." }, { status: 403, headers: noStore });
      throw error;
    }
    if (!permission.readOnly) {
      return NextResponse.json({
        ok: false,
        error: `This key is not strictly read-only. Create a Bitget API key with permission type read-only and UTA management as its only permission; remove trading, copy-trading, withdrawal, and all other permissions. Bitget reported permType ${JSON.stringify(permission.permType ?? null)} with permissions ${JSON.stringify(permission.permissions ?? null)}.`,
      }, { status: 403, headers: noStore });
    }
    let assets: Record<string, unknown> | null;
    try {
      assets = (await bitgetGet(credentials, "/api/v3/account/assets")) as Record<string, unknown> | null;
    } catch (error) {
      if (error instanceof BitgetReadError && error.code !== "provider_unreachable") assets = null;
      else throw error;
    }
    if (!assets || typeof assets !== "object") {
      return NextResponse.json({
        ok: false,
        error: "Bitget did not verify these credentials. Check the key, secret, passphrase, IP allow-list, and UTA management/read permission.",
      }, { status: 401, headers: noStore });
    }
    return NextResponse.json({
      ok: true,
      provider: "Bitget",
      mode: "read-only verification",
      verifiedAt: new Date().toISOString(),
      accountEquityUsd: numberOrNull(assets.accountEquity),
      usdtEquity: numberOrNull(assets.usdtEquity),
      btcEquity: numberOrNull(assets.btcEquity),
      permissionsVerified: "read-only key; uta_mgt only",
      credentialsStored: false,
      message: "Read-only permission and account assets were verified for this request only. Credentials were not stored. Re-enter them for a later verification.",
    }, { status: 200, headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, error: "Bitget could not be reached safely. No credentials were stored; try again later." }, { status: 502, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  return withOwnerRequest(request, () => verify(request), { mutation: true });
}
