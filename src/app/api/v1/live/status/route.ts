import { getLiveConfigurationStatus } from "@/lib/btcc-live";

export async function GET() {
  return Response.json({ ...getLiveConfigurationStatus(), observedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
