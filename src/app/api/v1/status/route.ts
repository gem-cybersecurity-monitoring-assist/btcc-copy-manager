import { getLiveConfigurationStatus } from "@/lib/btcc-live";

export async function GET() {
  return Response.json({ service: "ready", ...getLiveConfigurationStatus(), observedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
