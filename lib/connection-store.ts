// Server-only persistence for read-only exchange connections.
//
// Uses the Supabase service-role key (SUPABASE_SERVICE_ROLE_KEY), which must
// exist only in the server environment. Every query is filtered by the owner
// id that the caller already verified; no method accepts a client-chosen owner.
// Sealed credentials are written and read here and never returned to routes in
// any shape other than the sealed string for lib/connection-secrets.ts.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Venue = "bitget" | "btcc" | "gate" | "mt5" | "other";
export type ConnectionStatus = "DISCONNECTED" | "READ_ONLY" | "VERIFIED" | "PAUSED" | "ERROR";

export type ConnectionRow = {
  id: string;
  venue: Venue;
  status: ConnectionStatus;
  externalAccountRef: string | null;
  lastVerifiedAt: string | null;
  lastSnapshot: Record<string, unknown> | null;
  lastErrorCode: string | null;
  updatedAt: string;
};

export type ConnectionPatch = Partial<{
  status: ConnectionStatus;
  externalAccountRef: string | null;
  lastVerifiedAt: string | null;
  lastSnapshot: Record<string, unknown> | null;
  lastErrorCode: string | null;
}>;

export type SnapshotLedgerRow = {
  connectionId: string;
  capturedAt: string;
  sourceKind: "official_api" | "manual_attestation";
  equityQuote: string | null;
  availableQuote: string | null;
  unrealizedPnlQuote: string | null;
  quoteCurrency: "USDT" | "USD" | "USDC" | "EUR";
  snapshotHash: string;
};

export class StoreError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VENUES: Venue[] = ["bitget", "btcc", "gate", "mt5", "other"];
const STATUSES: ConnectionStatus[] = ["DISCONNECTED", "READ_ONLY", "VERIFIED", "PAUSED", "ERROR"];
const CONNECTION_FIELDS = "id,venue,connection_status,external_account_ref,last_verified_at,last_snapshot,last_error_code,updated_at";

export type ServiceStoreConfig = { url: string; serviceKey: string };

/** Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Reports names only. */
export function readServiceStoreConfig(env: Record<string, string | undefined>): { config: ServiceStoreConfig | null; missing: string[] } {
  const missing: string[] = [];
  const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return { config: null, missing };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1")
      return { config: null, missing: ["SUPABASE_URL"] };
  } catch {
    return { config: null, missing: ["SUPABASE_URL"] };
  }
  return { config: { url, serviceKey }, missing };
}

function requireUuid(value: string, name: string) {
  if (!UUID.test(value)) throw new StoreError("invalid_identifier", `Invalid ${name}.`);
  return value.toLowerCase();
}

function parseConnection(record: unknown): ConnectionRow {
  const row = record as Record<string, unknown> | null;
  if (!row || typeof row !== "object" || Array.isArray(row) ||
      typeof row.id !== "string" || !UUID.test(row.id) ||
      !VENUES.includes(row.venue as Venue) ||
      !STATUSES.includes(row.connection_status as ConnectionStatus) ||
      typeof row.updated_at !== "string" ||
      !(row.external_account_ref === null || typeof row.external_account_ref === "string") ||
      !(row.last_verified_at === null || typeof row.last_verified_at === "string") ||
      !(row.last_error_code === null || row.last_error_code === undefined || typeof row.last_error_code === "string") ||
      !(row.last_snapshot === null || row.last_snapshot === undefined ||
        (typeof row.last_snapshot === "object" && !Array.isArray(row.last_snapshot))))
    throw new StoreError("store_invalid", "The connection store returned an unexpected record.");
  return {
    id: row.id.toLowerCase(),
    venue: row.venue as Venue,
    status: row.connection_status as ConnectionStatus,
    externalAccountRef: (row.external_account_ref as string | null) ?? null,
    lastVerifiedAt: (row.last_verified_at as string | null) ?? null,
    lastSnapshot: (row.last_snapshot as Record<string, unknown> | null) ?? null,
    lastErrorCode: (row.last_error_code as string | null) ?? null,
    updatedAt: row.updated_at,
  };
}

function patchBody(patch: ConnectionPatch) {
  const body: Record<string, unknown> = {};
  if (patch.status !== undefined) body.connection_status = patch.status;
  if (patch.externalAccountRef !== undefined) body.external_account_ref = patch.externalAccountRef;
  if (patch.lastVerifiedAt !== undefined) body.last_verified_at = patch.lastVerifiedAt;
  if (patch.lastSnapshot !== undefined) body.last_snapshot = patch.lastSnapshot;
  if (patch.lastErrorCode !== undefined) body.last_error_code = patch.lastErrorCode;
  return body;
}

