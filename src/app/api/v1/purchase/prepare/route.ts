import { prepareFinitePurchase, type FinitePurchaseIntent } from "@/lib/finite-purchase";

function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "";
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Partial<FinitePurchaseIntent> & { remoteCountry?: string };
    const observedCountry = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
    const intent: FinitePurchaseIntent = {
      amountPerExecution: Number(body.amountPerExecution),
      executionCount: Number(body.executionCount),
      quoteCurrency: body.quoteCurrency === "EUR" ? "EUR" : "USD",
      payinGroup: body.payinGroup === "balance" ? "balance" : "card",
      clientEmail: typeof body.clientEmail === "string" && body.clientEmail.trim() ? body.clientEmail.trim() : undefined,
      clientIp: clientIp(request),
      remoteCountry: observedCountry || String(body.remoteCountry || "").trim().toUpperCase(),
      ownerAcknowledgedTotal: body.ownerAcknowledgedTotal === true
    };
    const prepared = prepareFinitePurchase(intent);
    return Response.json(prepared, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Finite purchase preparation failed." },
      { status: 422, headers: { "Cache-Control": "no-store" } }
    );
  }
}
