import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Bitget's live /api/v3/account/info returns permType "readonly" (no hyphen),
// while its docs write "read-only". Normalize before comparing so both are
// accepted. Permissions are checked by membership: "uta_mgt" must be present
// and none of the trading, withdrawal or copy-trading permissions may be.
// Read-and-write keys stay rejected.
const FORBIDDEN_UTA_PERMISSIONS = ["uta_trade", "withdraw", "copy_futures_position", "copy_futures_order"];

function isReadOnlyUtaPermissions(permissions: unknown, permissionType: unknown): boolean {
  const normalizedPermissionType =
    typeof permissionType === "string" ? permissionType.replace(/-/g, "").toLowerCase() : "";
  if (normalizedPermissionType !== "readonly") return false;
  if (!Array.isArray(permissions)) return false;
  if (!permissions.includes("uta_mgt")) return false;
  return !FORBIDDEN_UTA_PERMISSIONS.some((permission) => permissions.includes(permission));
}

function safeText(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

/**
 * Verifies a Bitget UTA API key by requesting account assets (read-only).
 * Credentials are held only in request memory, never logged or persisted.
 * This route cannot place orders, change account settings, or withdraw funds.
 */
async function verify(request: NextRequest) {
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  const apiKey = input?.apiKey;
  const secret = input?.secret;
  const passphrase = input?.passphrase;
  if (!safeText(apiKey) || !safeText(secret) || !safeText(passphrase)) {
    return NextResponse.json({ ok: false, error: "Enter the Bitget API key, secret, and passphrase." }, { status: 400, headers: noStore });
  }

  try {
    const permissionPath = "/api/v3/account/info";
    const permissionTimestamp = String(Date.now());
    const permissionSignature = createHmac("sha256", secret).update(permissionTimestamp + "GET" + permissionPath).digest("base64");
    const permissionResponse = await fetch("https://api.bitget.com" + permissionPath, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
      headers: {
        "ACCESS-KEY": apiKey.trim(),
        "ACCESS-SIGN": permissionSignature,
        "ACCESS-TIMESTAMP": permissionTimestamp,
        "ACCESS-PASSPHRASE": passphrase,
        "Content-Type": "application/json",
        "locale": "en-US"
      }
    });
    const permissionPayload = await permissionResponse.json().catch(() => ({})) as {
      code?: string;
      data?: { permissions?: unknown; permType?: unknown };
    };
    if (!permissionResponse.ok || permissionPayload.code !== "00000") {
      return NextResponse.json({
        ok: false,
        error: "Bitget rejected the credentials. Check the API key, secret and passphrase."
      }, { status: 403, headers: noStore });
    }
    if (!isReadOnlyUtaPermissions(permissionPayload.data?.permissions, permissionPayload.data?.permType)) {
      return NextResponse.json({
        ok: false,
        error: `This key is not strictly read-only. Create a Bitget API key with permission type read-only and UTA management as its only permission; remove trading, copy-trading, withdrawal, and all other permissions. Bitget reported permType ${JSON.stringify(permissionPayload.data?.permType ?? null)} with permissions ${JSON.stringify(permissionPayload.data?.permissions ?? null)}.`
      }, { status: 403, headers: noStore });
    }

    const timestamp = String(Date.now());
    const requestPath = "/api/v3/account/assets";
    const signature = createHmac("sha256", secret).update(timestamp + "GET" + requestPath).digest("base64");
    const upstream = await fetch("https://api.bitget.com" + requestPath, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
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
        error: "Bitget did not verify these credentials. Check the key, secret, passphrase, IP allow-list, and UTA management/read permission."
      }, { status: 401, headers: noStore });
    }
    const numberOrNull = (value: unknown) => {
      if (typeof value !== "string" && typeof value !== "number") return null;
      if (typeof value === "string" && !value.trim()) return null;
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
      permissionsVerified: "read-only key; uta_mgt only",
      credentialsStored: false,
      message: "Read-only permission and account assets were verified for this request only. Credentials were not stored. Re-enter them for a later verification."
    }, { status: 200, headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, error: "Bitget could not be reached safely. No credentials were stored; try again later." }, { status: 502, headers: noStore });
  }
}

export async function POST(request: NextRequest) {
  return withOwnerRequest(request, () => verify(request), { mutation: true });
}
