import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cloudService, guardMutation, sessionCookiesFrom } from "@/lib/cloud-auth-bridge.ts";
import { isReadOnlyUtaPermissions } from "@/lib/bitget-readonly.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function safeText(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

function signedGet(path: string, apiKey: string, secret: string, passphrase: string) {
  const timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(timestamp + "GET" + path).digest("base64");
  return fetch("https://api.bitget.com" + path, {
    method: "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "ACCESS-KEY": apiKey.trim(),
      "ACCESS-SIGN": signature,
      "ACCESS-TIMESTAMP": timestamp,
      "ACCESS-PASSPHRASE": passphrase,
      "Content-Type": "application/json",
      "locale": "en-US"
    }
  });
}

/**
 * Verifies a narrowly-scoped Bitget UTA key. Permission preflight must prove
 * the key has exactly UTA management/read permission before requesting assets.
 * Credentials are held only in request memory, never logged or persisted.
 * No trading, copy-trading, account mutation, or withdrawal endpoint is called.
 */
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "auth");
  if (blocked) return blocked;

  const service = cloudService();
  if (!service) return NextResponse.json({ ok: false, error: "Cloud account service is not configured." }, { status: 503, headers: noStore });
  const session = await service.sessionStatus(sessionCookiesFrom(request));
  if (session.status !== 200 || session.body.authenticated !== true) {
    return NextResponse.json({ ok: false, error: "Sign in to GEM Copy Center before verifying an exchange connection." }, { status: 401, headers: noStore });
  }

  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const apiKey = input?.apiKey;
  const secret = input?.secret;
  const passphrase = input?.passphrase;
  if (!safeText(apiKey) || !safeText(secret) || !safeText(passphrase)) {
    return NextResponse.json({ ok: false, error: "Enter the Bitget API key, secret, and passphrase." }, { status: 400, headers: noStore });
  }

  try {
    // Check the key's actual permissions first; don't rely only on the user saying it is read-only.
    const permissionResponse = await signedGet("/api/v3/account/info", apiKey, secret, passphrase);
    const permissionPayload = await permissionResponse.json().catch(() => ({})) as {
      code?: string;
      data?: { permissions?: unknown };
    };
    if (!permissionResponse.ok || permissionPayload.code !== "00000" || !isReadOnlyUtaPermissions(permissionPayload.data?.permissions)) {
      return NextResponse.json({
        ok: false,
        error: "This key could not be verified as read-only. Create a Bitget API key with UTA management/read permission only; remove trading, copy-trading, withdrawal, and other permissions."
      }, { status: 403, headers: noStore });
    }

    const upstream = await signedGet("/api/v3/account/assets", apiKey, secret, passphrase);
    const payload = await upstream.json().catch(() => ({})) as {
      code?: string;
      msg?: string;
      data?: { accountEquity?: string | number; usdtEquity?: string | number; btcEquity?: string | number };
    };
    if (!upstream.ok || payload.code !== "00000" || !payload.data) {
      return NextResponse.json({
        ok: false,
        error: "Bitget did not verify these credentials. Check the key, secret, passphrase, IP allow-list, and UTA management/read permission."
      }, { status: 401, headers: noStore });
    }
    const numberOrNull = (value: unknown) => {
      if (typeof value !== "string" && typeof value !== "number") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    return NextResponse.json({
      ok: true,
      provider: "Bitget",
      mode: "read-only verification",
      verifiedAt: new Date().toISOString(),
      accountEquityUsd: numberOrNull(payload.data.accountEquity),
      usdtEquity: numberOrNull(payload.data.usdtEquity),
      btcEquity: numberOrNull(payload.data.btcEquity),
      permissionsVerified: "uta_mgt only",
      credentialsStored: false,
      message: "Read-only permission and account assets were verified for this request only. Credentials were not stored. Re-enter them for a later verification."
    }, { status: 200, headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, error: "Bitget could not be reached safely. No credentials were stored; try again later." }, { status: 502, headers: noStore });
  }
}
