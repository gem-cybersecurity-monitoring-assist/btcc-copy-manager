// Shared, framework-free workspace model and validation.
// Used by the dashboard (local storage, backup import, cloud restore) and by the
// /api/workspace route so the browser and the server enforce the same rules.

import { parseEngineState } from "./engine/state.ts";
import type { EngineState } from "./engine/types.ts";

export type Trader = {
  name: string;
  venue: string;
  period: string;
  roi: number;
  drawdown: number;
  winRate: number;
  trades: number;
  leverage: string;
  profitShare: string;
  history: string;
  note: string;
};

export type Snapshot = {
  id: string;
  venue: string;
  capturedAt: string;
  equity: number;
  available: number;
  unrealizedPnl: number;
  note: string;
  source: string;
};

/** `engine` is optional so workspaces and backups created before the intelligence engine stay valid. */
export type CopyCenterActivity = { id: string; at: string; title: string; detail: string };
export type CopyCenterWalletAddresses = { phantom?: string; metamask?: string; base?: string };
export type CopyCenterPreferences = { budget: string; maxLoss: string; activity: CopyCenterActivity[]; walletAddresses?: CopyCenterWalletAddresses };
export type Workspace = { traders: Trader[]; savedReviews: string[]; portfolioSnapshots: Snapshot[]; engine?: EngineState; copyCenter?: CopyCenterPreferences };

export const STORAGE_KEYS = {
  traders: "gem-copy-center-traders-v1",
  saved: "gem-copy-center-saved-v1",
  snapshots: "gem-copy-center-snapshots-v1",
  engine: "gem-copy-center-engine-v1",
} as const;

export const BACKUP_SCHEMAS = ["gem-copy-center-backup-v1", "gem-copy-center-backup-v2"] as const;
export const CURRENT_BACKUP_SCHEMA = "gem-copy-center-backup-v2";

export const LIMITS = {
  maxBytes: 750_000,
  traders: 1000,
  savedReviews: 1000,
  snapshots: 5000,
  text: 200,
  note: 1000,
} as const;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max: number = LIMITS.text): value is string => typeof value === "string" && value.length <= max;
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function normalizeCopyCenter(input: unknown): CopyCenterPreferences | null {
  if (!isRecord(input)) return null;
  const budget = input.budget;
  const maxLoss = input.maxLoss;
  const activity = input.activity ?? [];
  if (typeof budget !== "string" || budget.length > 32 || !Number.isFinite(Number(budget)) || Number(budget) < 0 || Number(budget) > 100_000) return null;
  if (typeof maxLoss !== "string" || maxLoss.length > 32 || !Number.isFinite(Number(maxLoss)) || Number(maxLoss) < 0 || Number(maxLoss) > 100) return null;
  if (!Array.isArray(activity) || activity.length > 50) return null;
  const normalizedActivity: CopyCenterActivity[] = [];
  for (const raw of activity) {
    if (!isRecord(raw)) return null;
    if (!isText(raw.id, 100) || !raw.id || !isText(raw.at, 40) || Number.isNaN(Date.parse(raw.at))) return null;
    if (!isText(raw.title, 160) || !raw.title.trim() || !isText(raw.detail, 1000)) return null;
    normalizedActivity.push({ id: raw.id, at: raw.at, title: raw.title.trim(), detail: raw.detail });
  }
  let walletAddresses: CopyCenterWalletAddresses | undefined;
  if (input.walletAddresses !== undefined && input.walletAddresses !== null) {
    if (!isRecord(input.walletAddresses)) return null;
    const rawWallets = input.walletAddresses;
    const candidate: CopyCenterWalletAddresses = {};
    if (rawWallets.phantom !== undefined) {
      if (typeof rawWallets.phantom !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawWallets.phantom)) return null;
      candidate.phantom = rawWallets.phantom;
    }
    for (const key of ["metamask", "base"] as const) {
      const address = rawWallets[key];
      if (address !== undefined) {
        if (typeof address !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(address)) return null;
        candidate[key] = address;
      }
    }
    walletAddresses = candidate;
  }
  return { budget, maxLoss, activity: normalizedActivity, ...(walletAddresses ? { walletAddresses } : {}) };
}

