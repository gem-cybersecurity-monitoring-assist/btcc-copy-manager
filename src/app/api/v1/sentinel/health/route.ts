import { NextResponse } from "next/server";
import { getSentinelHealth, sentinelBaseUrl } from "@/lib/sentinel-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getSentinelHealth();
    return NextResponse.json({ connected: true, sentinelUrl: sentinelBaseUrl(), health });
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        sentinelUrl: sentinelBaseUrl(),
        error: error instanceof Error ? error.message : "Unknown Sentinel connection error",
      },
      { status: 503 },
    );
  }
}
