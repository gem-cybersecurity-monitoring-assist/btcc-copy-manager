const DEFAULT_SENTINEL_URL = "http://127.0.0.1:8421";

export type SentinelProvenance = {
  source: "dom" | "xhr" | "screenshot" | "manual" | "derived" | "unknown";
  page_url?: string | null;
  confidence?: number;
  captured_at?: string;
};

export type SentinelAccountState = {
  total_usdt: number;
  futures_free_usdt: number;
  wallet_usdt: number;
  open_margin_usdt: number;
  realized_pnl_today_usdt?: number;
  active_positions?: number;
  source_timestamp?: string;
  provenance?: SentinelProvenance | null;
};

export type SentinelTradeRecord = {
  symbol: string;
  direction: string;
  leverage: number;
  margin_usdt: number;
  pnl_usdt: number;
  pnl_ratio_pct: number;
  opened_at?: string | null;
  closed_at?: string | null;
  close_reason?: string | null;
  provenance?: SentinelProvenance | null;
};

export type SentinelTraderSnapshot = {
  name: string;
  trader_id?: string | null;
  exchange?: "btcc" | "bitget";
  exchange_project_id?: string | null;
  currently_following?: boolean;
  pnl_30d_pct?: number | null;
  aum_usdt?: number | null;
  win_rate_pct?: number | null;
  copiers?: number | null;
  copier_capacity?: number | null;
  recent_trades?: SentinelTradeRecord[];
  executable_min_margin_usdt?: number | null;
  source_timestamp?: string;
  provenance?: SentinelProvenance | null;
};

export type SentinelCollectorBatch = {
  account: SentinelAccountState;
  traders: SentinelTraderSnapshot[];
  collector_id?: string;
  captured_at?: string;
};

const forbiddenCredentialKeys = new Set([
  "password",
  "passwd",
  "secret",
  "secret_key",
  "api_key",
  "apikey",
  "token",
  "session",
  "session_token",
  "cookie",
  "cookies",
  "authorization",
  "two_factor_code",
  "2fa",
  "otp",
]);

export function containsForbiddenCredentialKeys(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsForbiddenCredentialKeys);
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenCredentialKeys.has(key.toLowerCase())) return true;
    if (containsForbiddenCredentialKeys(child)) return true;
  }
  return false;
}

export function sentinelBaseUrl() {
  return (process.env.SENTINEL_URL || DEFAULT_SENTINEL_URL).replace(/\/$/, "");
}

// Bound every upstream response, including chunked bodies without Content-Length.
// Sentinel can return account data; never include upstream bodies in errors.
const MAX_SENTINEL_RESPONSE_BYTES = 1_048_576;

async function readSentinelJson(response: Response): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_SENTINEL_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => {});
    throw new Error("Sentinel response exceeds the supported size.");
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { throw new Error("Sentinel response could not be read."); }
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_SENTINEL_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("Sentinel response exceeds the supported size.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { throw new Error("Sentinel returned an invalid JSON response."); }
}

export async function sentinelRequest<T>(path: string, init?: RequestInit): Promise<T> {
  // Caller paths are internal constants. Reject malformed paths before sending a
  // control token; an upstream redirect must never forward it to another host.
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new Error("Invalid Sentinel request path.");
  }
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  if (process.env.SENTINEL_CONTROL_TOKEN) {
    headers.set("authorization", `Bearer ${process.env.SENTINEL_CONTROL_TOKEN}`);
    headers.set("x-sentinel-control", process.env.SENTINEL_CONTROL_TOKEN);
  }
  let response: Response;
  try {
    response = await fetch(`${sentinelBaseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      redirect: "error",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Sentinel request failed or timed out.");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Sentinel request failed (${response.status}).`);
  }
  return await readSentinelJson(response) as T;
}

export async function getSentinelHealth() {
  return sentinelRequest<{ ok: boolean; mode: string; version: string; has_data: boolean; latest_capture: string | null }>("/health");
}

export async function pushCollectorBatch(batch: SentinelCollectorBatch) {
  if (containsForbiddenCredentialKeys(batch)) {
    throw new Error("Collector batch contains a credential-like field. Secrets, cookies, tokens, passwords, API keys and 2FA values must never be sent to Sentinel.");
  }
  return sentinelRequest("/collector/batch", {
    method: "POST",
    body: JSON.stringify({
      ...batch,
      collector_id: batch.collector_id || "btcc-copy-manager",
      captured_at: batch.captured_at || new Date().toISOString(),
    }),
  });
}