export function emptyWorkspace(): Workspace {
  return { traders: [], savedReviews: [], portfolioSnapshots: [] };
}

/** Returns a normalized trader, or null when the record is malformed. Optional text fields get safe defaults. */
export function normalizeTrader(input: unknown): Trader | null {
  if (!isRecord(input)) return null;
  const t = input;
  if (!isText(t.name) || !t.name.trim() || !isText(t.venue) || !t.venue.trim() || !isText(t.period)) return null;
  if (!isNumber(t.roi) || Math.abs(t.roi) > 1_000_000) return null;
  if (!isNumber(t.drawdown) || t.drawdown < 0 || t.drawdown > 100) return null;
  if (!isNumber(t.winRate) || t.winRate < 0 || t.winRate > 100) return null;
  if (!Number.isInteger(t.trades) || (t.trades as number) < 0 || (t.trades as number) > 10_000_000) return null;
  if (!isText(t.leverage) || !isText(t.history)) return null;
  if (t.profitShare !== undefined && !isText(t.profitShare)) return null;
  if (t.note !== undefined && !isText(t.note, LIMITS.note)) return null;
  return {
    name: t.name.trim(),
    venue: t.venue.trim(),
    period: t.period,
    roi: t.roi,
    drawdown: t.drawdown,
    winRate: t.winRate,
    trades: t.trades as number,
    leverage: t.leverage,
    profitShare: typeof t.profitShare === "string" ? t.profitShare : "Check venue terms",
    history: t.history,
    note: typeof t.note === "string" ? t.note : "",
  };
}

export function normalizeSnapshot(input: unknown): Snapshot | null {
  if (!isRecord(input)) return null;
  const s = input;
  if (!isText(s.id) || !s.id || !isText(s.venue) || !s.venue.trim() || !isText(s.capturedAt) || Number.isNaN(Date.parse(s.capturedAt))) return null;
  if (!isNumber(s.equity) || s.equity < 0 || !isNumber(s.available) || s.available < 0 || !isNumber(s.unrealizedPnl)) return null;
  if (!isText(s.note, LIMITS.note) || !isText(s.source)) return null;
  return { id: s.id, venue: s.venue.trim(), capturedAt: s.capturedAt, equity: s.equity, available: s.available, unrealizedPnl: s.unrealizedPnl, note: s.note, source: s.source };
}

/**
 * Strict validation for data that will replace existing records (cloud upload/restore, backup import).
 * Any malformed record rejects the whole payload so nothing is partially overwritten.
 */
export function parseWorkspace(input: unknown): ParseResult<Workspace> {
  if (!isRecord(input)) return { ok: false, error: "Workspace must be an object." };
  const { traders, savedReviews } = input;
  const snapshots = input.portfolioSnapshots ?? [];
  if (!Array.isArray(traders) || !Array.isArray(savedReviews) || !Array.isArray(snapshots)) {
    return { ok: false, error: "Workspace must contain traders, savedReviews and portfolioSnapshots lists." };
  }
  if (traders.length > LIMITS.traders || savedReviews.length > LIMITS.savedReviews || snapshots.length > LIMITS.snapshots) {
    return { ok: false, error: `Workspace record limit exceeded (max ${LIMITS.traders} traders, ${LIMITS.savedReviews} reviews, ${LIMITS.snapshots} snapshots).` };
  }
  const normalizedTraders: Trader[] = [];
  for (const [index, raw] of traders.entries()) {
    const trader = normalizeTrader(raw);
    if (!trader) return { ok: false, error: `Trader record ${index + 1} is invalid.` };
    normalizedTraders.push(trader);
  }
  if (!savedReviews.every((name) => isText(name) && name.length > 0)) return { ok: false, error: "Saved review bookmarks must be short text values." };
  const normalizedSnapshots: Snapshot[] = [];
  for (const [index, raw] of snapshots.entries()) {
    const snapshot = normalizeSnapshot(raw);
    if (!snapshot) return { ok: false, error: `Portfolio snapshot ${index + 1} is invalid.` };
    normalizedSnapshots.push(snapshot);
  }
  const value: Workspace = { traders: normalizedTraders, savedReviews: [...new Set(savedReviews as string[])], portfolioSnapshots: normalizedSnapshots };
  if (input.engine !== undefined && input.engine !== null) {
    const engine = parseEngineState(input.engine);
    if (!engine.ok) return { ok: false, error: engine.error };
    value.engine = engine.value;
  }
  if (input.copyCenter !== undefined && input.copyCenter !== null) {
    const copyCenter = normalizeCopyCenter(input.copyCenter);
    if (!copyCenter) return { ok: false, error: "Copy Center preferences are invalid." };
    value.copyCenter = copyCenter;
  }
  return { ok: true, value };
}

