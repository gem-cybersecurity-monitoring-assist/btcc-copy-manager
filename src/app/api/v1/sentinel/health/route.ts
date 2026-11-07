import type { NextRequest } from "next/server";
import { getSentinelHealth } from "@/lib/sentinel-client";
import { withSentinelOwner } from "@/lib/sentinel-owner";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return withSentinelOwner(request, async () => {
    try {
      const health = await getSentinelHealth();
      return { status: 200, body: { connected: health.ok === true, health } };
    } catch {
      return { status: 503, body: { connected: false, code: "sentinel_unavailable", error: "Sentinel is unavailable. Verify its endpoint and authentication." } };
    }
  });
}
