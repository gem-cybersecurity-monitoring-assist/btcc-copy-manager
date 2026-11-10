// MT5 investor connection for the verified owner.
//
// save:       validate login/server/investor password, encrypt the password
//             server-side and store the record. Status PAUSED with
//             last_error_code "bridge_not_configured" while no bridge exists.
// status:     saved login/server, whether a password is stored, last snapshot.
//             Never returns the password.
// refresh:    decrypt and read through the bridge. Without a bridge: 503
//             bridge_not_configured and nothing is shown or invented.
// disconnect: delete the encrypted password and mark DISCONNECTED.
import { openSecret, readKeyring, sealSecret, type Keyring } from "./connection-secrets.ts";
import { ConnectionStore, StoreError, readServiceStoreConfig, type ConnectionRow } from "./connection-store.ts";
import {
  MT5_NOT_CONFIGURED_REASON,
  Mt5BridgeError,
  mt5AccountRef,
  mt5BridgeFromEnv,
  parseMt5Credentials,
  readMt5Snapshot,
  type Mt5Bridge,
} from "./mt5-adapter.ts";

export type ServiceResult = { status: number; body: Record<string, unknown> };
export type Mt5Deps = {
  store: Pick<ConnectionStore, "findConnection" | "insertConnection" | "updateConnection" | "putSecret" | "getSecret" | "deleteSecret"> | null;
  keyring: Keyring | null;
  missing: string[];
  bridge: Mt5Bridge;
  now?: () => Date;
};

export function mt5DepsFromEnv(env: Record<string, string | undefined>): Mt5Deps {
  const store = readServiceStoreConfig(env);
  const keys = readKeyring(env);
  return {
    store: store.config ? new ConnectionStore(store.config) : null,
    keyring: keys.keyring,
    missing: [...store.missing, ...keys.missing, ...keys.invalid],
    bridge: mt5BridgeFromEnv(env),
  };
}

const VENUE = "mt5" as const;

function parseRef(ref: string | null) {
  const match = ref ? /^mt5:(\d{4,12})@([A-Za-z0-9._-]{2,64})$/.exec(ref) : null;
  return match ? { login: match[1], server: match[2] } : null;
}

function notConfigured(deps: Mt5Deps): ServiceResult | null {
  if (deps.store && deps.keyring) return null;
  return { status: 503, body: { ok: false, code: "connection_storage_not_configured", error: "Saved connections are not configured on this server yet.", missing: [...new Set(deps.missing)] } };
}

function storeFailure(error: unknown): ServiceResult {
  const code = error instanceof StoreError ? error.code : "store_failed";
  return { status: code === "store_not_ready" || code === "store_unreachable" ? 503 : 502, body: { ok: false, code, error: "The MT5 connection could not be read or saved. No credentials were exposed." } };
}

function view(row: ConnectionRow | null, credentialsSaved: boolean, bridge: Mt5Bridge) {
  if (!row) return null;
  return {
    id: row.id, venue: VENUE, status: row.status, account: parseRef(row.externalAccountRef),
    credentialsSaved, lastVerifiedAt: row.lastVerifiedAt, lastErrorCode: row.lastErrorCode,
    snapshot: row.status === "DISCONNECTED" ? null : row.lastSnapshot,
    bridge: { configured: bridge.configured, name: bridge.name, reason: bridge.configured ? null : MT5_NOT_CONFIGURED_REASON },
    access: "investor_readonly",
  };
}

export async function readMt5(deps: Mt5Deps, userId: string): Promise<ServiceResult> {
  const blocked = notConfigured(deps);
  if (blocked) return { ...blocked, body: { ...blocked.body, bridge: { configured: deps.bridge.configured, reason: MT5_NOT_CONFIGURED_REASON } } };
  try {
    const row = await deps.store!.findConnection(userId, VENUE);
    const saved = row ? Boolean(await deps.store!.getSecret(userId, row.id)) : false;
    return { status: 200, body: { ok: true, connection: view(row, saved, deps.bridge), bridge: { configured: deps.bridge.configured, reason: deps.bridge.configured ? null : MT5_NOT_CONFIGURED_REASON } } };
  } catch (error) {
    return storeFailure(error);
  }
}

