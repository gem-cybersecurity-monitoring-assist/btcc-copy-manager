import type { NextRequest } from "next/server";
import { withSentinelOwner } from "@/lib/sentinel-owner";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  return withSentinelOwner(request, async () => ({
    status: 403,
    body: {
      connected: false,
      code: "collector_forwarding_disabled",
      error: "Web collector forwarding is disabled: upstream ingestion can invoke execution. An ingestion-only path must be verified before enabling it.",
    },
  }), { mutation: true });
}
