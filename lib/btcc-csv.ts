// Parser for owner-exported BTCC CSV files (balances, positions, copy history).
//
// Imported data is the owner's own export, not a live provider read. Every
// parsed section carries source "owner_csv_import" and the label
// "owner-imported, not live". The parser is strict: a file with unrecognised
// headers or any invalid required value is rejected as a whole, so a partial or
// misread import is never shown as real data. Missing optional values stay null
// (unknown), never zero.

export const IMPORT_LABEL = "owner-imported, not live";
export const IMPORT_SOURCE = "owner_csv_import";
export const MAX_CSV_BYTES = 512 * 1024;
export const MAX_ROWS = { balances: 500, positions: 500, copy_history: 1000 } as const;

export type ImportKind = keyof typeof MAX_ROWS;
export const IMPORT_KINDS = Object.keys(MAX_ROWS) as ImportKind[];

export type BalanceRow = { coin: string; total: number; available: number | null; locked: number | null; usdValue: number | null };
export type PositionRow = {
  symbol: string; side: string; size: number; entryPrice: number | null; markPrice: number | null;
  leverage: number | null; unrealizedPnl: number | null; margin: number | null;
};
export type CopyHistoryRow = {
  trader: string | null; symbol: string; side: string | null; size: number | null;
  openPrice: number | null; closePrice: number | null; openedAt: string | null; closedAt: string | null;
  realizedPnl: number; fee: number | null;
};
export type ParsedImport =
  | { ok: true; kind: "balances"; rows: BalanceRow[] }
  | { ok: true; kind: "positions"; rows: PositionRow[] }
  | { ok: true; kind: "copy_history"; rows: CopyHistoryRow[] }
  | { ok: false; error: string; details: string[] };

type FieldType = "text" | "number" | "side" | "date";
type FieldSpec = { aliases: string[]; type: FieldType; required?: boolean };

const SYMBOL = ["symbol", "contract", "pair", "instrument", "market", "tradingpair"];
const SIDE = ["side", "direction", "positionside", "position", "type", "orderside"];
const SIZE = ["size", "quantity", "qty", "volume", "amount", "positionsize", "lots", "lot"];

const SCHEMAS: Record<ImportKind, Record<string, FieldSpec>> = {
  balances: {
    coin: { aliases: ["coin", "asset", "currency", "token", "symbol"], type: "text", required: true },
    total: { aliases: ["total", "balance", "equity", "totalbalance", "totalassets", "amount", "totalamount"], type: "number", required: true },
    available: { aliases: ["available", "availablebalance", "free", "availableamount"], type: "number" },
    locked: { aliases: ["frozen", "locked", "inorder", "frozenamount", "lockedamount"], type: "number" },
    usdValue: { aliases: ["usdvalue", "valueusd", "usdtvalue", "valueusdt", "estimatedvalue", "estvalue", "valueinusd", "valueinusdt"], type: "number" },
  },
  positions: {
    symbol: { aliases: SYMBOL, type: "text", required: true },
    side: { aliases: SIDE, type: "side", required: true },
    size: { aliases: SIZE, type: "number", required: true },
    entryPrice: { aliases: ["entryprice", "openprice", "avgprice", "averageprice", "avgentryprice", "openingprice"], type: "number" },
    markPrice: { aliases: ["markprice", "currentprice", "lastprice", "marketprice"], type: "number" },
    leverage: { aliases: ["leverage", "multiple", "multiplier"], type: "number" },
    unrealizedPnl: { aliases: ["unrealizedpnl", "unrealisedpnl", "floatingpnl", "upl", "unrealizedprofit", "pnl"], type: "number" },
    margin: { aliases: ["margin", "initialmargin", "positionmargin"], type: "number" },
  },
  copy_history: {
    trader: { aliases: ["trader", "leadtrader", "master", "provider", "tradername", "copiedtrader", "mastername"], type: "text" },
    symbol: { aliases: SYMBOL, type: "text", required: true },
    side: { aliases: SIDE, type: "side" },
    size: { aliases: SIZE, type: "number" },
    openPrice: { aliases: ["openprice", "entryprice", "openingprice"], type: "number" },
    closePrice: { aliases: ["closeprice", "exitprice", "closingprice"], type: "number" },
    openedAt: { aliases: ["opentime", "opened", "openedat", "opendate", "entrytime", "opentimeutc"], type: "date" },
    closedAt: { aliases: ["closetime", "closed", "closedat", "closedate", "exittime", "closetimeutc"], type: "date" },
    realizedPnl: { aliases: ["realizedpnl", "realisedpnl", "pnl", "profit", "profitloss", "netpnl", "closedpnl", "netprofit"], type: "number", required: true },
    fee: { aliases: ["fee", "fees", "commission", "tradingfee"], type: "number" },
  },
};

// Two forms per header: full ("Value (USDT)" -> "valueusdt") and without the
// parenthesised unit ("Close Time (UTC)" -> "closetime"). The full form wins.
const headerForms = (value: string) => {
  const base = value.replace(/^\uFEFF/, "").toLowerCase();
  return [base.replace(/[^a-z0-9]/g, ""), base.replace(/\([^)]*\)/g, "").replace(/[^a-z0-9]/g, "")];
};

