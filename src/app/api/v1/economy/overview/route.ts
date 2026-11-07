import { NextResponse } from "next/server";
import { ECONOMY_INDICATORS, parseWorldBankSeries } from "@/lib/economy";

export async function GET() {
  const settled=await Promise.allSettled(ECONOMY_INDICATORS.map(async indicator=>{
    const url=`https://api.worldbank.org/v2/country/USA/indicator/${indicator.id}?format=json&per_page=20&date=2014:2026`;
    const response=await fetch(url,{headers:{Accept:"application/json"},next:{revalidate:86_400},signal:AbortSignal.timeout(8000)});
    if(!response.ok) return null;
    return parseWorldBankSeries(await response.json(),indicator.id);
  }));
  const indicators=settled.flatMap(result=>result.status==="fulfilled"&&result.value?[result.value]:[]);
  return NextResponse.json({
    status: indicators.length?"available_or_partial":"unavailable",
    country:"United States",source:"World Bank Open Data",
    indicators,checkedAt:new Date().toISOString(),
    note:"Annual, lagging published indicators. Each indicator has its own latest year. These are macroeconomic context, not real-time crypto market signals or forecasts.",
  },{status:indicators.length?200:503,headers:{"Cache-Control":"no-store"}});
}
