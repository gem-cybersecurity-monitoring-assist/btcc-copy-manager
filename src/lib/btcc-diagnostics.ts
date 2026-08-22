import "server-only";

import { getLiveConfigurationStatus, getLivePositions } from "./btcc-live";

export type BtccDiagnosticCategory =
  | "ok"
  | "configuration"
  | "timeout"
  | "network"
  | "authentication"
  | "exchange"
  | "unknown";

export type BtccDiagnostics = {
  configured: boolean;
  baseUrlValid: boolean;
  networkReachable: boolean;
  accountRead: "ok" | "failed" | "not-tested";
  category: BtccDiagnosticCategory;
  message: string;
  observedAt: string;
};

function classifyError(error: unknown): Pick<BtccDiagnostics, "category" | "message"> {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const value = raw.toLowerCase();

  if (value.includes("timeout") || value.includes("aborted")) {
    return { category: "timeout", message: "BTCC did not respond before the server timeout." };
  }
  if (
    value.includes("enotfound") ||
    value.includes("econnrefused") ||
    value.includes("fetch failed") ||
    value.includes("network")
  ) {
    return { category: "network", message: "The BTCC API host could not be reached from the server runtime." };
  }
  if (
    value.includes("unauthorized") ||
    value.includes("forbidden") ||
    value.includes("invalid") ||
    value.includes("login") ||
    value.includes("credential") ||
    value.includes("signature")
  ) {
    return { category: "authentication", message: "BTCC rejected the authenticated account-read request." };
  }
  if (value.includes("btcc")) {
    return { category: "exchange", message: "BTCC returned an exchange-side error for the account-read request." };
  }
  return { category: "unknown", message: "The BTCC account-read request failed for an unclassified reason." };
}

function getBaseUrl(): URL | null {
  try {
    const candidate = process.env.BTCC_API_BASE_URL;
    if (!candidate) return null;
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function runBtccDiagnostics(): Promise<BtccDiagnostics> {
  const observedAt = new Date().toISOString();
  const status = getLiveConfigurationStatus();
  const baseUrl = getBaseUrl();

  if (!status.ready) {
    return {
      configured: false,
      baseUrlValid: Boolean(baseUrl),
      networkReachable: false,
      accountRead: "not-tested",
      category: "configuration",
      message: "Live configuration is incomplete or disabled.",
      observedAt
    };
  }

  if (!baseUrl) {
    return {
      configured: true,
      baseUrlValid: false,
      networkReachable: false,
      accountRead: "not-tested",
      category: "configuration",
      message: "BTCC_API_BASE_URL is not a valid HTTPS URL.",
      observedAt
    };
  }

  let networkReachable = false;
  try {
    const response = await fetch(baseUrl.toString(), {
      method: "GET",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(5_000)
    });
    // Any HTTP response proves the host and TLS endpoint were reachable.
    networkReachable = response.status >= 100;
  } catch (error) {
    const classified = classifyError(error);
    return {
      configured: true,
      baseUrlValid: true,
      networkReachable: false,
      accountRead: "not-tested",
      ...classified,
      observedAt
    };
  }

  try {
    // Read-only diagnostic. The returned position payload is intentionally discarded.
    await getLivePositions();
    return {
      configured: true,
      baseUrlValid: true,
      networkReachable,
      accountRead: "ok",
      category: "ok",
      message: "BTCC server connectivity and authenticated account read succeeded.",
      observedAt
    };
  } catch (error) {
    const classified = classifyError(error);
    return {
      configured: true,
      baseUrlValid: true,
      networkReachable,
      accountRead: "failed",
      ...classified,
      observedAt
    };
  }
}
