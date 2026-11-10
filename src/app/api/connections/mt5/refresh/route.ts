import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { mt5DepsFromEnv, refreshMt5 } from "../../../../../../lib/mt5-connection.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read the MT5 account through the configured bridge (investor access only). */
export async function POST(request: NextRequest) {
  return withOwnerRequest(request, async (owner) => {
    const result = await refreshMt5(mt5DepsFromEnv(process.env), owner.userId);
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }, { mutation: true, requireJson: false });
}
