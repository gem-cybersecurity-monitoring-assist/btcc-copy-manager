import { NextRequest, NextResponse } from "next/server";
import { containsForbiddenCredentialKeys, pushCollectorBatch, type SentinelCollectorBatch } from "@/lib/sentinel-client";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (containsForbiddenCredentialKeys(body)) {
    return NextResponse.json(
      { error: "Credential-like fields are forbidden. Do not send passwords, cookies, API keys, tokens, sessions or 2FA values." },
      { status: 400 },
    );
  }

  try {
    const result = await pushCollectorBatch(body as SentinelCollectorBatch);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sentinel collector forwarding failed." },
      { status: 502 },
    );
  }
}
