import { NextResponse } from "next/server";
import { normalizeOrderBook } from "@/lib/liquidity";

export const dynamic = "force-dynamic";
export async function GET() {
  const targets = [
    { provider: "Bitget", symbol: "BTC", url: "https://api.bitget.com/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=10" },
    { provider: "Bitget", symbol: "ETH", url: "https://api.bitget.com/api/v2/spot/market/orderbook?symbol=ETHUSDT&type=step0&limit=10" },
    { provider: "Kraken", symbol: "BTC", url: "https://api.kraken.com/0/public/Depth?pair=XBTUSD&count=10" },
    { provider: "Kraken", symbol: "ETH", url: "https://api.kraken.com/0/public/Depth?pair=ETHUSD&count=10" },
  ] as const;
  const settled = await Promise.allSettled(targets.map(async target => {
    const response = await fetch(target.url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 30 },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    return normalizeOrderBook(target.provider, target.symbol, await response.json(), new Date());
  }));
  const books = settled.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
  return NextResponse.json({
    status: books.length ? "partial_or_available" : "unavailable",
    books,
    retrievedAt: new Date().toISOString(),
    providerCount: new Set(books.map(b => b.provider)).size,
    note: "Public spot top-ten order-book observations only. USD and USDT books are not identical, and source quotes do not establish executable copy-trading fill prices.",
  }, { status: books.length ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