/** Parses an exported backup file. Accepts v1 (no snapshots) and v2 backups. */
export function parseBackupText(text: string): ParseResult<Workspace> {
  if (new TextEncoder().encode(text).byteLength > LIMITS.maxBytes) return { ok: false, error: "Backup file is too large (maximum 750 KB)." };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "The file is not valid JSON." };
  }
  if (!isRecord(parsed) || !BACKUP_SCHEMAS.includes(parsed.schema as (typeof BACKUP_SCHEMAS)[number])) {
    return { ok: false, error: "This file is not a supported GEM Copy Center backup." };
  }
  return parseWorkspace(parsed);
}

export function createBackup(workspace: Workspace, exportedAt = new Date()) {
  return { schema: CURRENT_BACKUP_SCHEMA, exportedAt: exportedAt.toISOString(), ...workspace };
}

/**
 * Lenient loader for browser-local data: keeps valid records and drops corrupt ones so a bad
 * entry cannot crash the dashboard. Returns how many records were dropped.
 */
export function loadStoredList<T>(raw: string | null, normalize: (value: unknown) => T | null): { items: T[]; dropped: number } {
  if (!raw) return { items: [], dropped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { items: [], dropped: 1 };
  }
  if (!Array.isArray(parsed)) return { items: [], dropped: 1 };
  const items: T[] = [];
  for (const value of parsed) {
    const item = normalize(value);
    if (item !== null) items.push(item);
  }
  return { items, dropped: parsed.length - items.length };
}

export const normalizeBookmark = (value: unknown): string | null => (isText(value) && value.length > 0 ? value : null);

export function workspaceCounts(w: Workspace) {
  const base = `${w.traders.length} trader record(s), ${w.savedReviews.length} review bookmark(s), ${w.portfolioSnapshots.length} portfolio snapshot(s)`;
  return w.engine ? `${base}, ${w.engine.strategies.length} engine strateg${w.engine.strategies.length === 1 ? "y" : "ies"}, ${w.engine.providers.length} tracked provider(s)` : base;
}

export function isWorkspaceEmpty(w: Workspace) {
  const engineEmpty = !w.engine || (w.engine.strategies.length === 0 && w.engine.providers.length === 0 && w.engine.paperPortfolios.length === 0);
  return w.traders.length === 0 && w.savedReviews.length === 0 && w.portfolioSnapshots.length === 0 && engineEmpty && !w.copyCenter;
}

/** CSV with CRLF rows, quoted cells, and a guard against spreadsheet formula injection. */
export function toCsv(headers: string[], rows: Array<Array<string | number>>) {
  const escape = (value: string | number) => {
    let text = String(value);
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
}

export const traderKey = (t: Pick<Trader, "name" | "venue">) => `${t.venue}::${t.name.toLowerCase()}`;
