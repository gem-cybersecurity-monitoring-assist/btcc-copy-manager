import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BROWSERBASE_API_URL = "https://api.browserbase.com/v1";

export async function GET() {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;

  if (!apiKey || !projectId) {
    return NextResponse.json(
      { ok: false, error: "Browserbase environment is not configured" },
      { status: 503 },
    );
  }

  const response = await fetch(`${BROWSERBASE_API_URL}/contexts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-BB-API-Key": apiKey,
    },
    body: JSON.stringify({ projectId, name: "btcc-sentinel" }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { ok: false, status: response.status, error: "Browserbase context creation failed", detail: payload },
      { status: response.status },
    );
  }

  return NextResponse.json({ ok: true, contextId: payload.id });
}
