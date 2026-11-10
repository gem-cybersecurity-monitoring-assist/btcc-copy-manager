// Cross-device sync decisions for Copy Center preferences.
//
// Only the server-whitelisted preference fields sync: budget, max loss,
// activity log and public wallet addresses (see normalizeCopyCenter). Exchange
// credentials, connection state and imports never travel through the
// workspace; they live server-side and are read from their own routes.
//
// Each device remembers, per signed-in user, the fingerprint and cloud revision
// it last synced. Comparing that with the current local and cloud preferences
// tells us which side changed:
//   only cloud changed -> apply cloud      only local changed -> push local
//   both changed       -> conflict (the owner chooses; nothing is overwritten)
import { normalizeCopyCenter, type CopyCenterPreferences } from "./workspace.ts";

export type SyncMeta = { userId: string; updatedAt: string | null; fingerprint: string };
export type SyncAction = "in_sync" | "apply_cloud" | "push_local" | "conflict";
export const SYNC_META_KEY = "gem-copy-center-sync-v1";
export const DEFAULT_PREFERENCES: CopyCenterPreferences = { budget: "10", maxLoss: "2", activity: [] };

/** Normalizes local state through the same whitelist the server enforces. */
export function syncablePreferences(input: {
  budget: unknown; maxLoss: unknown; activity: unknown; walletAddresses?: unknown;
}): CopyCenterPreferences | null {
  const activity = Array.isArray(input.activity) ? input.activity.slice(0, 50) : input.activity;
  const wallets = input.walletAddresses && typeof input.walletAddresses === "object" && Object.keys(input.walletAddresses).length
    ? input.walletAddresses : undefined;
  return normalizeCopyCenter({ budget: input.budget, maxLoss: input.maxLoss, activity, ...(wallets ? { walletAddresses: wallets } : {}) });
}

/** Stable content fingerprint (key order and empty wallet maps do not matter). */
export function fingerprint(prefs: CopyCenterPreferences | null): string {
  if (!prefs) return "none";
  const wallets = prefs.walletAddresses ?? {};
  return JSON.stringify([
    prefs.budget, prefs.maxLoss,
    prefs.activity.map((a) => [a.id, a.at, a.title, a.detail]),
    ["phantom", "metamask", "base"].map((k) => (wallets as Record<string, string | undefined>)[k] ?? null),
  ]);
}

export function isDefaultPreferences(prefs: CopyCenterPreferences | null): boolean {
  return fingerprint(prefs) === fingerprint(DEFAULT_PREFERENCES);
}

export function decideSync(input: {
  local: CopyCenterPreferences | null;
  cloud: CopyCenterPreferences | null;
  meta: SyncMeta | null;
}): SyncAction {
  const localFp = fingerprint(input.local);
  const cloudFp = fingerprint(input.cloud);
  if (localFp === cloudFp) return "in_sync";
  if (!input.cloud) return input.local ? "push_local" : "in_sync";
  if (!input.local) return "apply_cloud";
  if (!input.meta) {
    // A device that has never synced for this user: an untouched device takes the cloud.
    return isDefaultPreferences(input.local) ? "apply_cloud" : "conflict";
  }
  const localChanged = input.meta.fingerprint !== localFp;
  const cloudChanged = input.meta.fingerprint !== cloudFp;
  if (!localChanged) return "apply_cloud";
  if (!cloudChanged) return "push_local";
  return "conflict";
}

export function readSyncMeta(raw: string | null, userId: string | undefined): SyncMeta | null {
  if (!raw || !userId) return null;
  try {
    const parsed = JSON.parse(raw) as SyncMeta;
    if (!parsed || parsed.userId !== userId || typeof parsed.fingerprint !== "string" || parsed.fingerprint.length > 200_000) return null;
    if (!(parsed.updatedAt === null || (typeof parsed.updatedAt === "string" && parsed.updatedAt.length <= 64))) return null;
    return { userId: parsed.userId, updatedAt: parsed.updatedAt, fingerprint: parsed.fingerprint };
  } catch {
    return null;
  }
}
