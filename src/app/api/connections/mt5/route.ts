import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { disconnectMt5, mt5DepsFromEnv, readMt5, saveMt5, type ServiceResult } from "../../../../../lib/mt5-connection.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (result: ServiceResult) => NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });

/** Owner-only MT5 investor connection status. Never returns the password. */
export async function GET(request: NextRequest) {
  return withOwnerRequest(request, async (owner) => json(await readMt5(mt5DepsFromEnv(process.env), owner.userId)));
}

/** Save the MT5 login, server and investor (read-only) password, encrypted server-side. */
export async function POST(request: NextRequest) {
  return withOwnerRequest(request, async (owner) => {
    const text = await request.text().catch(() => "");
    let body: unknown = null;
    if (text.length <= 2048) { try { body = JSON.parse(text); } catch { body = null; } }
    return json(await saveMt5(mt5DepsFromEnv(process.env), owner.userId, body));
  }, { mutation: true });
}

/** Delete the encrypted investor password and mark the connection disconnected. */
export async function DELETE(request: NextRequest) {
  return withOwnerRequest(request, async (owner) => json(await disconnectMt5(mt5DepsFromEnv(process.env), owner.userId)), { mutation: true, requireJson: false });
}
