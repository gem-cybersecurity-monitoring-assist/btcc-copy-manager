// Persistent read-only Bitget connection for the verified workspace owner.
//
// connect:    verify read-only permissions, read balances/positions, then seal
//             the credentials (AES-256-GCM) and store them server-side.
// status:     return the stored connection status and last snapshot. No
//             provider call and never any credential material.
// refresh:    open the sealed credentials, re-check that the key is still
//             read-only (uta_mgt, no trade/withdraw/copy scopes), and read again.
// disconnect: delete the sealed credentials and mark the connection
//             DISCONNECTED; saved snapshot history is kept.
//
// Every operation receives an owner id the route has already verified.
import { createHash } from "node:crypto";
import {
  BitgetReadError,
  parseCredentials,
  readBitgetSnapshot,
  type BitgetCredentials,
  type BitgetSnapshot,
} from "./bitget-read-client.ts";
import { openSecret, readKeyring, sealSecret, sealedKeyVersion, type Keyring } from "./connection-secrets.ts";
import {
  ConnectionStore,
  StoreError,
  readServiceStoreConfig,
  type ConnectionRow,
  type FetchLike,
} from "./connection-store.ts";

export type ServiceResult = { status: number; body: Record<string, unknown> };

export type BitgetConnectionDeps = {
  store: Pick<ConnectionStore, "findConnection" | "insertConnection" | "updateConnection" | "putSecret" | "getSecret" | "deleteSecret" | "recordSnapshot"> | null;
  keyring: Keyring | null;
  /** Server environment variable names that are missing or invalid. Never values. */
  missing: string[];
  bitgetFetch?: FetchLike;
  now?: () => Date;
};

export function bitgetConnectionDepsFromEnv(env: Record<string, string | undefined>): BitgetConnectionDeps {
  const store = readServiceStoreConfig(env);
  const keys = readKeyring(env);
  return {
    store: store.config ? new ConnectionStore(store.config) : null,
    keyring: keys.keyring,
    missing: [...store.missing, ...keys.missing, ...keys.invalid],
  };
}

const VENUE = "bitget" as const;
const SOURCE = "bitget_official_api_readonly";

function notConfigured(deps: BitgetConnectionDeps): ServiceResult | null {
  if (deps.store && deps.keyring) return null;
  return {
    status: 503,
    body: {
      ok: false,
      code: "connection_storage_not_configured",
      error: "Saved connections are not configured on this server yet. The one-time verification still works.",
      missing: [...new Set(deps.missing)],
    },
  };
}

function storeFailure(error: unknown): ServiceResult {
  const code = error instanceof StoreError ? error.code : "store_failed";
  return {
    status: code === "store_not_ready" || code === "store_unreachable" ? 503 : 502,
    body: {
      ok: false,
      code,
      error: code === "store_not_ready"
        ? "The connection tables have not been created in this database yet."
        : "The saved connection could not be read or updated. No credentials were exposed.",
    },
  };
}

function providerFailure(error: unknown): ServiceResult {
  if (error instanceof BitgetReadError) {
    return {
      status: error.httpStatus,
      body: {
        ok: false,
        code: error.code,
        providerCode: error.providerCode,
        error: error.code === "credentials_rejected" || error.code === "provider_rejected"
          ? "Bitget rejected the credentials. Check the API key, secret, passphrase and IP allow-list."
          : "Bitget could not be reached safely. Try again later.",
      },
    };
  }
  return { status: 502, body: { ok: false, code: "provider_failed", error: "Bitget could not be reached safely. Try again later." } };
}

function notReadOnly(permType: unknown, permissions: unknown): ServiceResult {
  return {
    status: 403,
    body: {
      ok: false,
      code: "not_read_only",
      error: `This key is not strictly read-only. Create a Bitget API key with permission type read-only and UTA management; remove trading, copy-trading and withdrawal permissions. Bitget reported permType ${JSON.stringify(permType ?? null)} with permissions ${JSON.stringify(permissions ?? null)}.`,
    },
  };
}

/** Safe, credential-free view of a connection for the browser. */
export function publicConnection(row: ConnectionRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    venue: row.venue,
    status: row.status,
    lastVerifiedAt: row.lastVerifiedAt,
    lastErrorCode: row.lastErrorCode,
    updatedAt: row.updatedAt,
    snapshot: row.lastSnapshot,
    source: SOURCE,
    readOnly: true,
  };
}

