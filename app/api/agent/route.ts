import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { cloudService, guardMutation, notConfigured, sessionCookiesFrom, toResponse } from "../../../lib/cloud-auth.ts";
import { runAgentTurn } from "../../../lib/agent/server.ts";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Reports whether the agent can be used, without revealing configuration values. */
export async function GET(request: NextRequest) {
  const service = cloudService();
  const keyPresent = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const session = service ? await service.getSession(sessionCookiesFrom(request)) : null;
  return NextResponse.json({ configured: keyPresent, signedIn: session?.state === "authenticated" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "agent");
  if (blocked) return blocked;
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return toResponse({ status: 503, body: { error: "The agent is not switched on yet. The site owner needs to add ANTHROPIC_API_KEY in Vercel (see AGENT_SETUP.md).", code: "agent_not_configured" } });
  // Only signed-in workspace owners may use the agent, so the API key cannot be used by anonymous visitors.
  const service = cloudService();
  if (!service) return notConfigured();
  const lookup = await service.getSession(sessionCookiesFrom(request));
  if (lookup.state !== "authenticated") {
    return toResponse({ status: 401, body: { error: "Sign in to your cloud account (top of the page) to use the agent.", code: "not_authenticated" }, cookies: lookup.cookies });
  }
  const result = await runAgentTurn(await request.text(), new Anthropic());
  return toResponse({ ...result, cookies: lookup.cookies });
}
