"use client";
// In-app agent chat. The browser keeps the conversation, sends it to /api/agent, and runs the agent's tool
// calls against this workspace. Reads run immediately; every change waits for the user's approval.
import { useEffect, useRef, useState } from "react";
import { executeAgentTool, WRITE_TOOLS } from "../../../../lib/agent/tools.ts";
import { localEngineReply } from "../../../../lib/agent/local-assistant.ts";
import type { EngineState } from "../../../../lib/engine/types.ts";
import { Notice, type EngineChange } from "./ui.tsx";

type Block = { type: string; [key: string]: unknown };
type Turn = { role: "user" | "assistant"; content: string | Block[] };
type Pending = { summary: string[]; resolve: (approved: boolean) => void };
type Status = { configured?: boolean; signedIn?: boolean; checked: boolean };

const MAX_ROUNDS = 10;
const TOOL_LABELS: Record<string, string> = {
  get_workspace_overview: "Looked at your workspace",
  get_strategy_details: "Checked a trader's evaluation",
  propose_allocation: "Worked out an allocation plan",
  get_risk_report: "Checked your portfolio risk",
  run_backtest: "Ran a backtest",
  add_strategy: "Proposed adding a trader",
  update_plan_settings: "Proposed new plan settings",
  update_risk_policy: "Proposed new risk limits",
  record_provider_update: "Proposed a provider update",
  run_risk_review: "Proposed running a risk review",
};
const EXAMPLES = [
  "I have $30. What should I do?",
  "Explain my current risk in simple words.",
  "Which of my traders are eligible, and why?",
  "Show automation monitoring status.",
];