function ledgerRow(connectionId: string, snapshot: BitgetSnapshot) {
  if (snapshot.balances.accountEquityUsd === null || snapshot.balances.accountEquityUsd < 0) return null;
  const decimal = (value: number | null) => (value === null ? null : String(value));
  const material = JSON.stringify([connectionId, snapshot.capturedAt, snapshot.balances.accountEquityUsd, snapshot.balances.unrealizedPnlUsd]);
  return {
    connectionId,
    capturedAt: snapshot.capturedAt,
    sourceKind: "official_api" as const,
    equityQuote: decimal(snapshot.balances.accountEquityUsd),
    availableQuote: null,
    unrealizedPnlQuote: decimal(snapshot.balances.unrealizedPnlUsd),
    quoteCurrency: "USD" as const,
    snapshotHash: createHash("sha256").update(material).digest("hex"),
  };
}

async function recordLedger(deps: BitgetConnectionDeps, userId: string, connectionId: string, snapshot: BitgetSnapshot) {
  const row = ledgerRow(connectionId, snapshot);
  if (!row || !deps.store) return false;
  try {
    await deps.store.recordSnapshot(userId, row);
    return true;
  } catch {
    return false;
  }
}

export async function readBitgetConnection(deps: BitgetConnectionDeps, userId: string): Promise<ServiceResult> {
  const blocked = notConfigured(deps);
  if (blocked) return blocked;
  try {
    const row = await deps.store!.findConnection(userId, VENUE);
    return { status: 200, body: { ok: true, connection: publicConnection(row) } };
  } catch (error) {
    return storeFailure(error);
  }
}

export async function connectBitget(deps: BitgetConnectionDeps, userId: string, input: unknown): Promise<ServiceResult> {
  const credentials = parseCredentials(input);
  if (!credentials) return { status: 400, body: { ok: false, code: "invalid_input", error: "Enter the Bitget API key, secret, and passphrase." } };
  const blocked = notConfigured(deps);
  if (blocked) return blocked;
  let result: Awaited<ReturnType<typeof readBitgetSnapshot>>;
  try {
    result = await readBitgetSnapshot(credentials, deps.bitgetFetch, deps.now);
  } catch (error) {
    return providerFailure(error);
  }
  if (!result.snapshot) return notReadOnly(result.permission.permType, result.permission.permissions);
  const snapshot = result.snapshot;
  const store = deps.store!;
  let row: ConnectionRow;
  try {
    const existing = await store.findConnection(userId, VENUE);
    const patch = {
      status: "READ_ONLY" as const,
      externalAccountRef: snapshot.exchangeUserId ? "bitget-uta:" + snapshot.exchangeUserId : null,
      lastVerifiedAt: snapshot.capturedAt,
      lastSnapshot: { ...(snapshot as unknown as Record<string, unknown>), ledgerRecordedAt: snapshot.capturedAt },
      lastErrorCode: null,
    };
    row = existing ? await store.updateConnection(userId, existing.id, patch) : await store.insertConnection(userId, VENUE, patch);
  } catch (error) {
    return storeFailure(error);
  }
  try {
    const sealed = sealSecret(deps.keyring!, credentials, { userId, connectionId: row.id, venue: VENUE });
    await store.putSecret(userId, row.id, VENUE, sealed, deps.keyring!.current.version);
  } catch {
    try { await store.updateConnection(userId, row.id, { status: "ERROR", lastErrorCode: "secret_store_failed" }); } catch { /* reported below */ }
    return { status: 502, body: { ok: false, code: "secret_store_failed", error: "Bitget verified the key, but the encrypted credential could not be saved. Nothing usable was stored; try again." } };
  }
  const ledgerRecorded = await recordLedger(deps, userId, row.id, snapshot);
  return {
    status: 200,
    body: {
      ok: true,
      connection: publicConnection(row),
      credentialsStored: "encrypted_server_side",
      ledgerRecorded,
      message: "Read-only Bitget connection saved. Credentials are encrypted on the server and are never sent back to the browser.",
    },
  };
}

async function loadCredentials(deps: BitgetConnectionDeps, userId: string, row: ConnectionRow): Promise<{ credentials: BitgetCredentials; needsReseal: boolean } | ServiceResult> {
  let stored;
  try {
    stored = await deps.store!.getSecret(userId, row.id);
  } catch (error) {
    return storeFailure(error);
  }
  if (!stored) return { status: 409, body: { ok: false, code: "credentials_missing", error: "No saved credentials for this connection. Connect Bitget again." } };
  try {
    const plain = openSecret(deps.keyring!, stored.sealedSecret, { userId, connectionId: row.id, venue: VENUE });
    const credentials = parseCredentials(plain);
    if (!credentials) throw new Error("bad credentials");
    return { credentials, needsReseal: sealedKeyVersion(stored.sealedSecret) !== deps.keyring!.current.version };
  } catch {
    try { await deps.store!.updateConnection(userId, row.id, { status: "ERROR", lastErrorCode: "credentials_unreadable" }); } catch { /* ignore */ }
    return { status: 409, body: { ok: false, code: "credentials_unreadable", error: "The saved credentials could not be decrypted with the server key. Connect Bitget again." } };
  }
}

