import { NextResponse } from "next/server";
import { sentinelRequest } from "@/lib/sentinel-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await sentinelRequest<Record<string, unknown>>("/bitget/account-snapshot");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { connected: false, error: error instanceof Error ? error.message : "Bitget account snapshot unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
