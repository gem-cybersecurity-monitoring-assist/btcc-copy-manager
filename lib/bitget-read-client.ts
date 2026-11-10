// GET-only Bitget UTA client for the Copy Center's read-only connection.
//
// Only the paths in BITGET_READ_PATHS can be requested, only with GET, only to
// https://api.bitget.com, and redirects are refused. There is deliberately no
// way to issue POST/PUT/DELETE or reach an order, transfer, withdrawal or
// copy-trading endpoint through this module. Credentials stay in memory for the
// duration of the call and are never logged or included in errors.
import { createHmac } from "node:crypto";
import { isReadOnlyUtaPermissions } from "../src/lib/bitget-readonly.ts";
import type { FetchLike } from "./connection-store.ts";

export const BITGET_BASE_URL = "https://api.bitget.com";
export const BITGET_READ_PATHS = [
  "/api/v3/account/info",
  "/api/v3/account/assets",
  "/api/v3/position/current-position",
] as const;
export type BitgetReadPath = (typeof BITGET_READ_PATHS)[number];
export const BITGET_POSITION_CATEGORIES = ["USDT-FUTURES", "COIN-FUTURES", "USDC-FUTURES"] as const;

export type BitgetCredentials = { apiKey: string; secret: string; passphrase: string };

export class BitgetReadError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly providerCode: string | null;
  constructor(code: string, message: string, httpStatus: number, providerCode: string | null = null) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.providerCode = providerCode;
  }
}

export function bitgetSignature(secret: string, timestamp: string, method: "GET", pathWithQuery: string): string {
  return createHmac("sha256", secret).update(timestamp + method + pathWithQuery).digest("base64");
}

export function validCredentialText(value: unknown, max = 256): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}

export function parseCredentials(input: unknown): BitgetCredentials | null {
  const body = input as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return null;
  if (!validCredentialText(body.apiKey) || !validCredentialText(body.secret) || !validCredentialText(body.passphrase)) return null;
  return { apiKey: body.apiKey.trim(), secret: body.secret, passphrase: body.passphrase };
}

function safeProviderCode(value: unknown): string | null {
  return typeof value === "string" && /^\d{1,8}$/.test(value) ? value : null;
}

/** Empty strings and non-finite values are unknown (null), never zero. */
export function numberOrNull(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown, max = 64): string | null {
  return typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null;
}

export async function bitgetGet(
  credentials: BitgetCredentials,
  path: BitgetReadPath,
  params: Record<string, string> = {},
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  now: () => number = Date.now,
): Promise<unknown> {
  if (!(BITGET_READ_PATHS as readonly string[]).includes(path))
    throw new BitgetReadError("path_not_allowed", "This Bitget endpoint is not on the read-only allowlist.", 500);
  const query = new URLSearchParams(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toString();
  const pathWithQuery = query ? path + "?" + query : path;
  const timestamp = String(now());
  let response: Response;
  try {
    response = await fetchImpl(BITGET_BASE_URL + pathWithQuery, {
      method: "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "ACCESS-KEY": credentials.apiKey,
        "ACCESS-SIGN": bitgetSignature(credentials.secret, timestamp, "GET", pathWithQuery),
        "ACCESS-TIMESTAMP": timestamp,
        "ACCESS-PASSPHRASE": credentials.passphrase,
        "Content-Type": "application/json",
        locale: "en-US",
      },
    });
  } catch {
    throw new BitgetReadError("provider_unreachable", "Bitget could not be reached safely.", 502);
  }
  const payload = (await response.json().catch(() => ({}))) as { code?: unknown; data?: unknown };
  if (!response.ok || payload.code !== "00000") {
    throw new BitgetReadError(
      response.status === 401 || response.status === 403 ? "credentials_rejected" : "provider_rejected",
      "Bitget rejected the read-only request.",
      response.status >= 500 ? 502 : 403,
      safeProviderCode(payload.code),
    );
  }
  return payload.data;
}

export type BitgetCoinBalance = {
  coin: string;
  equity: number | null;
  available: number | null;
  locked: number | null;
  usdValue: number | null;
};

export type BitgetPosition = {
  category: string;
  symbol: string;
  side: string;
  marginCoin: string | null;
  size: number | null;
  entryPrice: number | null;
  markPrice: number | null;
  liquidationPrice: number | null;
  leverage: number | null;
  marginMode: string | null;
  unrealizedPnl: number | null;
};

export type BitgetSnapshot = {
  provider: "Bitget";
  source: "bitget_official_api_readonly";
  capturedAt: string;
  exchangeUserId: string | null;
  permissions: string[];
  balances: {
    accountEquityUsd: number | null;
    usdtEquity: number | null;
    btcEquity: number | null;
    unrealizedPnlUsd: number | null;
    coins: BitgetCoinBalance[];
  };
  positions: {
    status: "complete" | "partial" | "unavailable";
    reason: string | null;
    categories: Record<string, "ok" | "unavailable">;
    rows: BitgetPosition[];
  };
};

export type PermissionCheck = { readOnly: boolean; permType: unknown; permissions: unknown; userId: string | null };