export async function saveMt5(deps: Mt5Deps, userId: string, input: unknown): Promise<ServiceResult> {
  const credentials = parseMt5Credentials(input);
  if (!credentials) return { status: 400, body: { ok: false, code: "invalid_input", error: "Enter the MT5 login (digits), server name and investor password." } };
  const blocked = notConfigured(deps);
  if (blocked) return blocked;
  const store = deps.store!;
  try {
    const existing = await store.findConnection(userId, VENUE);
    const patch = {
      status: "PAUSED" as const, externalAccountRef: mt5AccountRef(credentials), lastVerifiedAt: null,
      lastSnapshot: null, lastErrorCode: deps.bridge.configured ? null : "bridge_not_configured",
    };
    const row = existing ? await store.updateConnection(userId, existing.id, patch) : await store.insertConnection(userId, VENUE, patch);
    try {
      const sealed = sealSecret(deps.keyring!, { investorPassword: credentials.investorPassword }, { userId, connectionId: row.id, venue: VENUE });
      await store.putSecret(userId, row.id, VENUE, sealed, deps.keyring!.current.version);
    } catch {
      await store.updateConnection(userId, row.id, { status: "ERROR", lastErrorCode: "secret_store_failed" }).catch(() => undefined);
      return { status: 502, body: { ok: false, code: "secret_store_failed", error: "The investor password could not be saved. Nothing usable was stored; try again." } };
    }
    if (deps.bridge.configured) return refreshMt5(deps, userId);
    return {
      status: 200,
      body: { ok: true, connection: view(row, true, deps.bridge), message: "MT5 investor login saved and encrypted on the server. It is not connected: no MT5 bridge is configured yet, so no balances are shown." },
    };
  } catch (error) {
    return storeFailure(error);
  }
}

export async function refreshMt5(deps: Mt5Deps, userId: string): Promise<ServiceResult> {
  const blocked = notConfigured(deps);
  if (blocked) return blocked;
  const store = deps.store!;
  let row: ConnectionRow | null;
  try { row = await store.findConnection(userId, VENUE); } catch (error) { return storeFailure(error); }
  const account = parseRef(row?.externalAccountRef ?? null);
  if (!row || row.status === "DISCONNECTED" || !account) return { status: 404, body: { ok: false, code: "not_connected", error: "No MT5 investor login is saved." } };
  if (!deps.bridge.configured) return { status: 503, body: { ok: false, code: "bridge_not_configured", error: MT5_NOT_CONFIGURED_REASON } };
  let password: string;
  try {
    const stored = await store.getSecret(userId, row.id);
    if (!stored) return { status: 409, body: { ok: false, code: "credentials_missing", error: "No investor password is saved. Save the MT5 login again." } };
    password = openSecret(deps.keyring!, stored.sealedSecret, { userId, connectionId: row.id, venue: VENUE }).investorPassword ?? "";
    if (!password) throw new Error("empty");
  } catch {
    await store.updateConnection(userId, row.id, { status: "ERROR", lastErrorCode: "credentials_unreadable" }).catch(() => undefined);
    return { status: 409, body: { ok: false, code: "credentials_unreadable", error: "The saved investor password could not be decrypted. Save the MT5 login again." } };
  }
  try {
    const snapshot = await readMt5Snapshot(deps.bridge, { ...account, investorPassword: password }, (deps.now ?? (() => new Date()))());
    const updated = await store.updateConnection(userId, row.id, {
      status: "READ_ONLY", lastVerifiedAt: snapshot.capturedAt, lastSnapshot: snapshot as unknown as Record<string, unknown>, lastErrorCode: null,
    });
    return { status: 200, body: { ok: true, connection: view(updated, true, deps.bridge) } };
  } catch (error) {
    const code = error instanceof Mt5BridgeError ? error.code : "bridge_unreachable";
    if (code === "not_investor_login") {
      await store.deleteSecret(userId, row.id).catch(() => undefined);
    }
    await store.updateConnection(userId, row.id, { status: "ERROR", lastErrorCode: code }).catch(() => undefined);
    return {
      status: code === "not_investor_login" ? 403 : 502,
      body: { ok: false, code, error: error instanceof Mt5BridgeError ? error.message : "The MT5 bridge could not be reached." },
    };
  }
}

export async function disconnectMt5(deps: Mt5Deps, userId: string): Promise<ServiceResult> {
  const blocked = notConfigured(deps);
  if (blocked) return blocked;
  try {
    const row = await deps.store!.findConnection(userId, VENUE);
    if (!row) return { status: 200, body: { ok: true, connection: null } };
    await deps.store!.deleteSecret(userId, row.id);
    const updated = await deps.store!.updateConnection(userId, row.id, { status: "DISCONNECTED", lastSnapshot: null, lastErrorCode: null });
    return { status: 200, body: { ok: true, connection: view(updated, false, deps.bridge), message: "MT5 investor password deleted." } };
  } catch (error) {
    return storeFailure(error);
  }
}
