// Read-only BTCC adapter.
//
// BTCC announced on 13 February 2026 that its futures API would be suspended
// pending a restoration notice (https://www.btcc.com/en-US/detail/176811). No
// restoration has been verified, so this adapter reports "provider_unavailable"
// with the concrete reason and never substitutes demo data.
//
// When server-only BTCC credentials are configured, an owner-triggered check
// may contact BTCC with exactly two calls: the session login (POST, which BTCC's
// documented API requires for authentication) and the position list (GET).
// No order, transfer, deposit or withdrawal path can be requested: anything
// outside BTCC_READ_CALLS is refused before a network request is made.
import { signBtccParameters } from "../src/lib/btcc-live.ts";
import type { FetchLike } from "./connection-store.ts";

export const BTCC_SUSPENSION_NOTICE_URL = "https://www.btcc.com/en-US/detail/176811";
export const BTCC_SUSPENSION_REASON =
  "BTCC suspended its futures API on 13 February 2026 pending a restoration announcement. Restoration has not been verified.";
export const BTCC_READ_CALLS = [
  { method: "POST", path: "/v1/user/login" },
  { method: "GET", path: "/v1/account/positionlist" },
] as const;
const REQUIRED_ENV = ["BTCC_API_BASE_URL", "BTCC_API_KEY", "BTCC_SECRET_KEY", "BTCC_USERNAME", "BTCC_PASSWORD"] as const;

export type BtccPosition = {
  symbol: string; side: string; size: number | null; entryPrice: number | null;
  leverage: number | null; unrealizedPnl: number | null;
};
export type BtccAdapterStatus =
  | { status: "provider_unavailable"; code: "not_configured" | "provider_rejected" | "provider_unreachable" | "provider_invalid"; reason: string; noticeUrl: string; checkedAt: string; missing?: string[] }
  | { status: "available"; source: "btcc_official_api_readonly"; checkedAt: string; positions: BtccPosition[]; balances: null; copyHistory: null; note: string };

type Config = { baseUrl: string; apiKey: string; secret: string; username: string; password: string; accountId: string | null };

export function readBtccConfig(env: Record<string, string | undefined>): { config: Config | null; missing: string[] } {
  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length) return { config: null, missing: [...missing] };
  let baseUrl: string;
  try {
    const parsed = new URL(env.BTCC_API_BASE_URL!.trim());
    if (parsed.protocol !== "https:") return { config: null, missing: ["BTCC_API_BASE_URL"] };
    baseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return { config: null, missing: ["BTCC_API_BASE_URL"] };
  }
  return {
    config: {
      baseUrl, apiKey: env.BTCC_API_KEY!.trim(), secret: env.BTCC_SECRET_KEY!, username: env.BTCC_USERNAME!.trim(),
      password: env.BTCC_PASSWORD!, accountId: env.BTCC_ACCOUNT_ID?.trim() || null,
    },
    missing: [],
  };
}

const num = (value: unknown) => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Status without any network call: used for page loads. */
export function btccStaticStatus(env: Record<string, string | undefined>, now = new Date()): BtccAdapterStatus {
  const { config, missing } = readBtccConfig(env);
  return {
    status: "provider_unavailable",
    code: "not_configured",
    reason: config
      ? BTCC_SUSPENSION_REASON + " Server credentials are configured; run a check to confirm the current provider state."
      : BTCC_SUSPENSION_REASON + " No BTCC API credentials are configured on the server.",
    noticeUrl: BTCC_SUSPENSION_NOTICE_URL,
    checkedAt: now.toISOString(),
    ...(config ? {} : { missing }),
  };
}

async function call(config: Config, method: "GET" | "POST", path: string, params: Record<string, string | number>, fetchImpl: FetchLike) {
  if (!BTCC_READ_CALLS.some((allowed) => allowed.method === method && allowed.path === path))
    throw Object.assign(new Error("This BTCC call is not on the read-only allowlist."), { code: "provider_invalid" as const });
  const fields = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), sign: signBtccParameters(params, config.secret) });
  let response: Response;
  try {
    response = await fetchImpl(config.baseUrl + path + (method === "GET" ? "?" + fields : ""), {
      method, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : undefined,
      body: method === "POST" ? fields : undefined,
    });
  } catch {
    throw Object.assign(new Error("unreachable"), { code: "provider_unreachable" as const });
  }
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !data || data.code !== 0) {
    const msg = typeof data?.msg === "string" ? data.msg.replace(/[^\w .,:;()'-]/g, "").slice(0, 160) : "";
    throw Object.assign(new Error(msg || "HTTP " + response.status), { code: "provider_rejected" as const });
  }
  return data;
}

/** Owner-triggered live check. Any failure is reported as provider_unavailable with its reason. */
export async function checkBtccProvider(
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  now: () => Date = () => new Date(),
): Promise<BtccAdapterStatus> {
  const { config } = readBtccConfig(env);
  if (!config) return btccStaticStatus(env, now());
  try {
    const login = await call(config, "POST", "/v1/user/login", { user_name: config.username, password: config.password, company_id: 1, api_key: config.apiKey }, fetchImpl);
    const token = typeof login.token === "string" ? login.token : "";
    const account = login.account as { id?: string | number } | undefined;
    const accountId = account?.id !== undefined ? String(account.id) : config.accountId;
    if (!token || !accountId) throw Object.assign(new Error("BTCC returned no session or account."), { code: "provider_invalid" as const });
    const list = await call(config, "GET", "/v1/account/positionlist", { token, accountid: accountId, pageNo: 1, pageSize: 100 }, fetchImpl);
    const raw = (list.positions ?? list.data ?? list.list) as unknown;
    if (!Array.isArray(raw)) throw Object.assign(new Error("BTCC returned an unrecognised position list."), { code: "provider_invalid" as const });
    const positions: BtccPosition[] = raw.slice(0, 500).filter((r) => r && typeof r === "object").map((r) => {
      const row = r as Record<string, unknown>;
      return {
        symbol: typeof row.symbol === "string" ? row.symbol.slice(0, 64) : "Unknown",
        side: row.direction === 1 || row.direction === "1" ? "long" : row.direction === 2 || row.direction === "2" ? "short" : "unknown",
        size: num(row.volume ?? row.request_volume),
        entryPrice: num(row.open_price ?? row.openPrice),
        leverage: num(row.multiple),
        unrealizedPnl: num(row.profit ?? row.float_profit),
      };
    });
    return {
      status: "available", source: "btcc_official_api_readonly", checkedAt: now().toISOString(), positions,
      balances: null, copyHistory: null,
      note: "BTCC's documented API exposes positions only; balances and copy history come from owner CSV imports.",
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    return {
      status: "provider_unavailable",
      code: code === "provider_rejected" || code === "provider_unreachable" || code === "provider_invalid" ? code : "provider_unreachable",
      reason: BTCC_SUSPENSION_REASON + (code === "provider_rejected"
        ? " The live check was refused by BTCC: " + (error as Error).message + "."
        : code === "provider_invalid" ? " BTCC returned an unrecognised response." : " BTCC could not be reached."),
      noticeUrl: BTCC_SUSPENSION_NOTICE_URL,
      checkedAt: now().toISOString(),
    };
  }
}
