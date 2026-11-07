import type { NextRequest } from "next/server";
import { sentinelRequest } from "@/lib/sentinel-client";
import { withSentinelOwner } from "@/lib/sentinel-owner";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  return withSentinelOwner(request, async () => {
    try {
      // /scan invokes execution and prepares workflows. Never use it for a page read.
      const result = await sentinelRequest<Record<string, unknown>>("/review/latest");
      return { status: 200, body: result };
    } catch {
      return { status: 503, body: { connected: false, code: "readonly_review_unavailable", error: "The read-only Sentinel review is unavailable. The service must support /review/latest; no scan was started." } };
    }
  });
}
