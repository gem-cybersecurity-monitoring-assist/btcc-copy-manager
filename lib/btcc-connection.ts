// BTCC read-only account view for the verified owner: adapter status plus
// owner-imported CSV sections (balances, positions, copy history).
//
// Imports are stored on a gem_copy_connections row (venue "btcc",
// external_account_ref "owner-csv-import") with status DISCONNECTED, because
// no live BTCC connection exists. Every section is labelled
// "owner-imported, not live". Balance imports with complete USD values also
// add a manual_attestation observation, which the evidence panel already
// labels "Manual record, not exchange verified".
import { createHash } from "node:crypto";
import {
  IMPORT_KINDS,
  IMPORT_LABEL,
  IMPORT_SOURCE,
  parseBtccImport,
  type ImportKind,
} from "./btcc-csv.ts";
import { btccStaticStatus, checkBtccProvider, type BtccAdapterStatus } from "./btcc-read-adapter.ts";
import { ConnectionStore, StoreError, readServiceStoreConfig, type ConnectionRow, type FetchLike } from "./connection-store.ts";

export type ServiceResult = { status: number; body: Record<string, unknown> };
export const BTCC_IMPORT_REF = "owner-csv-import";
const MAX_SNAPSHOT_BYTES = 190_000;

export type BtccDeps = {
  store: Pick<ConnectionStore, "findConnection" | "insertConnection" | "updateConnection" | "recordSnapshot"> | null;
  missing: string[];
  env: Record<string, string | undefined>;
  btccFetch?: FetchLike;
  now?: () => Date;
};

export function btccDepsFromEnv(env: Record<string, string | undefined>): BtccDeps {
  const store = readServiceStoreConfig(env);
  return { store: store.config ? new ConnectionStore(store.config) : null, missing: store.missing, env };
}

type Section = { label: string; source: string; kind: ImportKind; importedAt: string; fileName: string | null; rowCount: number; rows: unknown[] };
export type BtccImports = { label: string; source: string; sections: Partial<Record<ImportKind, Section>> };

function readImports(row: ConnectionRow | null): BtccImports | null {
  const snapshot = row?.lastSnapshot as BtccImports | null | undefined;
  if (!snapshot || snapshot.source !== IMPORT_SOURCE || typeof snapshot.sections !== "object" || !snapshot.sections) return null;
  const sections: BtccImports["sections"] = {};
  for (const kind of IMPORT_KINDS) {
    const section = snapshot.sections[kind];
    if (section && Array.isArray(section.rows) && typeof section.importedAt === "string")
      sections[kind] = { ...section, label: IMPORT_LABEL, source: IMPORT_SOURCE, kind };
  }
  return { label: IMPORT_LABEL, source: IMPORT_SOURCE, sections };
}

function storeFailure(error: unknown): ServiceResult {
  const code = error instanceof StoreError ? error.code : "store_failed";
  return {
    status: code === "store_not_ready" || code === "store_unreachable" ? 503 : 502,
    body: { ok: false, code, error: code === "store_not_ready" ? "The connection tables have not been created in this database yet." : "BTCC imports could not be read or saved." },
  };
}

function storageMissing(deps: BtccDeps): ServiceResult | null {
  if (deps.store) return null;
  return {
    status: 503,
    body: { ok: false, code: "connection_storage_not_configured", error: "Imports cannot be saved until server storage is configured.", missing: deps.missing },
  };
}

function sanitizeFileName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/^.*[\\/]/, "").replace(/[^\w .()-]/g, "").trim().slice(0, 120);
  return name || null;
}

/** Adapter status (no network call on page load) plus saved imports. */
export async function readBtcc(deps: BtccDeps, userId: string): Promise<ServiceResult> {
  const adapter = btccStaticStatus(deps.env, deps.now?.());
  if (!deps.store) return { status: 200, body: { ok: true, adapter, imports: null, storage: { configured: false, missing: deps.missing } } };
  try {
    const row = await deps.store.findConnection(userId, "btcc", BTCC_IMPORT_REF);
    return { status: 200, body: { ok: true, adapter, imports: readImports(row), storage: { configured: true } } };
  } catch (error) {
    return { status: 200, body: { ok: true, adapter, imports: null, storage: { configured: true, error: storeFailure(error).body.code } } };
  }
}

