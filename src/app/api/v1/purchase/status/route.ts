import { getPurchaseConfigurationStatus } from "@/lib/finite-purchase";

export async function GET() {
  return Response.json(getPurchaseConfigurationStatus(), {
    headers: { "Cache-Control": "no-store" }
  });
}
