import { NextResponse } from "next/server";
import { parsePublicMarket } from "@/lib/public-market";

export async function GET() {
  try {
    const response = await fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin%2Cethereum%2Csolana&price_change_percentage=24h", {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("Market provider is unavailable");
    const assets = parsePublicMarket(await response.json());
    if (assets.length === 0) throw new Error("No validated market observations");
    return NextResponse.json({ status: "available", source: "CoinGecko public market reference", assets, asOf: new Date().toISOString(), note: "Spot reference data only. 24h volume is not order-book depth or executable liquidity." });
  } catch {
    return NextResponse.json({ status: "unavailable", source: "CoinGecko public market reference", assets: [], asOf: null, note: "Market data unavailable; no live prices or liquidity signals are inferred." }, { status: 503 });
  }
}
