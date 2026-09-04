import { verifyFinitePurchaseToken, verifyPurchaseControlSecret } from "@/lib/finite-purchase";
import { reconcileFinitePurchasePlan } from "@/lib/switchere-purchase";

export async function POST(request: Request) {
  try {
    const controlSecret = request.headers.get("x-purchase-control-secret") || "";
    if (!verifyPurchaseControlSecret(controlSecret)) {
      return Response.json(
        { error: "Purchase control authorization failed." },
        { status: 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await request.json() as { confirmationToken?: string };
    const plan = verifyFinitePurchaseToken(String(body.confirmationToken || ""));
    const result = await reconcileFinitePurchasePlan(plan);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Purchase reconciliation failed." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
