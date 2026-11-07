import test from "node:test";
import assert from "node:assert/strict";
import { parsePublicMarket } from "../src/lib/public-market.ts";

test("public market parser allows only validated supported assets", () => {
  const data = parsePublicMarket([
    { id: "bitcoin", symbol: "btc", name: "Bitcoin", current_price: 90000, price_change_percentage_24h: -2, total_volume: 120000, market_cap: 1000000, last_updated: "2026-11-07T12:00:00Z" },
    { id: "bitcoin", symbol: "btc", name: "Duplicate", current_price: 1, last_updated: "2026-11-07T12:00:00Z" },
    { id: "unsupported", symbol: "x", name: "Test", current_price: 1, last_updated: "2026-11-07T12:00:00Z" },
    { id: "solana", symbol: "sol", name: "Solana", current_price: -1, last_updated: "2026-11-07T12:00:00Z" },
  ]);
  assert.equal(data.length, 1);
  assert.equal(data[0].symbol, "BTC");
  assert.equal(data[0].change24hPct, -2);
});
test("bad upstream data never creates reference prices", () => {
  assert.deepEqual(parsePublicMarket({ error: "rate limited" }), []);
  assert.deepEqual(parsePublicMarket([{ id: "ethereum", symbol: "eth", name: "ETH", current_price: Infinity, last_updated: "bad" }]), []);
});
