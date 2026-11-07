/** Source-labeled third-party trader rankings: screening only, never execution IDs. */
export type TraderCandidate = {
  id: string; venue: "Bitget" | "Gate"; name: string;
  roi30dPct: number | null; winRatePct: number | null;
  maxDrawdownPct: number | null; aumUsd: number | null;
  copiers: number | null; score: number | null;
  verdict: "REVIEW" | "HIGH_RISK" | "INSUFFICIENT";
  reasons: string[]; provenance: "Kopyon third-party ranking";
  executable: false;
};
const finite = (v: unknown): number | null => typeof v==="number" && Number.isFinite(v)?v:null;
const percent = (v: unknown) => {
  const n=finite(v);
  return n===null || Math.abs(n)>10 ? null : n*100;
};
export function normalizeTraderRankings(value: unknown, venue: "Bitget"|"Gate"): TraderCandidate[] {
  if (!value || typeof value!=="object") return [];
  const response=value as Record<string,unknown>;
  const body=response.data;
  if (!body || typeof body!=="object" || !Array.isArray((body as Record<string,unknown>).traders)) return [];
  const seen = new Set<string>();
  const candidates: TraderCandidate[] = [];
  for (const entry of ((body as Record<string,unknown>).traders as unknown[]).slice(0,8)) {
    if (!entry || typeof entry!=="object") continue;
    const row=entry as Record<string,unknown>;
    const id=typeof row.traderId==="string" ? row.traderId.trim(): "";
    const name=typeof row.name==="string" ? row.name.trim().slice(0,100): "";
    if (!id || !name || seen.has(id) || id.length>100) continue;
    seen.add(id);
    const roi30dPct=percent(row.roi);
    const maxDrawdownPct=percent(row.maxDrawdown);
    const winRatePct=percent(row.winRate);
    const aum=finite(row.aum);
    const aumUsd=aum!==null && aum>=0 && aum<1e12?aum:null;
    const copierValue=finite(row.copiers);
    const copiers=copierValue!==null && Number.isInteger(copierValue)&&copierValue>=0?copierValue:null;
    const complete=roi30dPct!==null && maxDrawdownPct!==null && maxDrawdownPct>=0 && maxDrawdownPct<=100 &&
      winRatePct!==null && winRatePct>=0 && winRatePct<=100;
    const score=complete?Math.max(0,Math.min(100,Math.round(
      55+Math.max(-50,Math.min(80,roi30dPct))*0.12+(winRatePct-50)*0.3-maxDrawdownPct*1.25-(copiers===0?5:0)
    ))):null;
    const highRisk=complete && (maxDrawdownPct!>=30 || winRatePct!<40 || score!<35);
    const reasons=complete?[
      `30-day ROI ${roi30dPct!.toFixed(1)}%, maximum reported drawdown ${maxDrawdownPct!.toFixed(1)}%`,
      `Reported win rate ${winRatePct!.toFixed(1)}%; exchange execution permissions unverified`,
      highRisk?"Risk metrics exceed conservative screening criteria":"Requires independent history, leverage, fees and native ID verification",
    ]:["Missing or invalid 30-day drawdown, ROI or win-rate evidence"];
    candidates.push({
      id,venue,name,roi30dPct,winRatePct,maxDrawdownPct,aumUsd,copiers,
      score,verdict:!complete?"INSUFFICIENT":highRisk?"HIGH_RISK":"REVIEW",
      reasons,provenance:"Kopyon third-party ranking",executable:false,
    });
  }
  return candidates.sort((a,b)=>(b.score??-1)-(a.score??-1));
}
