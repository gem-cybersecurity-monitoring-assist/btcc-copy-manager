import { executeLiveOrder, verifyConfirmationToken } from "@/lib/btcc-live";

export async function POST(request: Request) {
  if (request.headers.get("cookie")?.includes("btcc-live-paused=1")) return Response.json({ error: "Live submissions are paused by the emergency stop." }, { status: 423 });
  try {
    const body = await request.json() as { confirmationToken?: string; confirmationPhrase?: string };
    if (body.confirmationPhrase !== "EXECUTE LIVE ORDER") return Response.json({ error: "Exact live confirmation phrase is required." }, { status: 409 });
    const { intent } = verifyConfirmationToken(body.confirmationToken || "");
    const exchange = await executeLiveOrder(intent);
    return Response.json({ status: "SUBMITTED", idempotencyKey: intent.idempotencyKey, exchange, submittedAt: new Date().toISOString() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Live execution failed." }, { status: 422 });
  }
}