/** RFC 4180-style parsing with quoted fields, "" escapes, CRLF and a detected delimiter. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function cleanText(value: string, max = 64): string | null {
  // Strip control characters and a leading formula trigger; React escapes the rest on render.
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/^[=+@]+/, "").trim();
  return text ? text.slice(0, max) : null;
}

function parseNumber(value: string): number | null | "invalid" {
  const text = value.trim();
  if (!text || /^(-|--|n\/a|na|null)$/i.test(text)) return null;
  const stripped = text.replace(/[\s,]/g, "").replace(/^\$/, "").replace(/(usdt|usdc|usd|btc|eth|[a-z]{2,6})$/i, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(stripped)) return "invalid";
  const parsed = Number(stripped);
  return Number.isFinite(parsed) ? parsed : "invalid";
}

function parseSide(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (/^(long|buy|open long|1)$/.test(text)) return "long";
  if (/^(short|sell|open short|2)$/.test(text)) return "short";
  return cleanText(text, 16);
}

function parseDate(value: string): string | null | "invalid" {
  const text = value.trim();
  if (!text) return null;
  const numeric = /^\d{10,13}$/.test(text) ? Number(text.length === 10 ? text + "000" : text) : null;
  const time = numeric ?? Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(text) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text.replace(" ", "T") + "Z" : text);
  if (!Number.isFinite(time)) return "invalid";
  const year = new Date(time).getUTCFullYear();
  return year >= 2010 && year <= 2100 ? new Date(time).toISOString() : "invalid";
}

export function parseBtccImport(kind: unknown, csv: unknown): ParsedImport {
  if (typeof kind !== "string" || !IMPORT_KINDS.includes(kind as ImportKind))
    return { ok: false, error: "Choose what the file contains: balances, positions or copy history.", details: [] };
  if (typeof csv !== "string" || !csv.trim()) return { ok: false, error: "The CSV file is empty.", details: [] };
  if (new TextEncoder().encode(csv).byteLength > MAX_CSV_BYTES)
    return { ok: false, error: "The CSV file is larger than 512 KB. Export a shorter date range.", details: [] };
  const importKind = kind as ImportKind;
  const table = parseCsv(csv);
  if (table.length < 2) return { ok: false, error: "The CSV file needs a header row and at least one data row.", details: [] };
  const schema = SCHEMAS[importKind];
  const headers = table[0].map(headerForms);
  const columns: Record<string, number> = {};
  for (const form of [0, 1]) {
    for (const [field, spec] of Object.entries(schema)) {
      if (columns[field] !== undefined) continue;
      const index = spec.aliases.map((alias) => headers.findIndex((h) => h[form] === alias)).find((i) => i >= 0);
      if (index !== undefined && !Object.values(columns).includes(index)) columns[field] = index;
    }
  }
  const missing = Object.entries(schema).filter(([field, spec]) => spec.required && columns[field] === undefined).map(([field, spec]) => `${field} (e.g. "${spec.aliases[0]}")`);
  if (importKind === "copy_history" && columns.openedAt === undefined && columns.closedAt === undefined) missing.push('closedAt or openedAt (e.g. "close time")');
  if (missing.length)
    return { ok: false, error: "The file's columns were not recognised for this import type.", details: ["Missing: " + missing.join(", "), "Found: " + table[0].map((h) => h.trim()).filter(Boolean).slice(0, 20).join(", ")] };
  const dataRows = table.slice(1);
  if (dataRows.length > MAX_ROWS[importKind])
    return { ok: false, error: `The file has ${dataRows.length} rows; the limit for this import is ${MAX_ROWS[importKind]}. Export a shorter range.`, details: [] };

  const errors: string[] = [];
  const rows: Record<string, unknown>[] = [];
  dataRows.forEach((cells, index) => {
    const line = index + 2;
    const record: Record<string, unknown> = {};
    for (const [field, spec] of Object.entries(schema)) {
      const raw = columns[field] === undefined ? "" : cells[columns[field]] ?? "";
      let value: unknown;
      if (spec.type === "number") value = parseNumber(raw);
      else if (spec.type === "date") value = parseDate(raw);
      else if (spec.type === "side") value = parseSide(raw);
      else value = cleanText(raw);
      if (value === "invalid") { errors.push(`Row ${line}: "${field}" is not a valid ${spec.type}.`); value = null; }
      else if (spec.required && value === null) errors.push(`Row ${line}: "${field}" is required.`);
      record[field] = value;
    }
    if (importKind === "copy_history" && record.openedAt === null && record.closedAt === null) errors.push(`Row ${line}: an open or close time is required.`);
    if (importKind === "balances" && typeof record.total === "number" && record.total < 0) errors.push(`Row ${line}: "total" cannot be negative.`);
    if (importKind === "positions" && typeof record.size === "number" && record.size <= 0) errors.push(`Row ${line}: "size" must be greater than zero.`);
    rows.push(record);
  });
  if (errors.length)
    return { ok: false, error: `The file has ${errors.length} invalid value${errors.length === 1 ? "" : "s"}. Nothing was imported.`, details: errors.slice(0, 10) };
  return { ok: true, kind: importKind, rows } as ParsedImport;
}
