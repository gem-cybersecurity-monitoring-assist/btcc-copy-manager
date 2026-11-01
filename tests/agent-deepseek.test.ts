import assert from "node:assert/strict";
import test from "node:test";
import { DEEPSEEK_TOOLS, fromDeepSeekResponse, runDeepSeekTurn, toDeepSeekMessages } from "../lib/agent/deepseek.ts";
import { agentProvider, parseAgentRequest } from "../lib/agent/server.ts";
import { AGENT_SYSTEM_PROMPT, AGENT_TOOLS, executeAgentTool } from "../lib/agent/tools.ts";
import { defaultEngineState } from "../lib/engine/state.ts";

const transcript = [
  { role: "user" as const, content: "Set my plan to $40" },
  { role: "assistant" as const, content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: "Setting it." }, { type: "tool_use", id: "call_1", name: "update_plan_settings", input: { total_capital_usd: 40 } }] },
  { role: "user" as const, content: [{ type: "tool_result", tool_use_id: "call_1", content: "{\"approved\":true}" }] },
];

test("provider selection: explicit AGENT_PROVIDER wins, otherwise DeepSeek only when its key alone is set", () => {
  assert.deepEqual(agentProvider({}), { provider: "anthropic", configured: false });
  assert.deepEqual(agentProvider({ DEEPSEEK_API_KEY: "k" }), { provider: "deepseek", configured: true });
  assert.deepEqual(agentProvider({ DEEPSEEK_API_KEY: "k", ANTHROPIC_API_KEY: "a" }), { provider: "anthropic", configured: true });
  assert.deepEqual(agentProvider({ AGENT_PROVIDER: "DeepSeek", ANTHROPIC_API_KEY: "a" }), { provider: "deepseek", configured: false });
  assert.deepEqual(agentProvider({ AGENT_PROVIDER: "other", DEEPSEEK_API_KEY: " " }), { provider: "anthropic", configured: false });
});

test("transcript converts to chat-completions format with system prompt first and tool results after the call", () => {
  const out = toDeepSeekMessages(transcript as never);
  assert.deepEqual(out[0], { role: "system", content: AGENT_SYSTEM_PROMPT });
  assert.deepEqual(out[1], { role: "user", content: "Set my plan to $40" });
  assert.deepEqual(out[2], { role: "assistant", content: "Setting it.", tool_calls: [{ id: "call_1", type: "function", function: { name: "update_plan_settings", arguments: "{\"total_capital_usd\":40}" } }] });
  assert.deepEqual(out[3], { role: "tool", tool_call_id: "call_1", content: "{\"approved\":true}" });
  const err = toDeepSeekMessages([{ role: "user", content: [{ type: "tool_result", tool_use_id: "c", is_error: true, content: "bad" }] }] as never);
  assert.equal((err[1] as { content: string }).content, "ERROR: bad");
  assert.equal(DEEPSEEK_TOOLS.length, AGENT_TOOLS.length);
  assert.equal(DEEPSEEK_TOOLS[0].function.parameters, AGENT_TOOLS[0].input_schema);
});

test("replies convert back to the blocks the Agent tab runs, including tool calls and bad JSON arguments", () => {
  const r = fromDeepSeekResponse({ model: "deepseek-chat", choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ id: "call_9", type: "function", function: { name: "get_risk_report", arguments: "{}" } }, { id: "call_10", type: "function", function: { name: "get_workspace_overview", arguments: "{not json" } }] } }] });
  assert.deepEqual(r, { model: "deepseek-chat", stop_reason: "tool_use", content: [{ type: "tool_use", id: "call_9", name: "get_risk_report", input: {} }, { type: "tool_use", id: "call_10", name: "get_workspace_overview", input: {} }] });
  assert.equal(fromDeepSeekResponse({ choices: [{ finish_reason: "stop", message: { content: "Hi" } }] })?.stop_reason, "end_turn");
  assert.equal(fromDeepSeekResponse({ choices: [{ finish_reason: "length", message: { content: "Hi" } }] })?.stop_reason, "max_tokens");
  assert.equal(fromDeepSeekResponse({ choices: [{ finish_reason: "content_filter", message: { content: null } }] })?.stop_reason, "refusal");
  assert.equal(fromDeepSeekResponse({}), null);
});

test("tools tolerate DeepSeek omitting optional fields instead of sending null", () => {
  const out = executeAgentTool("update_plan_settings", { total_capital_usd: 40 }, { engine: defaultEngineState(), now: new Date("2026-10-28T12:00:00Z") });
  assert.equal(out.kind, "write");
  if (out.kind === "write") assert.equal(out.next.planner.totalCapitalUsd, 40);
});

test("runDeepSeekTurn sends key, model, tools and maps upstream errors to safe messages", async () => {
  let sent: { url: string; headers: Record<string, string>; body: any } | undefined;
  const ok = async (url: string, init: { headers: Record<string, string>; body: string }) => { sent = { url, headers: init.headers, body: JSON.parse(init.body) }; return { ok: true, status: 200, json: async () => ({ model: "deepseek-chat", choices: [{ finish_reason: "stop", message: { content: "Hello" } }] }) }; };
  const parsed = parseAgentRequest(JSON.stringify({ messages: [{ role: "user", content: "hi" }] }));
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const res = await runDeepSeekTurn(parsed.messages as never, { apiKey: "test-key", fetchImpl: ok as never });
  assert.equal(res.status, 200);
  assert.equal(sent?.url, "https://api.deepseek.com/chat/completions");
  assert.equal(sent?.headers.Authorization, "Bearer test-key");
  assert.equal(sent?.body.model, "deepseek-chat");
  assert.equal(sent?.body.tools.length, AGENT_TOOLS.length);
  assert.equal(sent?.body.tool_choice, undefined);
  assert.deepEqual((res.body as any).content, [{ type: "text", text: "Hello" }]);
  await runDeepSeekTurn(parsed.messages as never, { apiKey: "k", model: "deepseek-reasoner", fetchImpl: ok as never });
  assert.equal(sent?.body.model, "deepseek-reasoner");

  const status = (s: number) => (async () => ({ ok: false, status: s, json: async () => ({ error: { message: "secret upstream detail" } }) })) as never;
  for (const [s, expected, code] of [[401, 503, "agent_key_invalid"], [402, 503, "agent_no_balance"], [429, 429, "agent_rate_limited"], [400, 400, "agent_bad_request"], [500, 502, "agent_upstream_error"]] as const) {
    const r = await runDeepSeekTurn(parsed.messages as never, { apiKey: "k", fetchImpl: status(s) });
    assert.equal(r.status, expected, String(s));
    assert.equal(r.body.code, code);
    assert.equal(JSON.stringify(r.body).includes("secret upstream detail"), false);
  }
  const down = await runDeepSeekTurn(parsed.messages as never, { apiKey: "k", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as never });
  assert.equal(down.status, 503);
  const garbage = await runDeepSeekTurn(parsed.messages as never, { apiKey: "k", fetchImpl: (async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) })) as never });
  assert.equal(garbage.status, 502);
});
