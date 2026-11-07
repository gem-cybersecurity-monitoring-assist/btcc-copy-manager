import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { runBtccDiagnostics } from "@/lib/btcc-diagnostics";
import { prepareLiveOrder } from "@/lib/btcc-live";
import type { LiveOrderIntent } from "@/lib/live-types";

async function ownerPOST(request: Request) {
  try {
    const diagnostics = await runBtccDiagnostics();
    if (diagnostics.category !== "ok" || diagnostics.accountRead !== "ok") {
      return Response.json(
        {
          error: "BTCC live connector is not operational. Resolve the connection diagnostics before preparing an order.",
          diagnostics: {
            category: diagnostics.category,
            message: diagnostics.message,
            observedAt: diagnostics.observedAt
          }
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const intent = await request.json() as LiveOrderIntent;
    return Response.json(prepareLiveOrder(intent), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Order preparation failed." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerPOST(request), { mutation: true });
}
