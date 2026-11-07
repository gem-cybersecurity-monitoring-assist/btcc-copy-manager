import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { runBtccDiagnostics } from "@/lib/btcc-diagnostics";
import { executeLiveOrder, verifyConfirmationToken } from "@/lib/btcc-live";

async function ownerPOST(request: Request) {
  if (request.headers.get("cookie")?.includes("btcc-live-paused=1")) {
    return Response.json(
      { error: "Live submissions are paused by the emergency stop." },
      { status: 423, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const diagnostics = await runBtccDiagnostics();
    if (diagnostics.category !== "ok" || diagnostics.accountRead !== "ok") {
      return Response.json(
        {
          error: "BTCC live connector is not operational. Execution is blocked until account-read diagnostics succeed.",
          diagnostics: {
            category: diagnostics.category,
            message: diagnostics.message,
            observedAt: diagnostics.observedAt
          }
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const body = await request.json() as { confirmationToken?: string; confirmationPhrase?: string };
    if (body.confirmationPhrase !== "EXECUTE LIVE ORDER") {
      return Response.json(
        { error: "Exact live confirmation phrase is required." },
        { status: 409, headers: { "Cache-Control": "no-store" } }
      );
    }

    const { intent } = verifyConfirmationToken(body.confirmationToken || "");
    const exchange = await executeLiveOrder(intent);
    return Response.json(
      { status: "SUBMITTED", idempotencyKey: intent.idempotencyKey, exchange, submittedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Live execution failed." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerPOST(request), { mutation: true, financialExecution: true });
}
