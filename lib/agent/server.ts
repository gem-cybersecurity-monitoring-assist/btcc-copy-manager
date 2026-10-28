// Server-side relay between the dashboard and the agent's model (Claude here; DeepSeek in deepseek.ts). The browser owns the conversation and runs the
// tools against the user's workspace; this module validates the transcript, adds the fixed system prompt
// and tool definitions, and calls the Messages API with the server-held API key.

import Anthropic from "@anthropic-ai/sdk";
import { AGENT_SYSTEM_PROMPT, AGENT_TOOLS } from "./tools.ts";

export const AGENT_MODEL = "claude-opus-5-5";
export const AGENT_LIMITS = { maxBytes: 400_000, maxMessages: 60 } as const;

const USER_BLOCKS = new Set(["text", "tool_result"]);
const ASSISTANT_BLOCKS = new Set(["text", "tool_use", "thinking", "redacted_thinking", "fallback"]);

export type AgentResult = { status: number; body: Record<string, unknown> };
type MessagesClient = { beta: { messages: { create: (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage> } } };

/** Accepts only user/assistant turns with expected block types, so a client cannot inject system instructions. */
export function validateTranscript(raw: unknown): { ok: true; messages: Anthropic.Beta.BetaMessageParam[] } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { messages?: unknown }).messages)) return { ok: false, error: "Body must contain a messages array." };
  const messages = (raw as { messages: unknown[] }).messages;
  if (!messages.length || messages.length > AGENT_LIMITS.maxMessages) return { ok: false, error: `Conversation must have 1–${AGENT_LIMITS.maxMessages} messages. Start a new conversation.` };
  for (const [i, m] of messages.entries()) {
    if (typeof m !== "object" || m === null) return { ok: false, error: `Message ${i + 1} is invalid.` };
    const { role, content } = m as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return { ok: false, error: `Message ${i + 1} has an unsupported role.` };
    if (i === 0 && role !== "user") return { ok: false, error: "The conversation must start with a user message." };
    if (typeof content === "string") { if (role !== "user" || !content.trim() || content.length > 8000) return { ok: false, error: `Message ${i + 1} text is empty or too long.` }; continue; }
    if (!Array.isArray(content) || !content.length) return { ok: false, error: `Message ${i + 1} has no content.` };
    const allowed = role === "user" ? USER_BLOCKS : ASSISTANT_BLOCKS;
    for (const block of content) {
      const type = (block as { type?: unknown })?.type;
      if (typeof type !== "string" || !allowed.has(type)) return { ok: false, error: `Message ${i + 1} contains an unsupported block.` };
    }
  }
  return { ok: true, messages: messages as Anthropic.Beta.BetaMessageParam[] };
}

export type AgentProvider = "anthropic" | "deepseek";

/** AGENT_PROVIDER picks the backend; otherwise DeepSeek is used when only its key is set, else Claude. */
export function agentProvider(env: Record<string, string | undefined>): { provider: AgentProvider; configured: boolean } {
  const has = (k: string) => Boolean(env[k]?.trim());
  const wanted = env.AGENT_PROVIDER?.trim().toLowerCase();
  const provider: AgentProvider = wanted === "deepseek" || wanted === "anthropic" ? wanted : has("DEEPSEEK_API_KEY") && !has("ANTHROPIC_API_KEY") ? "deepseek" : "anthropic";
  return { provider, configured: has(provider === "deepseek" ? "DEEPSEEK_API_KEY" : "ANTHROPIC_API_KEY") };
}

/** Size, JSON and transcript checks shared by every backend. */
export function parseAgentRequest(rawBody: string): { ok: true; messages: Anthropic.Beta.BetaMessageParam[] } | { ok: false; result: AgentResult } {
  if (new TextEncoder().encode(rawBody).byteLength > AGENT_LIMITS.maxBytes) {
    return { ok: false, result: { status: 413, body: { error: "This conversation is too long. Start a new conversation.", code: "conversation_too_long" } } };
  }
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch { return { ok: false, result: { status: 400, body: { error: "Request body must be valid JSON.", code: "invalid_json" } } }; }
  const transcript = validateTranscript(parsed);
  if (!transcript.ok) return { ok: false, result: { status: 400, body: { error: transcript.error, code: "invalid_transcript" } } };
  return transcript;
}

export async function runAgentTurn(rawBody: string, client: MessagesClient): Promise<AgentResult> {
  const transcript = parseAgentRequest(rawBody);
  if (!transcript.ok) return transcript.result;
  try {
    const response = await client.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 16000,
      // Server-side refusal fallback: if the model declines, the API reruns the turn on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system: [{ type: "text", text: AGENT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: AGENT_TOOLS as unknown as Anthropic.Beta.BetaToolUnion[],
      messages: transcript.messages,
    });
    return { status: 200, body: { content: response.content, stop_reason: response.stop_reason, model: response.model } };
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return { status: 429, body: { error: "The AI service is busy. Wait a minute and try again.", code: "agent_rate_limited" } };
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return { status: 503, body: { error: "The agent's API key was rejected. The site owner needs to check ANTHROPIC_API_KEY in Vercel.", code: "agent_key_invalid" } };
    if (error instanceof Anthropic.BadRequestError) return { status: 400, body: { error: "The AI service rejected this conversation. Start a new conversation.", code: "agent_bad_request" } };
    if (error instanceof Anthropic.APIError) return { status: 502, body: { error: "The AI service returned an error. Try again shortly.", code: "agent_upstream_error" } };
    return { status: 503, body: { error: "The AI service could not be reached. Try again shortly.", code: "agent_unreachable" } };
  }
}
