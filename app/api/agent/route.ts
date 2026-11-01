import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { cloudService, guardMutation, notConfigured, sessionCookiesFrom, toResponse } from "../../../lib/cloud-auth.ts";
import { agentProvider, parseAgentRequest, runAgentTurn } from "../../../lib/agent/server.ts";
import { runDeepSeekTurn } from "../../../lib/agent/deepseek.ts";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Reports whether the agent can be used, without revealing configuration values. */
export async function GET(request: NextRequest) {
  const service = cloudService();
  const { provider, configured } = agentProvider(process.env);
  const session = service ? await service.getSession(sessionCookiesFrom(request)) : null;
  return NextResponse.json({ configured, provider, signedIn: session?.state === "authenticated" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const blocked = guardMutation(request, "agent");
  if (blocked) return blocked;
  const { provider, configured } = agentProvider(process.env);
  if (!configured) return toResponse({ status: 503, body: { error: `The agent is not switched on yet. The site owner needs to add ${provider === "deepseek" ? "DEEPSEEK_API_KEY" : "ANTHROPIC_API_KEY"} in Vercel (see AGENT_SETUP.md).`, code: "agent_not_configured" } });
  // Only signed-in workspace owners may use the agent, so the API key cannot be used by anonymous visitors.
  const service = cloudService();
  if (!service) return notConfigured();
  const lookup = await service.getSession(sessionCookiesFrom(request));
  if (lookup.state !== "authenticated") {
    return toResponse({ status: 401, body: { error: "Sign in to your cloud account (top of the page) to use the agent.", code: "not_authenticated" }, cookies: lookup.cookies });
  }
  const rawBody = await request.text();
  let result;
  if (provider === "deepseek") {
    const parsed = parseAgentRequest(rawBody);
    result = parsed.ok ? await runDeepSeekTurn(parsed.messages as never, { apiKey: process.env.DEEPSEEK_API_KEY!.trim(), model: process.env.DEEPSEEK_MODEL?.trim() }) : parsed.result;
  } else {
    result = await runAgentTurn(rawBody, new Anthropic());
  }
  return toResponse({ ...result, cookies: lookup.cookies });
}
