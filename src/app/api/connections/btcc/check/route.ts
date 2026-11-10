import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { btccDepsFromEnv, checkBtcc } from "../../../../../../lib/btcc-connection.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-triggered read-only BTCC provider check (login + position list only). */
export async function POST(request: NextRequest) {
  return withOwnerRequest(
    request,
    async () => {
      const result = await checkBtcc(btccDepsFromEnv(process.env));
      return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
    },
    { mutation: true, requireJson: false },
  );
}