export class ConnectionStore {
  private readonly config: ServiceStoreConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: ServiceStoreConfig, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    // Legacy service_role keys are JWTs and go in Authorization as well; the
    // newer opaque secret keys (sb_secret_...) are accepted via apikey only.
    const headers: Record<string, string> = { apikey: this.config.serviceKey, "Content-Type": "application/json", ...extra };
    if (this.config.serviceKey.startsWith("eyJ")) headers.Authorization = "Bearer " + this.config.serviceKey;
    return headers;
  }

  private async call(path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<{ ok: boolean; status: number; data: any }> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.url + path, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: this.headers(init.headers),
      });
    } catch {
      throw new StoreError("store_unreachable", "The connection store could not be reached.");
    }
    const text = await response.text().catch(() => "");
    if (text.length > 1_048_576) throw new StoreError("store_invalid", "The connection store response was too large.");
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!response.ok) {
      const code = String(data?.code ?? "");
      if (response.status === 404 || code === "PGRST205" || code === "42P01" || code === "42703")
        throw new StoreError("store_not_ready", "The connection tables have not been created in this database yet.");
      throw new StoreError("store_failed", "The connection store rejected the request.");
    }
    return { ok: true, status: response.status, data };
  }

  async findConnection(userId: string, venue: Venue): Promise<ConnectionRow | null> {
    const query = new URLSearchParams({
      select: CONNECTION_FIELDS,
      user_id: "eq." + requireUuid(userId, "owner"),
      venue: "eq." + venue,
      order: "updated_at.desc",
      limit: "1",
    });
    const { data } = await this.call("/rest/v1/gem_copy_connections?" + query);
    if (!Array.isArray(data)) throw new StoreError("store_invalid", "The connection store returned an unexpected result.");
    return data.length ? parseConnection(data[0]) : null;
  }

  async insertConnection(userId: string, venue: Venue, patch: ConnectionPatch): Promise<ConnectionRow> {
    const { data } = await this.call("/rest/v1/gem_copy_connections?select=" + CONNECTION_FIELDS, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: requireUuid(userId, "owner"), venue, ...patchBody(patch) }),
    });
    if (!Array.isArray(data) || data.length !== 1) throw new StoreError("store_invalid", "The connection was not created.");
    return parseConnection(data[0]);
  }

  async updateConnection(userId: string, connectionId: string, patch: ConnectionPatch): Promise<ConnectionRow> {
    const query = new URLSearchParams({
      select: CONNECTION_FIELDS,
      id: "eq." + requireUuid(connectionId, "connection"),
      user_id: "eq." + requireUuid(userId, "owner"),
    });
    const { data } = await this.call("/rest/v1/gem_copy_connections?" + query, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patchBody(patch)),
    });
    if (!Array.isArray(data) || data.length !== 1) throw new StoreError("store_invalid", "The connection was not updated.");
    return parseConnection(data[0]);
  }

  async putSecret(userId: string, connectionId: string, venue: Venue, sealedSecret: string, keyVersion: number): Promise<void> {
    if (!sealedSecret.startsWith("gcs1.")) throw new StoreError("store_invalid", "Only sealed credentials can be stored.");
    await this.call("/rest/v1/gem_copy_connection_secrets?on_conflict=connection_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        connection_id: requireUuid(connectionId, "connection"),
        user_id: requireUuid(userId, "owner"),
        venue,
        key_version: keyVersion,
        sealed_secret: sealedSecret,
      }),
    });
  }

  async getSecret(userId: string, connectionId: string): Promise<{ sealedSecret: string; keyVersion: number; venue: Venue } | null> {
    const query = new URLSearchParams({
      select: "sealed_secret,key_version,venue",
      connection_id: "eq." + requireUuid(connectionId, "connection"),
      user_id: "eq." + requireUuid(userId, "owner"),
      limit: "1",
    });
    const { data } = await this.call("/rest/v1/gem_copy_connection_secrets?" + query);
    if (!Array.isArray(data)) throw new StoreError("store_invalid", "The connection store returned an unexpected result.");
    const row = data[0];
    if (!row) return null;
    if (typeof row.sealed_secret !== "string" || !Number.isInteger(row.key_version) || !VENUES.includes(row.venue))
      throw new StoreError("store_invalid", "The stored credential record is invalid.");
    return { sealedSecret: row.sealed_secret, keyVersion: row.key_version, venue: row.venue };
  }

  async deleteSecret(userId: string, connectionId: string): Promise<void> {
    const query = new URLSearchParams({
      connection_id: "eq." + requireUuid(connectionId, "connection"),
      user_id: "eq." + requireUuid(userId, "owner"),
    });
    await this.call("/rest/v1/gem_copy_connection_secrets?" + query, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }

  /** Appends an owner-readable balance observation; duplicates (same hash) are ignored. */
  async recordSnapshot(userId: string, row: SnapshotLedgerRow): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(row.snapshotHash)) throw new StoreError("store_invalid", "Invalid snapshot hash.");
    await this.call("/rest/v1/gem_copy_account_snapshots?on_conflict=user_id,connection_id,snapshot_hash", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        user_id: requireUuid(userId, "owner"),
        connection_id: requireUuid(row.connectionId, "connection"),
        captured_at: row.capturedAt,
        source_kind: row.sourceKind,
        equity_quote: row.equityQuote,
        available_quote: row.availableQuote,
        unrealized_pnl_quote: row.unrealizedPnlQuote,
        quote_currency: row.quoteCurrency,
        snapshot_hash: row.snapshotHash,
      }),
    });
  }
}