export function AgentTab({ engine, onChange }: { engine: EngineState; onChange: EngineChange }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [status, setStatus] = useState<Status>({ checked: false });
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/agent", { cache: "no-store" }).then((r) => r.json()).then((d) => setStatus({ configured: Boolean(d.configured), signedIn: Boolean(d.signedIn), checked: true })).catch(() => setStatus({ checked: true }));
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [turns, pending, busy]);

  async function callAgent(transcript: Turn[]): Promise<{ content: Block[]; stop_reason: string } | null> {
    const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: transcript }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) setStatus((s) => ({ ...s, signedIn: false }));
      if (data.code === "agent_not_configured") setStatus((s) => ({ ...s, configured: false }));
      setError(data.error || `The agent could not respond (HTTP ${response.status}).`);
      return null;
    }
    return data;
  }

  function askApproval(summary: string[]): Promise<boolean> {
    return new Promise((resolve) => setPending({ summary, resolve }));
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setError("");
    setInput("");
    setBusy(true);
    // The transcript is append-only: assistant content is kept exactly as returned.
    let transcript: Turn[] = [...turns, { role: "user", content: message }];
    setTurns(transcript);
    let working = engineRef.current;
    const onlineAssistantAvailable = status.checked && status.configured === true && status.signedIn === true;
    if (!onlineAssistantAvailable) {
      const reply = localEngineReply(message, working, new Date());
      setTurns([...transcript, { role: "assistant", content: [{ type: "text", text: reply }] }]);
      setBusy(false);
      return;
    }
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const reply = await callAgent(transcript);
        if (!reply) return;
        transcript = [...transcript, { role: "assistant", content: reply.content }];
        setTurns(transcript);
        if (reply.stop_reason === "refusal") { setError("The assistant declined this request. Try rephrasing it."); return; }
        const toolUses = reply.content.filter((b) => b.type === "tool_use") as (Block & { id: string; name: string; input: unknown })[];
        if (reply.stop_reason !== "tool_use" || !toolUses.length) return;
        const results: Block[] = [];
        for (const use of toolUses) {
          const outcome = executeAgentTool(use.name, use.input, { engine: working, now: new Date() });
          if (outcome.kind === "error") { results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: outcome.message }); continue; }
          if (outcome.kind === "read") { results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(outcome.output).slice(0, 40_000) }); continue; }
          const approved = await askApproval(outcome.summary);
          setPending(null);
          if (approved) {
            working = outcome.next;
            onChange(outcome.next, { action: "agent_change_approved", detail: `${use.name}: ${outcome.summary.join("; ")}` });
            results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ approved: true, saved: true, ...((outcome.output as object) ?? {}) }).slice(0, 40_000) });
          } else {
            results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify({ approved: false, saved: false, note: "The user rejected this change. Ask what they would like instead." }) });
          }
        }
        // All results for this turn go back together in one user message.
        transcript = [...transcript, { role: "user", content: results }];
        setTurns(transcript);
      }
      setError("The agent took too many steps. Ask a narrower question.");
    } catch {
      setError("Could not reach the agent. Check your connection and try again.");
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const remote = status.checked && status.configured && status.signedIn;
  const ready = true;
  return (
    <div className="engine-stack agent">
      <Notice tone="info"><strong>{remote ? "Connected GEM assistant" : "Free GEM intelligence assistant"}</strong> — {remote ? "The connected model can use the engine's tools and proposes changes only after your approval." : "Instant, deterministic answers from your saved strategy scores, risk limits, allocation calculations, and monitoring records. No paid model, login or API key is needed for these local research answers."} Neither mode executes exchange trades or moves funds.</Notice>
      {status.checked && status.configured === false && <Notice tone="info">Online generative AI is not connected; the local deterministic engine is active. Ask about risk, strategies, allocations, simulations and monitoring.</Notice>}
      {status.checked && status.configured && !status.signedIn && <Notice tone="info">Sign in for the optional online assistant. Local intelligence remains available without a login.</Notice>}

      <div className="agent-chat" aria-live="polite">
        {!turns.length && <div className="agent-empty"><p>Ask in your own words. For example:</p><div className="agent-examples">{EXAMPLES.map((e) => <button key={e} type="button" className="secondary-btn" disabled={!ready || busy} onClick={() => void send(e)}>{e}</button>)}</div></div>}
        {turns.map((t, i) => <TurnView key={i} turn={t} />)}
        {pending && (
          <div className="agent-approval" role="alertdialog" aria-label="Approve change">
            <strong>The agent wants to make this change:</strong>
            <ul>{pending.summary.map((line) => <li key={line}>{line}</li>)}</ul>
            <div className="engine-actions"><button type="button" className="primary-btn" onClick={() => pending.resolve(true)}>Approve</button><button type="button" className="secondary-btn" onClick={() => pending.resolve(false)}>Reject</button></div>
          </div>
        )}
        {busy && !pending && <p className="agent-thinking">Working…</p>}
        <div ref={endRef} />
      </div>
      {error && <p className="form-message error" role="alert">{error}</p>}
      <form className="agent-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <label className="sr-only" htmlFor="agent-message">Message the agent</label>
        <textarea id="agent-message" rows={2} maxLength={4000} value={input} disabled={!ready || busy} placeholder={remote ? "Ask the connected assistant…" : "Ask about risk, top traders, capital allocation or monitoring…"} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
        <div className="engine-actions"><button type="submit" className="primary-btn" disabled={!ready || busy || !input.trim()}>Send</button>{turns.length > 0 && <button type="button" className="secondary-btn" disabled={busy} onClick={() => { setTurns([]); setError(""); }}>New conversation</button>}</div>
      </form>
      <p className="footnote">{remote ? "Messages and workspace details are sent to the connected model provider to produce responses." : "Local mode processes your questions using deterministic calculations in this browser; no model provider receives them."} Never share exchange passwords, API keys or recovery phrases. The assistant cannot guarantee returns.</p>
    </div>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    if (typeof turn.content === "string") return <div className="agent-msg user"><p>{turn.content}</p></div>;
    return null; // tool results are shown through the assistant's tool lines
  }
  const blocks = Array.isArray(turn.content) ? turn.content : [];
  return (
    <div className="agent-msg assistant">
      {blocks.map((b, i) => {
        if (b.type === "text" && typeof b.text === "string" && b.text.trim()) return <div key={i} className="agent-text">{b.text.split(/\n{2,}/).map((para, j) => <p key={j}>{para}</p>)}</div>;
        if (b.type === "tool_use" && typeof b.name === "string") return <p key={i} className="agent-tool">{WRITE_TOOLS.has(b.name) ? "✎" : "🔎"} {TOOL_LABELS[b.name] ?? b.name}</p>;
        return null;
      })}
    </div>
  );
}
