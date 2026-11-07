import { appendAudit, defaultEngineState, ENGINE_LIMITS, parseEngineState } from "../../lib/engine/state.ts";
import type { EngineState, Strategy } from "../../lib/engine/types.ts";
import { STORAGE_KEYS } from "../../lib/workspace.ts";
import type { TraderCandidate } from "./trader-discovery";

/**
 * Saves public third-party ranking observations for further research.
 * No trade, provider activation, or exchange execution capability is created.
 */
export function addCandidateResearch(
  state: EngineState,
  candidate: TraderCandidate,
  at: Date,
): { ok: true; state: EngineState } | { ok: false; reason: string } {
  if (!Number.isFinite(at.getTime()) || candidate.executable !== false ||
      (candidate.venue !== "Bitget" && candidate.venue !== "Gate") ||
      !candidate.id || candidate.id.length > 100 || !candidate.name.trim()) {
    return { ok: false, reason: "This candidate is not a validated research record." };
  }
  const providerId = candidate.venue === "Bitget" ? "bitget" : "gate";
  // The server-side public endpoint validates third-party fields; client still
  // enforces schema and never treats an aggregator ID as an exchange project.
  if (state.strategies.some(x => x.providerId === providerId && x.externalId === candidate.id)) {
    return { ok: false, reason: "That trader is already in your research engine." };
  }
  if (state.strategies.length >= ENGINE_LIMITS.strategies) {
    return { ok: false, reason: "The research engine is at its strategy limit." };
  }
  const timestamp = at.toISOString();
  const id = `research-${at.getTime().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
  const values: NonNullable<Strategy["observations"][number]>["values"] = { periodDays: 30 };
  if (candidate.roi30dPct !== null) values.roiPct = candidate.roi30dPct;
  if (candidate.maxDrawdownPct !== null) values.maxDrawdownPct = candidate.maxDrawdownPct;
  if (candidate.winRatePct !== null) values.winRatePct = candidate.winRatePct;
  if (candidate.copiers !== null) values.followers = candidate.copiers;
  if (candidate.aumUsd !== null) values.aumUsd = candidate.aumUsd;
  const strategy: Strategy = {
    id,providerId,name:candidate.name.slice(0,120),externalId:candidate.id,
    profileUrl:null,assets:[],style:"",maxLeverage:null,profitSharePct:null,
    minCopyUsd:null,series:null,createdAt:timestamp,
    observations:[{
      id:`obs-${at.getTime().toString(36)}`,strategyId:id,source:"provider_profile",
      method:"Kopyon third-party public 30D ranking; not native exchange-verified",
      collectedAt:timestamp,confidence:0.45,verified:false,sourceUrl:null,values,
    }],
  };
  const next=appendAudit({ ...state, strategies:[...state.strategies,strategy] }, {
    at:timestamp,actor:"user",action:"research_candidate_saved",
    detail:`${strategy.name} (${providerId}): third-party summary only; not eligible for allocation without independent trade history.`,
  });
  const parsed=parseEngineState(next);
  if (!parsed.ok) return { ok:false,reason:parsed.error };
  return { ok:true,state:parsed.value };
}

export function saveCandidateToBrowser(candidate: TraderCandidate): { ok: boolean; reason: string } {
  try {
    const raw=localStorage.getItem(STORAGE_KEYS.engine);
    const parsed=raw ? parseEngineState(JSON.parse(raw)) : { ok:true as const,value:defaultEngineState() };
    if (!parsed.ok) return { ok:false,reason:"Your saved research engine is unreadable. Export a backup before editing." };
    const result=addCandidateResearch(parsed.value,candidate,new Date());
    if (!result.ok) return result;
    const serial=JSON.stringify(result.state);
    if (new TextEncoder().encode(serial).length>550_000) return { ok:false,reason:"Research storage limit reached." };
    localStorage.setItem(STORAGE_KEYS.engine,serial);
    return { ok:true,reason:"Saved as unverified research. Add independently verified return history and fees before allocation." };
  } catch {
    return { ok:false,reason:"Could not save this research to browser storage." };
  }
}
