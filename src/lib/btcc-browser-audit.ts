export type BtccAuditCheckpointName =
  | "account-overview"
  | "futures"
  | "copy-traders"
  | "copy-history"
  | "earn"
  | "benefits-rewards"
  | "funding-history"
  | "referral-affiliate"
  | "lead-trader-marketplace";

export type BtccNetworkObservation = {
  capturedAt: string;
  url: string;
  resourceType: string;
  mimeType: string;
  status: number;
  payload?: unknown;
};

export type BtccAuditCheckpoint = {
  name: BtccAuditCheckpointName;
  capturedAt: string;
  url: string;
  title: string;
  evidence: string[];
  network: BtccNetworkObservation[];
};

export type BtccBrowserAuditSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  mode: "READ_ONLY";
  source: "local-chrome-cdp";
  checkpoints: BtccAuditCheckpoint[];
};

const SENSITIVE_KEY = /(?:pass(?:word)?|secret|token|cookie|authorization|auth(?:entication)?|session(?:.?id)?|credential|private.?key|seed|mnemonic|recovery|otp|mfa|2fa|api.?key|access.?key|refresh.?key|client.?secret|signature|sign|email|phone|mobile|(?:account|user).?id|uid)$/i;
const SENSITIVE_LINE = /(?:password|passcode|seed phrase|private key|recovery code|authenticator code|api secret|session cookie|bearer\s+[a-z0-9._-]|\b(?:account|user)\s*(?:id|uid)\b)/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/;
const LONG_SECRET = /\b(?:eyJ[a-zA-Z0-9_-]{20,}|[a-f0-9]{48,}|[A-Za-z0-9_-]{64,})\b/;

const EVIDENCE_TERMS = [
  "account value", "total value", "total asset", "total assets", "equity", "available", "balance",
  "margin", "risk", "safe", "pnl", "profit", "loss", "fee", "funding", "copy", "trader", "roi",
  "drawdown", "win rate", "leverage", "position", "open position", "closed position", "order", "apr", "apy",
  "earn", "reward", "voucher", "trading fund", "coupon", "vip", "referral", "affiliate", "commission", "usdt"
];

export function sanitizeBtccUrl(input: string) {
  try {
    const url = new URL(input);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function sanitizeString(value: string) {
  let output = value;
  if (EMAIL.test(output)) output = output.replace(EMAIL, "[REDACTED_EMAIL]");
  if (PHONE.test(output)) output = output.replace(PHONE, "[REDACTED_PHONE]");
  if (LONG_SECRET.test(output)) output = output.replace(LONG_SECRET, "[REDACTED_SECRET]");
  return output.length > 1_000 ? `${output.slice(0, 1_000)}…` : output;
}

export function sanitizeBtccValue(value: unknown, depth = 0): unknown {
  if (depth > 7) return "[TRUNCATED_DEPTH]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return sanitizeString(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeBtccValue(item, depth + 1));
  if (typeof value !== "object") return String(value);

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    result[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeBtccValue(item, depth + 1);
  }
  return result;
}

export function extractBtccEvidence(text: string, limit = 120) {
  const seen = new Set<string>();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => line.length <= 220)
    .filter((line) => !SENSITIVE_LINE.test(line))
    .filter((line) => !EMAIL.test(line) && !PHONE.test(line) && !LONG_SECRET.test(line))
    .filter((line) => {
      const normalized = line.toLowerCase();
      return EVIDENCE_TERMS.some((term) => normalized.includes(term));
    });

  const result: string[] = [];
  for (const line of lines) {
    const sanitized = sanitizeString(line);
    if (!seen.has(sanitized)) {
      seen.add(sanitized);
      result.push(sanitized);
    }
    if (result.length >= limit) break;
  }
  return result;
}

export function isBtccJsonResponse(input: { url: string; mimeType?: string; resourceType?: string }) {
  try {
    const host = new URL(input.url).hostname.toLowerCase();
    const isBtcc = /^([a-z0-9-]+\.)*btcc[a-z0-9-]*\.[a-z]{2,}$/i.test(host);
    const mime = (input.mimeType || "").toLowerCase();
    const resource = (input.resourceType || "").toLowerCase();
    return isBtcc && (mime.includes("json") || resource === "xhr" || resource === "fetch");
  } catch {
    return false;
  }
}