/** Owner-triggered live provider check. Never falls back to demo or cached figures. */
export async function checkBtcc(deps: BtccDeps): Promise<ServiceResult> {
  const adapter: BtccAdapterStatus = await checkBtccProvider(deps.env, deps.btccFetch, deps.now);
  return { status: 200, body: { ok: true, adapter } };
}

export async function importBtccCsv(deps: BtccDeps, userId: string, input: unknown): Promise<ServiceResult> {
  const body = input as Record<string, unknown> | null;
  const parsed = parseBtccImport(body?.kind, body?.csv);
  if (!parsed.ok) return { status: 422, body: { ok: false, code: "invalid_csv", error: parsed.error, details: parsed.details } };
  const blocked = storageMissing(deps);
  if (blocked) return blocked;
  const store = deps.store!;
  const now = (deps.now ?? (() => new Date()))();
  const section: Section = {
    label: IMPORT_LABEL, source: IMPORT_SOURCE, kind: parsed.kind, importedAt: now.toISOString(),
    fileName: sanitizeFileName(body?.fileName), rowCount: parsed.rows.length, rows: parsed.rows,
  };
  try {
    const existing = await store.findConnection(userId, "btcc", BTCC_IMPORT_REF);
    const imports = readImports(existing) ?? { label: IMPORT_LABEL, source: IMPORT_SOURCE, sections: {} };
    imports.sections[parsed.kind] = section;
    if (new TextEncoder().encode(JSON.stringify(imports)).byteLength > MAX_SNAPSHOT_BYTES)
      return { status: 413, body: { ok: false, code: "import_too_large", error: "Together with your other BTCC imports this file is too large to store. Import a shorter range." } };
    const patch = { status: "DISCONNECTED" as const, externalAccountRef: BTCC_IMPORT_REF, lastSnapshot: imports as unknown as Record<string, unknown>, lastErrorCode: null };
    const row = existing ? await store.updateConnection(userId, existing.id, patch) : await store.insertConnection(userId, "btcc", patch);
    let ledgerRecorded = false;
    if (parsed.kind === "balances" && parsed.rows.length > 0 && parsed.rows.every((r) => r.usdValue !== null && r.usdValue >= 0)) {
      const total = parsed.rows.reduce((sum, r) => sum + (r.usdValue ?? 0), 0);
      try {
        await store.recordSnapshot(userId, {
          connectionId: row.id, capturedAt: section.importedAt, sourceKind: "manual_attestation",
          equityQuote: String(Number(total.toFixed(8))), availableQuote: null, unrealizedPnlQuote: null, quoteCurrency: "USD",
          snapshotHash: createHash("sha256").update(JSON.stringify([row.id, "btcc-import", section.importedAt, total])).digest("hex"),
        });
        ledgerRecorded = true;
      } catch { /* the import itself succeeded */ }
    }
    return { status: 200, body: { ok: true, imports: readImports(row), imported: { kind: parsed.kind, rowCount: parsed.rows.length }, ledgerRecorded, label: IMPORT_LABEL } };
  } catch (error) {
    return storeFailure(error);
  }
}

export async function clearBtccImport(deps: BtccDeps, userId: string, kind: unknown): Promise<ServiceResult> {
  if (typeof kind !== "string" || !IMPORT_KINDS.includes(kind as ImportKind))
    return { status: 400, body: { ok: false, code: "invalid_kind", error: "Unknown import type." } };
  const blocked = storageMissing(deps);
  if (blocked) return blocked;
  try {
    const existing = await deps.store!.findConnection(userId, "btcc", BTCC_IMPORT_REF);
    const imports = readImports(existing);
    if (!existing || !imports) return { status: 200, body: { ok: true, imports: null } };
    delete imports.sections[kind as ImportKind];
    const row = await deps.store!.updateConnection(userId, existing.id, { lastSnapshot: imports as unknown as Record<string, unknown> });
    return { status: 200, body: { ok: true, imports: readImports(row) } };
  } catch (error) {
    return storeFailure(error);
  }
}
