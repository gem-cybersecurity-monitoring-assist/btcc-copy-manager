import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { bitgetConnectionDepsFromEnv, refreshBitgetConnection } from "../../../../../../lib/bitget-connection.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Re-verify the stored key is still read-only, then read balances and positions again. */
export async function POST(request: NextRequest) {
  return withOwnerRequest(
    request,
    async (owner) => {
      const result = await refreshBitgetConnection(bitgetConnectionDepsFromEnv(process.env), owner.userId);
      return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
    },
    { mutation: true, requireJson: false },
  );
}
