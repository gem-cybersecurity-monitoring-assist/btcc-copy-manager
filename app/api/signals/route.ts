import { NextRequest, NextResponse } from "next/server";
import { normalizeWorkerSignal, SIGNAL_SYMBOLS } from "../../../lib/signals/normalize.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fixed, read-only upstream. Never accept a URL, host, path, or credential from the caller.
const WORKER_ORIGIN = "https://crypto-signal-bot-api.analyzer-d94.workers.dev";
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const raw = (request.nextUrl.searchParams.get("symbol") || "BTC").toUpperCase().trim().replace(/USDT$/, "").replace(/USD$/, "");
  if (!(SIGNAL_SYMBOLS as readonly string[]).includes(raw)) {
    return NextResponse.json({ error: "Unsupported symbol.", allowed: SIGNAL_SYMBOLS }, { status: 400, headers: NO_STORE });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const upstream = await fetch(WORKER_ORIGIN + "/signal/latest?symbol=" + encodeURIComponent(raw + "USDT"), {
      method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal,
    });
    if (!upstream.ok) return NextResponse.json({ error: "The signal service is temporarily unavailable.", upstreamStatus: upstream.status }, { status: 502, headers: NO_STORE });
    const payload: unknown = await upstream.json().catch(() => null);
    const normalized = normalizeWorkerSignal(payload);
    if (!normalized.ok) return NextResponse.json({ error: normalized.error, signal: null }, { status: 200, headers: NO_STORE });
    return NextResponse.json({ signal: normalized.value, readOnly: true, automaticExecution: false }, { headers: NO_STORE });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json({ error: timedOut ? "The signal service timed out. Try again shortly." : "Could not reach the signal service." }, { status: 503, headers: NO_STORE });
  } finally { clearTimeout(timeout); }
}