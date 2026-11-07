/**
 * Free deterministic fallback for the GEM research assistant.
 * No LLM, external requests, executable exchange commands, or state changes.
 */
import { executeAgentTool } from "./tools.ts";
import type { EngineState } from "../engine/types.ts";

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter(x=>x !== null && typeof x === "object" && !Array.isArray(x)).map(record) : [];
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const fixed = (value: unknown, digits=2) => {
  const n = number(value);
  return n===null?"Unavailable":n.toLocaleString("en-US",{maximumFractionDigits:digits});
};

export function localEngineReply(message: string, engine: EngineState, now = new Date()): string {
  const text=message.toLowerCase().trim();
  const tool=(name:string,input:unknown={})=>{
    const output=executeAgentTool(name,input,{engine,now});
    return output.kind === "read"?record(output.output):{};
  };
  if (/\b(withdraw|send money|transfer|place (an? )?order|execute|go live|deposit|buy crypto)\b/i.test(text)) {
    return "This local intelligence assistant cannot place orders, initiate copying, transfer or withdraw funds. Exchange actions are only available through a supported authenticated integration with your explicit approval. Review Automation and Accounts for actual service readiness.";
  }
  if (/\b(stop.loss|risk limit|drawdown limit|leverage limit|protect capital|stop copying)\b/i.test(text)) {
    const p=engine.policy;
    return `Saved risk limits: strategy drawdown ${p.maxStrategyDrawdownPct}%, portfolio stress loss ${p.maxPortfolioDrawdownPct}%, maximum leverage ${p.maxLeverage}×, per-strategy capital ${p.maxPerStrategyPct}%, per-provider capital ${p.maxPerProviderPct}%. These are screening and review limits in your GEM workspace, NOT automatically enforced stop-loss orders at an exchange. Go to Strategy intelligence → Risk center to inspect and adjust them.`;
  }
  if (/\b(risk|danger|exposure|alert|portfolio loss|how safe)\b/i.test(text)) {
    const p=tool("get_risk_report");
    const alerts=list(p.alerts);
    const messages=alerts.slice(0,4).map(x=>`- ${String(x.severity??"Review")}: ${String(x.message??"Risk condition")}`).join("\n");
    return `Recorded portfolio exposure: $${fixed(p.totalUsd)}. Historical stress-loss estimate: $${fixed(p.stressLossUsd)} (${fixed(p.stressLossPct)}%). ${alerts.length} current risk condition(s).${messages?"\n"+messages:" No active risk alert conditions were calculated from your recorded positions."}\nThese are recorded browser data, not independently synchronized live exchange balances. Open Automation for monitoring and account-service status.`;
  }
  if (/\b(allocat(?:e|ion|ions)?|how much|budget|plan|capital|split|invest|have \$|\$[0-9])\b/i.test(text)) {
    const match=message.match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);
    const total=match?Number(match[1]):null;
    const p=tool("propose_allocation",{total_capital_usd:total,method:null,include_simulated:false});
    const rows=list(p.allocations),blocked=list(p.rejected);
    return `Risk-constrained allocation proposal for $${fixed(total??engine.planner.totalCapitalUsd)}: protected reserve $${fixed(p.reserveUsd)}, unallocated $${fixed(p.unallocatedUsd)}. ${rows.length ? rows.slice(0,5).map(x=>`\n- ${String(x.strategy??x.strategyId??"Candidate")}: $${fixed(x.amountUsd)}`).join("") : "No strategy currently meets the eligibility requirements for a real allocation."} ${blocked.length?`\n${blocked.length} candidate(s) were excluded by data or risk requirements.`:""}\nThis is a calculation, not a recommendation to deposit or copy automatically. Full verified trade history and executable exchange eligibility remain separate.`;
  }
  if (/\b(best|top|rank|eligible|which trader|which strateg(?:y|ies)|winning trader|copy trader)\b/i.test(text)) {
    const o=tool("get_workspace_overview"), strategies=list(o.strategies);
    const approved=strategies.filter(x=>x.eligible===true).sort((a,b)=>(number(b.score)??0)-(number(a.score)??0));
    return approved.length
      ? `${approved.length} strategy/strategies meet your saved screening criteria: ${approved.slice(0,4).map(x=>`${String(x.name??"Unknown")} (score ${fixed(x.score,0)})`).join("; ")}. These are eligibility calculations from recorded evidence, not guaranteed winning traders or permission to execute on an exchange. Validate fees, recent trade history, native IDs and account risk before any copy action.`
      : `No recorded strategy currently qualifies for allocation. ${strategies.length} research record(s) exist, but public 30-day leaderboard summaries do not establish sufficient return history. Save candidates in Opportunities, then add independently checked return history and fee details in Trader Intelligence.`;
  }
  if (/\b(backtest|historical|simulate|simulation|test strategy)\b/i.test(text)) {
    const b=tool("run_backtest"), results=list(b.results);
    if(!results.length) return "No complete backtest is available from the saved histories. Add dated return series to eligible research strategies first. Backtests are simulations, not real earnings.";
    return `Historical strategy simulation (${results.length} methods): ${results.slice(0,4).map(x=>`${String(x.method??"Method")}: ${fixed(x.total_return_pct)}% return, ${fixed(x.max_drawdown_pct)}% drawdown`).join("; ")}. A backtest does not establish future daily profits, and imported or simulated data must not be confused with verified live outcomes.`;
  }
  if (/\b(review|monitor(?:ing)?|last check|automation|schedule|run engine)\b/i.test(text)) {
    const alerts=engine.alerts.filter(a=>!a.resolvedAt);
    return `The last saved local engine review was ${engine.monitor.lastRunAt?new Date(engine.monitor.lastRunAt).toLocaleString():"not recorded"}. Review interval: ${engine.monitor.intervalHours} hour(s). ${alerts.length} open alert(s). The dashboard can perform deterministic reviews while it remains open; continuous background execution requires a configured persistent Sentinel service. Open Automation to run a review and see live service status.`;
  }
  if (/\b(account|provider|exchange|connected|bitget|gate|btcc|mt5|wallet)\b/i.test(text)) {
    const o=tool("get_workspace_overview"),tracked=list(o.tracked_providers);
    return tracked.length
      ? `${tracked.length} provider record(s) are tracked: ${tracked.slice(0,6).map(x=>`${String(x.provider_id??"Unknown")}: ${String(x.status??"Unknown")}`).join("; ")}. These are locally recorded statuses, not proof that exchange account authentication or execution is active. Open Accounts and Automation for real connectivity checks.`
      : "No tracked provider record is saved in this browser. Public market data and trader rankings do not connect your account automatically. Open Accounts to check the available connection and authentication options.";
  }
  const o=tool("get_workspace_overview");
  return `GEM's free local research assistant can explain recorded risk, ranked traders, capital allocation, simulation, account status, and automation monitoring. Current engine: ${list(o.strategies).length} research strategies and ${list(o.open_alerts).length} open alerts. Try: “Explain my risk”, “Which traders are eligible?”, “Plan $30”, or “Show monitoring status”. This is a deterministic rules engine, not a generative AI model or trading executor.`;
}
