import { NextRequest, NextResponse } from "next/server";
import { guardMutation, toResponse } from "../../../../lib/cloud-auth.ts";
export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ configured: false, signedIn: false, reason: "The optional AI assistant is not enabled in this release." }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "agent");
  if (blocked) return blocked;
  return toResponse({ status: 503, body: { error: "The optional AI assistant is not enabled. All research, scoring, allocation and risk tools remain available in the dashboard.", code: "agent_not_configured" } });
}
