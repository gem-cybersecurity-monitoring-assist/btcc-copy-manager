/** Annual US macro context from public World Bank indicators. */
export const ECONOMY_INDICATORS = [
  { id: "NY.GDP.MKTP.KD.ZG", label: "Real GDP growth", unit: "% annual" },
  { id: "FP.CPI.TOTL.ZG", label: "Consumer price inflation", unit: "% annual" },
  { id: "SL.UEM.TOTL.ZS", label: "Unemployment (ILO estimate)", unit: "% labor force" },
] as const;

export type EconomyObservation = { year: number; value: number };
export type EconomySeries = {
  indicator: string; label: string; unit: string;
  observations: EconomyObservation[];
  latestYear: number; latestValue: number;
};
export function parseWorldBankSeries(input: unknown, indicator: string): EconomySeries | null {
  const meta = ECONOMY_INDICATORS.find(x=>x.id === indicator);
  if (!meta || !Array.isArray(input) || input.length<2 || !Array.isArray(input[1])) return null;
  const years = new Map<number,number>();
  for(const item of input[1]){
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string,unknown>;
    const year = Number(r.date), value = r.value;
    if (!Number.isInteger(year) || year<2014 || year>2026) continue;
    if (typeof value!=="number" || !Number.isFinite(value) || Math.abs(value)>100) continue;
    years.set(year,value);
  }
  const observations = [...years].map(([year,value])=>({year,value})).sort((a,b)=>a.year-b.year);
  if (observations.length<2) return null;
  const last = observations[observations.length-1];
  return {indicator,label:meta.label,unit:meta.unit,observations,latestYear:last.year,latestValue:last.value};
}

/** Build chart points from recorded values without substituting missing years. */
export function economyChartPoints(items: EconomyObservation[], width=300, height=96): string {
  if (items.length<2) return "";
  const earliest=Math.min(...items.map(x=>x.year)),latest=Math.max(...items.map(x=>x.year));
  const low=Math.min(0,...items.map(x=>x.value)),high=Math.max(0,...items.map(x=>x.value));
  const range=(high-low)||1, period=(latest-earliest)||1;
  return items.map(x=>{
    const px=6+(x.year-earliest)/period*(width-12);
    const py=6+(high-x.value)/range*(height-12);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  }).join(" ");
}
