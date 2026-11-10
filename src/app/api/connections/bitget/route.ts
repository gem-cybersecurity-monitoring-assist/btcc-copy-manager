import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import {
  bitgetConnectionDepsFromEnv,
  connectBitget,
  disconnectBitget,
  readBitgetConnection,
  type ServiceResult,
} from "../../../../../lib/bitget-connection.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 4096;
const json = (result: ServiceResult) => NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });

async function boundedJson(request: NextRequest): Promise<unknown> {
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/** Owner-only connection status and last read-only snapshot. Never returns credentials. */
export async function GET(request: NextRequest) {
  return withOwnerRequest(request, async (owner) => json(await readBitgetConnection(bitgetConnectionDepsFromEnv(process.env), owner.userId)));
}

/** Verify a read-only key, then store it encrypted server-side. No trading, transfer or withdrawal endpoint exists. */
export async function POST(request: NextRequest) {
  return withOwnerRequest(
    request,
    async (owner) => json(await connectBitget(bitgetConnectionDepsFromEnv(process.env), owner.userId, await boundedJson(request))),
    { mutation: true },
  );
}

/** Delete the stored credentials and mark the connection disconnected. */
export async function DELETE(request: NextRequest) {
  return withOwnerRequest(
    request,
    async (owner) => json(await disconnectBitget(bitgetConnectionDepsFromEnv(process.env), owner.userId)),
    { mutation: true, requireJson: false },
  );
}
