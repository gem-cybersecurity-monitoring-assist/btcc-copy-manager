import { getLiveConfigurationStatus } from "@/lib/btcc-live";

export async function GET() {
  const status = getLiveConfigurationStatus();
  return Response.json({
    mode: status.adapterMode,
    capabilities: {
      nativeCopyTrading: { state: "VERIFIED", evidence: "Operated in the authenticated BTCC interface; no follow/unfollow API verified." },
      accountPositions: { state: status.ready ? "CONFIGURED" : "BLOCKED", evidence: "GET /v1/account/positionlist from the BTCC TradeOpenAPI guide." },
      futuresExecution: { state: status.ready ? "CONFIGURED" : "BLOCKED", evidence: "POST /v1/account/openposition; requires a trade-enabled key and configured base URL." },
      withdrawals: { state: "FORBIDDEN", evidence: "No withdrawal or transfer route exists in this application." }
    }, observedAt: new Date().toISOString()
  }, { headers: { "Cache-Control": "no-store" } });
}
