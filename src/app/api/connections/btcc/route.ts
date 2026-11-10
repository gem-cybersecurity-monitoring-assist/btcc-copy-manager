import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { btccDepsFromEnv, readBtcc } from "../../../../../lib/btcc-connection.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-only BTCC adapter status (no provider call) and owner-imported CSV data. */
export async function GET(request: NextRequest) {
  return withOwnerRequest(request, async (owner) => {
    const result = await readBtcc(btccDepsFromEnv(process.env), owner.userId);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  });
}
