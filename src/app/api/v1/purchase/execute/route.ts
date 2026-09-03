import { getPurchaseConfigurationStatus, verifyFinitePurchaseToken, verifyPurchaseControlSecret } from "@/lib/finite-purchase";
import { executeFinitePurchasePlan } from "@/lib/switchere-purchase";

export async function POST(request: Request) {
  try {
    const controlSecret = request.headers.get("x-purchase-control-secret") || "";
    if (!verifyPurchaseControlSecret(controlSecret)) {
      return Response.json({ error: "Purchase control authorization failed." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    }

    const status = getPurchaseConfigurationStatus();
    if (!status.ready) {
      return Response.json({ error: "Finite purchase connector is not ready.", blockers: status.blockers }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    const body = await request.json() as { confirmationToken?: string; confirmationPhrase?: string };
    const plan = verifyFinitePurchaseToken(String(body.confirmationToken || ""));
    if (body.confirmationPhrase !== plan.confirmationPhrase) {
      return Response.json({ error: "Exact purchase confirmation phrase is required." }, { status: 422, headers: { "Cache-Control": "no-store" } });
    }

    const result = await executeFinitePurchasePlan(plan);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Finite purchase execution failed." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
