export type AccountEvidence = {
  id: string; connectionId: string; capturedAt: string; recordedAt: string;
  sourceKind: "official_api" | "manual_attestation"; quoteCurrency: string;
  equityQuote: string | number | null; availableQuote: string | number | null;
  realizedPnlQuote: string | number | null; unrealizedPnlQuote: string | number | null;
};

export function parseAccountEvidence(value: unknown): AccountEvidence[] {
  const body = value as { ok?: unknown; source?: unknown; snapshots?: unknown } | null;
  if (!body || body.ok !== true || body.source !== "owner_scoped_ledger" || !Array.isArray(body.snapshots) || body.snapshots.length > 25) throw Error("Account evidence is unavailable.");
  const decimal = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v)) || (typeof v === "string" && /^-?\d+(?:\.\d+)?$/.test(v));
  const rows: AccountEvidence[] = [];
  for (const raw of body.snapshots) {
    const r = raw as AccountEvidence | null;
    if (!r || typeof r.id !== "string" || typeof r.connectionId !== "string" || !r.connectionId ||
        typeof r.capturedAt !== "string" || !Number.isFinite(Date.parse(r.capturedAt)) ||
        typeof r.recordedAt !== "string" || !Number.isFinite(Date.parse(r.recordedAt)) ||
        !["official_api", "manual_attestation"].includes(r.sourceKind) ||
        !["USD", "USDT", "USDC", "EUR"].includes(r.quoteCurrency) ||
        ![r.equityQuote,r.availableQuote,r.realizedPnlQuote,r.unrealizedPnlQuote].every(decimal)) throw Error("Account evidence is invalid.");
    rows.push(r);
  }
  // Latest per connection AND source AND currency: manual evidence never replaces official evidence.
  const latest = new Map<string, AccountEvidence>();
  for (const r of rows) {
    const key = JSON.stringify([r.connectionId,r.sourceKind,r.quoteCurrency]);
    const previous = latest.get(key);
    if (!previous || Date.parse(r.capturedAt) > Date.parse(previous.capturedAt)) latest.set(key,r);
  }
  return [...latest.values()];
}

export function evidenceFreshness(capturedAt: string, now: number): "stale" | "future" | "recent" {
  const time = Date.parse(capturedAt);
  if (!Number.isFinite(time) || time > now + 60_000) return "future";
  return now - time > 300_000 ? "stale" : "recent";
}
export function evidenceAmount(value: string | number | null, currency: string): string {
  return value === null ? "Unavailable" : String(value) + " " + currency;
}
