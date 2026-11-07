import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerGET() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return NextResponse.json(
      { ok: false, configured: false, error: "Browserbase environment is not configured" },
      { status: 503 },
    );
  }

  const response = await fetch(
    `https://api.browserbase.com/v1/projects/${encodeURIComponent(projectId)}`,
    {
      method: "GET",
      headers: { "X-BB-API-Key": apiKey },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        status: response.status,
        error: "Browserbase authentication failed",
      },
      { status: response.status || 502 },
    );
  }

  const payload = await response.json().catch(() => ({}));
  return NextResponse.json({
    ok: true,
    configured: true,
    projectMatched: payload?.id === projectId,
  });
}

export async function GET(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerGET());
}
