"use client";
import { useEffect, useState } from "react";
import type { TraderCandidate } from "@/lib/trader-discovery";
import { saveCandidateToBrowser } from "@/lib/trader-research-handoff";
import "./trader-discovery-panel.css";

type Report={status:string;candidateCount:number;candidates:TraderCandidate[];sources:string[];retrievedAt:string;nativeExecutionAvailable:false;note:string};
const pct=(v:number|null)=>v===null?"Not reported":v.toFixed(1)+"%";

export function TraderDiscoveryPanel(){
 const[report,setReport]=useState<Report|null>(null);
 const[loading,setLoading]=useState(true);
 const[error,setError]=useState("");
 const[researchMessage,setResearchMessage]=useState("");
 function saveForReview(candidate: TraderCandidate){
  setResearchMessage(saveCandidateToBrowser(candidate).reason);
 }
 async function refresh(){
  setLoading(true);setError("");
  try{
   const response=await fetch("/api/v1/traders/discovery",{cache:"no-store"});
   const data=await response.json() as Report;
   if(!response.ok || !Array.isArray(data.candidates)) throw new Error("Public trader rankings are unavailable or rate limited.");
   setReport(data);
  }catch(cause){setReport(null);setError(cause instanceof Error?cause.message:"Trader discovery is unavailable.");}
  finally{setLoading(false);}
 }
 useEffect(()=>{void refresh();},[]);
 return <section className="gem-discovery" aria-label="Trader discovery intelligence">
  <header className="gem-discovery-head"><div>
   <span className="gem-discovery-overline">MULTI-EXCHANGE SCREENING</span><h2>Trader discovery</h2>
   <p>Third-party 30-day leaderboards for Bitget and Gate, screened for drawdown and consistency evidence.</p>
  </div><button disabled={loading} onClick={()=>void refresh()}>{loading?"Checking…":"Refresh candidates"}</button></header>
  {report?.candidates.length?<div className="gem-discovery-table-wrap"><table>
   <thead><tr><th scope="col">Trader</th><th scope="col">30-day ROI</th><th scope="col">Drawdown</th><th scope="col">Win rate</th><th scope="col">Screen</th><th scope="col">Decision</th><th scope="col">Research</th></tr></thead>
   <tbody>{report.candidates.map(item=><tr key={item.venue+":"+item.id}>
    <td><strong>{item.name}</strong><small>{item.venue} · Kopyon data</small></td>
    <td>{pct(item.roi30dPct)}</td><td>{pct(item.maxDrawdownPct)}</td><td>{pct(item.winRatePct)}</td>
    <td>{item.score===null?"Insufficient":item.score+"/100"}</td>
    <td><span className={`gem-discovery-verdict ${item.verdict.toLowerCase()}`}>{item.verdict==="REVIEW"?"Review only":item.verdict==="HIGH_RISK"?"High risk":"Insufficient data"}</span></td>
    <td><button type="button" className="gem-discovery-save" onClick={()=>saveForReview(item)} aria-label={`Save ${item.name} as research`}>Save research</button></td>
   </tr>)}</tbody>
  </table></div>:<p role="status" className="gem-discovery-empty">{loading?"Checking external rankings…":error||"No third-party ranking observations available."}</p>}
  {researchMessage&&<p className="gem-discovery-meta" role="status">{researchMessage} <a href="/copy-trading?engine=opportunities">Open engine research</a></p>}
  {report?.candidates.length?<p className="gem-discovery-meta">Retrieved: {new Date(report.retrievedAt).toLocaleString()} · Sources: {report.sources.join(", ")} via Kopyon. This timestamp is when GEM retrieved the rankings, not when the exchange audited the trader history.</p>:null}
  <p className="gem-discovery-footnote">All records are screening-only. High ROI can conceal leverage and losses; native follow IDs, fees, slippage, account access and full trading history are not validated. No trader is authorized for automatic execution.</p>
 </section>;
}
