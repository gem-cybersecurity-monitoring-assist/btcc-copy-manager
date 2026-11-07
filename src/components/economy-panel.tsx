"use client";
import { useEffect,useState } from "react";
import { economyChartPoints,type EconomySeries } from "@/lib/economy";
import "./economy-panel.css";

type Report={status:string;source:string;country:string;indicators:EconomySeries[];checkedAt:string|null;note:string};
export function EconomyPanel(){
  const[report,setReport]=useState<Report|null>(null);
  const[loading,setLoading]=useState(true);
  async function refresh(){
    setLoading(true);
    try{
      const response=await fetch("/api/v1/economy/overview",{cache:"no-store"});
      setReport(await response.json() as Report);
    }catch{setReport({status:"unavailable",source:"World Bank Open Data",country:"United States",indicators:[],checkedAt:null,note:"Published annual macroeconomic data could not be retrieved."});}
    finally{setLoading(false);}
  }
  useEffect(()=>{void refresh();},[]);
  return <section className="gem-economy" aria-label="Economic growth indicators">
    <header className="gem-economy-head"><div>
      <span className="gem-economy-eyebrow">MACROECONOMIC CONTEXT</span><h2>Economic indicators</h2>
      <p>US growth, inflation and employment in published annual time series.</p>
    </div><button type="button" onClick={()=>void refresh()} disabled={loading}>{loading?"Loading…":"Refresh economy"}</button></header>
    {report?.indicators.length?<div className="gem-economy-grid">
      {report.indicators.map(s=>{
        const obs=s.observations.slice(-9),first=obs[0],last=obs[obs.length-1];
        return <article key={s.indicator}>
          <span className="gem-economy-metric-name">{s.label}</span>
          <div className="gem-economy-latest"><strong>{s.latestValue.toFixed(2)}%</strong><span>{s.latestYear} · latest reported</span></div>
          <svg viewBox="0 0 300 96" width="100%" role="img" aria-label={`${s.label} from ${first.year} to ${last.year}. Latest ${last.value.toFixed(2)} percent.`}>
            <line x1="6" y1="90" x2="294" y2="90" stroke="#d6e3dd" strokeWidth="1"/>
            <polyline points={economyChartPoints(obs)} fill="none" stroke="#17715a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <div className="gem-economy-axis"><span>{first.year}</span><span>{last.year}</span></div>
          <small>{s.unit}. Source: World Bank.</small>
        </article>;
      })}
    </div>:<p role="status" className="gem-economy-empty">{loading?"Checking official annual indicators…":"Economic series unavailable. No values are inferred."}</p>}
    {report && report.indicators.length<3 && !loading && <p className="gem-economy-footnote">Some indicators are unavailable from the data provider.</p>}
    <p className="gem-economy-footnote">World Bank annual observations can lag by one or more years. No economic growth rate shown here is a daily return prediction or a crypto trade signal.</p>
  </section>;
}