export async function checkPermissions(credentials: BitgetCredentials, fetchImpl?: FetchLike): Promise<PermissionCheck> {
  const data = (await bitgetGet(credentials, "/api/v3/account/info", {}, fetchImpl)) as Record<string, unknown> | null;
  const permType = data?.permType;
  const permissions = data?.permissions;
  const userId = typeof data?.userId === "string" && /^\d{1,64}$/.test(data.userId) ? data.userId : null;
  return { readOnly: isReadOnlyUtaPermissions(permissions, permType), permType, permissions, userId };
}

function parseCoins(value: unknown): BitgetCoinBalance[] {
  if (!Array.isArray(value)) return [];
  const coins: BitgetCoinBalance[] = [];
  for (const row of value.slice(0, 500)) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const coin = textOrNull(record.coin, 32);
    if (!coin) continue;
    const balance = {
      coin,
      equity: numberOrNull(record.equity),
      available: numberOrNull(record.available),
      locked: numberOrNull(record.locked),
      usdValue: numberOrNull(record.usdValue),
    };
    // Omit rows Bitget reports as exactly zero everywhere; unknown values are kept.
    if ([balance.equity, balance.available, balance.locked, balance.usdValue].every((amount) => amount === 0)) continue;
    coins.push(balance);
  }
  return coins;
}

function parsePositions(category: string, value: unknown): BitgetPosition[] {
  const list = (value as Record<string, unknown> | null)?.list;
  if (!Array.isArray(list) || list.length > 1000) throw new BitgetReadError("provider_invalid", "Bitget returned an invalid positions list.", 502);
  const rows: BitgetPosition[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") throw new BitgetReadError("provider_invalid", "Bitget returned an invalid position.", 502);
    const record = row as Record<string, unknown>;
    const symbol = textOrNull(record.symbol, 64);
    const side = textOrNull(record.posSide, 16);
    if (!symbol || !side) throw new BitgetReadError("provider_invalid", "Bitget returned a position without identity.", 502);
    const size = numberOrNull(record.total ?? record.size);
    if (size === 0) continue;
    rows.push({
      category,
      symbol,
      side,
      marginCoin: textOrNull(record.marginCoin, 16),
      size,
      entryPrice: numberOrNull(record.avgPrice ?? record.openPriceAvg),
      markPrice: numberOrNull(record.markPrice),
      liquidationPrice: numberOrNull(record.liqPrice ?? record.liquidationPrice),
      leverage: numberOrNull(record.leverage),
      marginMode: textOrNull(record.marginMode, 16),
      unrealizedPnl: numberOrNull(record.unrealisedPnl ?? record.unrealizedPL),
    });
  }
  return rows;
}

/**
 * Re-checks read-only permissions, then reads balances and positions. The
 * caller must not use or store a key for which `readOnly` is false.
 * Position categories that Bitget refuses (for example because the key lacks a
 * trade-read scope) are reported as unavailable, never as zero positions.
 */
export async function readBitgetSnapshot(
  credentials: BitgetCredentials,
  fetchImpl?: FetchLike,
  now: () => Date = () => new Date(),
): Promise<{ permission: PermissionCheck; snapshot: BitgetSnapshot | null }> {
  const permission = await checkPermissions(credentials, fetchImpl);
  if (!permission.readOnly) return { permission, snapshot: null };
  const assets = (await bitgetGet(credentials, "/api/v3/account/assets", {}, fetchImpl)) as Record<string, unknown> | null;
  if (!assets || typeof assets !== "object") throw new BitgetReadError("provider_invalid", "Bitget returned an invalid assets response.", 502);
  const categories: Record<string, "ok" | "unavailable"> = {};
  const rows: BitgetPosition[] = [];
  let firstFailure: BitgetReadError | null = null;
  for (const category of BITGET_POSITION_CATEGORIES) {
    try {
      rows.push(...parsePositions(category, await bitgetGet(credentials, "/api/v3/position/current-position", { category }, fetchImpl)));
      categories[category] = "ok";
    } catch (error) {
      categories[category] = "unavailable";
      if (!firstFailure && error instanceof BitgetReadError) firstFailure = error;
    }
  }
  const okCount = Object.values(categories).filter((state) => state === "ok").length;
  const status = okCount === BITGET_POSITION_CATEGORIES.length ? "complete" : okCount === 0 ? "unavailable" : "partial";
  const reason = status === "complete" ? null
    : firstFailure && (firstFailure.code === "credentials_rejected" || firstFailure.code === "provider_rejected")
      ? `Bitget refused the position request${firstFailure.providerCode ? " (code " + firstFailure.providerCode + ")" : ""}. A key limited to UTA management may not include position read access.`
      : "Bitget positions could not be read.";
  return {
    permission,
    snapshot: {
      provider: "Bitget",
      source: "bitget_official_api_readonly",
      capturedAt: now().toISOString(),
      exchangeUserId: permission.userId,
      permissions: Array.isArray(permission.permissions) ? (permission.permissions as unknown[]).filter((p): p is string => typeof p === "string").slice(0, 20) : [],
      balances: {
        accountEquityUsd: numberOrNull(assets.accountEquity),
        usdtEquity: numberOrNull(assets.usdtEquity),
        btcEquity: numberOrNull(assets.btcEquity),
        unrealizedPnlUsd: numberOrNull(assets.unrealisedPnl),
        coins: parseCoins(assets.assets),
      },
      positions: { status, reason, categories, rows: status === "unavailable" ? [] : rows },
    },
  };
}
