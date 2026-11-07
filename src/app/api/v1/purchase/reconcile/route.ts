import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { verifyFinitePurchaseTokenForReconciliation, verifyPurchaseControlSecret } from "@/lib/finite-purchase";
import { reconcileFinitePurchasePlan } from "@/lib/switchere-purchase";

async function ownerPOST(request: Request) {
  try {
    const controlSecret = request.headers.get("x-purchase-control-secret") || "";
    if (!verifyPurchaseControlSecret(controlSecret)) {
      return Response.json(
        { error: "Purchase control authorization failed." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await request.json() as { confirmationToken?: string };
    const plan = verifyFinitePurchaseTokenForReconciliation(String(body.confirmationToken || ""));
    const result = await reconcileFinitePurchasePlan(plan);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Purchase reconciliation failed." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerPOST(request), { mutation: true });
}