/** Live refreshes may run every minute; the performance history keeps at most one point per interval. */
export const LEDGER_INTERVAL_MS = 15 * 60 * 1000;

export function ledgerDue(previous: Record<string, unknown> | null, capturedAt: string): boolean {
  const last = typeof previous?.ledgerRecordedAt === "string" ? Date.parse(previous.ledgerRecordedAt) : NaN;
  return !Number.isFinite(last) || Date.parse(capturedAt) - last >= LEDGER_INTERVAL_MS;
}

export async function refreshBitgetConnection(deps: BitgetConnectionDeps, userId: string): Promise<ServiceResult> {
  const blocked = notConfigured(deps);
  if (blocked) return blocked;
  const store = deps.store!;
  let row: ConnectionRow | null;
  try {
    row = await store.findConnection(userId, VENUE);
  } catch (error) {
    return storeFailure(error);
  }
  if (!row || row.status === "DISCONNECTED") return { status: 404, body: { ok: false, code: "not_connected", error: "Bitget is not connected. Save a read-only connection first." } };
  const loaded = await loadCredentials(deps, userId, row);
  if ("status" in loaded) return loaded;
  let result: Awaited<ReturnType<typeof readBitgetSnapshot>>;
  try {
    result = await readBitgetSnapshot(loaded.credentials, deps.bitgetFetch, deps.now);
  } catch (error) {
    const failure = providerFailure(error);
    try { await store.updateConnection(userId, row.id, { status: "ERROR", lastErrorCode: String(failure.body.code) }); } catch { /* ignore */ }
    return failure;
  }
  if (!result.snapshot) {
    // The key gained trade/withdraw/copy permissions or lost read-only status:
    // stop using it, keep nothing usable and require a new read-only key.
    try {
      await store.deleteSecret(userId, row.id);
      await store.updateConnection(userId, row.id, { status: "ERROR", lastErrorCode: "not_read_only" });
    } catch { /* the 403 below still blocks use */ }
    return notReadOnly(result.permission.permType, result.permission.permissions);
  }
  let shouldRecord = false;
  try {
    if (loaded.needsReseal) {
      const sealed = sealSecret(deps.keyring!, loaded.credentials, { userId, connectionId: row.id, venue: VENUE });
      await store.putSecret(userId, row.id, VENUE, sealed, deps.keyring!.current.version);
    }
    const previous = row.lastSnapshot;
    shouldRecord = ledgerDue(previous, result.snapshot.capturedAt);
    const ledgerRecordedAt = shouldRecord
      ? result.snapshot.capturedAt
      : (typeof previous?.ledgerRecordedAt === "string" ? previous.ledgerRecordedAt : null);
    row = await store.updateConnection(userId, row.id, {
      status: "READ_ONLY",
      lastVerifiedAt: result.snapshot.capturedAt,
      lastSnapshot: { ...(result.snapshot as unknown as Record<string, unknown>), ledgerRecordedAt },
      lastErrorCode: null,
    });
  } catch (error) {
    return storeFailure(error);
  }
  const ledgerRecorded = shouldRecord ? await recordLedger(deps, userId, row.id, result.snapshot) : false;
  return { status: 200, body: { ok: true, connection: publicConnection(row), ledgerRecorded } };
}

export async function disconnectBitget(deps: BitgetConnectionDeps, userId: string): Promise<ServiceResult> {
  const blocked = notConfigured(deps);
  if (blocked) return blocked;
  try {
    const row = await deps.store!.findConnection(userId, VENUE);
    if (!row) return { status: 200, body: { ok: true, connection: null } };
    await deps.store!.deleteSecret(userId, row.id);
    const updated = await deps.store!.updateConnection(userId, row.id, { status: "DISCONNECTED", lastSnapshot: null, lastErrorCode: null });
    return { status: 200, body: { ok: true, connection: publicConnection(updated), message: "Bitget disconnected. Saved credentials were deleted; past balance observations remain in your history." } };
  } catch (error) {
    return storeFailure(error);
  }
}
