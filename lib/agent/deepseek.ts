// DeepSeek backend for the in-app agent. DeepSeek speaks the OpenAI-style chat-completions format, so this
// module converts the browser's transcript (Anthropic-style content blocks, which AgentTab keeps) to that
// format and converts each reply back. Tools still run in the browser and writes still need approval.

import { AGENT_SYSTEM_PROMPT, AGENT_TOOLS } from "./tools.ts";
import type { AgentResult } from "./server.ts";

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";
export const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

type Block = { type: string; [key: string]: unknown };
type TranscriptMessage = { role: "user" | "assistant"; content: string | Block[] };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
export type DeepSeekOptions = { apiKey: string; model?: string; fetchImpl?: FetchLike; timeoutMs?: number };

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((b) => (b && typeof b === "object" && (b as Block).type === "text" ? String((b as Block).text ?? "") : "")).join("\n");
  return "";
};

export const DEEPSEEK_TOOLS = AGENT_TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.input_schema } }));

/** Anthropic-style transcript → chat-completions messages (system prompt first, tool results as `tool` messages). */
export function toDeepSeekMessages(messages: TranscriptMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: AGENT_SYSTEM_PROMPT }];
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role === "user" ? "user" : "assistant", content: m.content } as ChatMessage); continue; }
    if (m.role === "assistant") {
      const text = m.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
      const calls: ToolCall[] = m.content.filter((b) => b.type === "tool_use").map((b) => ({ id: String(b.id), type: "function", function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } }));
      // Thinking/fallback blocks are Claude-specific and are not sent to DeepSeek.
      if (!text && !calls.length) continue;
      out.push(calls.length ? { role: "assistant", content: text || null, tool_calls: calls } : { role: "assistant", content: text });
      continue;
    }
    // Tool results must directly follow the assistant message that requested them.
    for (const b of m.content) if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: String(b.tool_use_id), content: (b.is_error ? "ERROR: " : "") + textOf(b.content) });
    const text = m.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n").trim();
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

const STOP_REASONS: Record<string, string> = { tool_calls: "tool_use", stop: "end_turn", length: "max_tokens", content_filter: "refusal" };

/** Chat-completions reply → the `{ content, stop_reason, model }` shape AgentTab already understands. */
export function fromDeepSeekResponse(raw: unknown): { content: Block[]; stop_reason: string; model: string } | null {
  const choice = (raw as { choices?: { message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }[] })?.choices?.[0];
  if (!choice?.message) return null;
  const content: Block[] = [];
  if (typeof choice.message.content === "string" && choice.message.content.trim()) content.push({ type: "text", text: choice.message.content });
  const calls = Array.isArray(choice.message.tool_calls) ? (choice.message.tool_calls as ToolCall[]) : [];
  for (const call of calls) {
    if (!call?.id || !call.function?.name) continue;
    let input: unknown = {};
    try { input = JSON.parse(call.function.arguments || "{}"); } catch { input = {}; }
    content.push({ type: "tool_use", id: call.id, name: call.function.name, input });
  }
  const finish = typeof choice.finish_reason === "string" ? choice.finish_reason : "stop";
  const stop_reason = content.some((b) => b.type === "tool_use") ? "tool_use" : (STOP_REASONS[finish] ?? "end_turn");
  if (!content.length) content.push({ type: "text", text: stop_reason === "refusal" ? "" : "(No reply. Try rephrasing.)" });
  return { content, stop_reason, model: String((raw as { model?: unknown }).model ?? "") };
}

export async function runDeepSeekTurn(messages: TranscriptMessage[], options: DeepSeekOptions): Promise<AgentResult> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchImpl(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
      body: JSON.stringify({ model: options.model || DEEPSEEK_DEFAULT_MODEL, max_tokens: 8192, temperature: 0.3, messages: toDeepSeekMessages(messages), tools: DEEPSEEK_TOOLS }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 55_000),
    });
  } catch {
    return { status: 503, body: { error: "The AI service could not be reached. Try again shortly.", code: "agent_unreachable" } };
  }
  if (!response.ok) {
    const s = response.status;
    if (s === 401 || s === 403) return { status: 503, body: { error: "The agent's API key was rejected. The site owner needs to check DEEPSEEK_API_KEY in Vercel.", code: "agent_key_invalid" } };
    if (s === 402) return { status: 503, body: { error: "The DeepSeek account has no balance left. The site owner needs to top it up.", code: "agent_no_balance" } };
    if (s === 429) return { status: 429, body: { error: "The AI service is busy. Wait a minute and try again.", code: "agent_rate_limited" } };
    if (s === 400 || s === 422) return { status: 400, body: { error: "The AI service rejected this conversation. Start a new conversation.", code: "agent_bad_request" } };
    return { status: 502, body: { error: "The AI service returned an error. Try again shortly.", code: "agent_upstream_error" } };
  }
  const reply = fromDeepSeekResponse(await response.json().catch(() => null));
  if (!reply) return { status: 502, body: { error: "The AI service returned an unexpected reply. Try again shortly.", code: "agent_upstream_error" } };
  return { status: 200, body: reply };
}
