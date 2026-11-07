import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOrderBook } from "../src/lib/liquidity.ts";
const NOW = new Date("2026-11-07T12:00:00Z");
const bitget = {
  code: "00000",
  data: {
    ts: String(NOW.getTime()-1000),
    bids: [["100", "2"], ["99", "3"]],
    asks: [["101", "4"], ["102", "1"]],
  },
};
const kraken = { error: [], result: { XXBTZUSD: {
  bids: [["100", "2", (NOW.getTime()-1000)/1000]],
  asks: [["101", "1", (NOW.getTime()-1000)/1000]],
} } };

test("Bitget computes spread and quote depth from actual ordered price levels", () => {
  const book = normalizeOrderBook("Bitget","BTC",bitget,NOW);
  assert.ok(book);
  assert.equal(book.bid,100);
  assert.equal(book.ask,101);
  assert.equal(book.quoteCurrency,"USDT");
  assert.equal(book.bidDepthQuote,497);
  assert.equal(book.askDepthQuote,506);
  assert.ok(book.spreadBps>0 && book.spreadBps<100);
});
test("Kraken USD source uses matching book and reports USD quote", () => {
  const book=normalizeOrderBook("Kraken","BTC",kraken,NOW);
  assert.equal(book?.quoteCurrency,"USD");
  assert.equal(book?.levels,1);
});
test("stale or invalid and crossed order books fail closed", () => {
  assert.equal(normalizeOrderBook("Bitget","BTC",{...bitget,data:{...bitget.data,ts:String(NOW.getTime()-150000)}},NOW),null);
  assert.equal(normalizeOrderBook("Bitget","BTC",{...bitget,data:{...bitget.data,asks:[["98","2"]]}},NOW),null);
  assert.equal(normalizeOrderBook("Bitget","BTC",{...bitget,data:{...bitget.data,bids:[["100","NaN"]]}},NOW),null);
  assert.equal(normalizeOrderBook("Kraken","BTC",{error:["EQuery:Bad"],result:kraken.result},NOW),null);
  assert.equal(normalizeOrderBook("Kraken","BTC",{error:[],result:{}},NOW),null);
});
