import type { NextRequest } from "next/server";
import { sentinelRequest } from "@/lib/sentinel-client";
import { withSentinelOwner } from "@/lib/sentinel-owner";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return withSentinelOwner(request, async () => {
    try {
      const result = await sentinelRequest<Record<string, unknown>>("/bitget/account-snapshot");
      return { status: 200, body: result };
    } catch {
      return { status: 503, body: { connected: false, code: "sentinel_unavailable", error: "Bitget account snapshot is unavailable." } };
    }
  });
}
