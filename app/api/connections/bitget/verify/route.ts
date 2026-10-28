import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cloudService, guardMutation, sessionCookiesFrom } from "@/lib/cloud-auth-bridge.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function safeText(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/**
 * Verifies a Bitget UTA API key by requesting account assets (read-only).
 * Credentials are held only in request memory, never logged or persisted.
 * This route cannot place orders, change account settings, or withdraw funds.
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

  const timestamp = String(Date.now());
  const requestPath = "/api/v3/account/assets";
  const signature = createHmac("sha256", secret).update(timestamp + "GET" + requestPath).digest("base64");
  try {
    const upstream = await fetch("https://api.bitget.com" + requestPath, {
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
    const payload = await upstream.json().catch(() => ({})) as {
      code?: string;
      msg?: string;
      data?: { accountEquity?: string | number; usdtEquity?: string | number; btcEquity?: string | number };
    };
    if (!upstream.ok || payload.code !== "00000" || !payload.data) {
      return NextResponse.json({
        ok: false,
        error: "Bitget did not verify these credentials. Check the key, secret, passphrase, account type, IP allow-list, and read-only UTA account-assets permission."
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
      credentialsStored: false,
      message: "Credentials were verified for this request only and were not stored. Re-enter them for a later verification."
    }, { status: 200, headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, error: "Bitget could not be reached safely. No credentials were stored; try again later." }, { status: 502, headers: noStore });
  }
}
