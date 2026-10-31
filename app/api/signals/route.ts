import { NextRequest, NextResponse } from "next/server";
import { isSignalInboxSymbol, normalizeWorkerSignal } from "../../../lib/signal-inbox.ts";

export const runtime = "nodejs";

const WORKER_ORIGIN = "https://crypto-signal-bot-api.analyzer-d94.workers.dev";

/** Read-only proxy. Fixed upstream origin and strict symbol allowlist prevent SSRF. */
export async function GET(request: NextRequest) {
  const rawSymbol = (request.nextUrl.searchParams.get("symbol") ?? "BTC").trim().toUpperCase();
  if (!isSignalInboxSymbol(rawSymbol)) {
    return NextResponse.json({ error: "Choose one of the supported assets: BTC, ETH, SOL, BNB, ADA, XRP, DOT, AVAX, DOGE or LINK." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const upstream = await fetch(
      `${WORKER_ORIGIN}/signal/latest?symbol=${encodeURIComponent(rawSymbol)}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!upstream.ok) {
      return NextResponse.json({ error: "The signal service is temporarily unavailable. Try again shortly." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    const payload: unknown = await upstream.json().catch(() => null);
    const normalized = normalizeWorkerSignal(payload, rawSymbol);
    if (!normalized.ok) {
      return NextResponse.json({ error: normalized.error }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ signal: normalized.value }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The signal service could not be reached. Try again shortly." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
