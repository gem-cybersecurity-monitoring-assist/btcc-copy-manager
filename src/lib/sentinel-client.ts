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

export async function sentinelRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${sentinelBaseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(process.env.SENTINEL_CONTROL_TOKEN
        ? {
            authorization: `Bearer ${process.env.SENTINEL_CONTROL_TOKEN}`,
            "x-sentinel-control": process.env.SENTINEL_CONTROL_TOKEN,
          }
        : {}),
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Sentinel ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body as T;
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
