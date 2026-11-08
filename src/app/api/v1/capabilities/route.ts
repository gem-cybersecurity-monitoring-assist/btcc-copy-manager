import type { NextRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withOwnerRequest(request, async () => Response.json({
    mode: "disabled",
    capabilities: {
      nativeCopyTrading: { state: "UNVERIFIED", evidence: "Manage enrollment directly in BTCC; no current native copy API acceptance is verified." },
      accountPositions: { state: "UNVERIFIED", evidence: "Current official futures API availability and authenticated account reads require verification." },
      futuresExecution: { state: "BLOCKED", evidence: "Durable owner approval and provider acceptance are not verified." },
      withdrawals: { state: "FORBIDDEN", evidence: "No withdrawal or transfer route exists in this application." }
    }, observedAt: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store" } }));
}
