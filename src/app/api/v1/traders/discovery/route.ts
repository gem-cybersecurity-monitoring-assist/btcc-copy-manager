import { NextResponse } from "next/server";
import { normalizeTraderRankings } from "@/lib/trader-discovery";

export async function GET() {
  const sources = [
    { venue: "Bitget", path: "bitget-copy-trading", sort: "pnl" },
    { venue: "Gate", path: "gate-copy-trading", sort: "copierPnl" },
  ] as const;
  const key=process.env.KOPYON_API_KEY?.trim();
  const settled=await Promise.allSettled(sources.map(async source=>{
    const query=new URLSearchParams({period:"30D",sortBy:source.sort,page:"1",rows:"5"});
    const response=await fetch(`https://api.kopyon.com/v5/${source.path}/traders?${query}`,{
      headers:{Accept:"application/json",...(key?{"X-API-KEY":key}:{})},
      next:{revalidate:21_600},signal:AbortSignal.timeout(8_000),
    });
    if(!response.ok) return { venue:source.venue, candidates:[] };
    const candidates=normalizeTraderRankings(await response.json(),source.venue);
    return {venue:source.venue,candidates};
  }));
  const available=settled.flatMap(r=>r.status==="fulfilled"&&r.value.candidates.length?[r.value]:[]);
  const candidates=available.flatMap(x=>x.candidates);
  return NextResponse.json({
    status:candidates.length?"aggregator_data_available":"unavailable",
    candidateCount:candidates.length,candidates,
    sources:available.map(x=>x.venue),retrievedAt:new Date().toISOString(),
    nativeExecutionAvailable:false,
    note:"Kopyon third-party 30-day trader rankings. Not exchange-authenticated or approved to copy. No leverage, fee-adjusted performance, full trade history, or native execution mapping has been verified.",
  },{status:candidates.length?200:503,headers:{"Cache-Control":"no-store"}});
}
