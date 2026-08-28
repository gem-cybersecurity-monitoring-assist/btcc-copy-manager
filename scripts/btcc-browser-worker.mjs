#!/usr/bin/env node

/**
 * Read-only BTCC browser worker.
 *
 * Security model:
 * - attaches to a Chrome/Chromium instance that the user launched with remote debugging
 * - the user logs into BTCC manually in that browser
 * - only GET-style navigation and DOM reads are performed
 * - no cookies, storage, passwords, tokens, headers, API keys, or 2FA values are read or forwarded
 * - no buttons are clicked and no form fields are changed
 * - normalized observations are POSTed to btcc-copy-manager's Sentinel collector proxy
 */

const CDP_HTTP = (process.env.BTCC_CDP_HTTP || "http://127.0.0.1:9222").replace(/\/$/, "");
const MANAGER_URL = (process.env.BTCC_MANAGER_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const SCAN_INTERVAL_MS = positiveInt("BTCC_SCAN_INTERVAL_MS", 60_000);
const MAX_TRADER_PAGES = positiveInt("BTCC_MAX_TRADER_PAGES", 25);
const NAVIGATION_DELAY_MS = positiveInt("BTCC_NAVIGATION_DELAY_MS", 1_800);
const ONCE = process.argv.includes("--once");
const DRY_RUN = process.argv.includes("--dry-run");

function positiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function now() { return new Date().toISOString(); }
function numberFrom(text) {
  if (typeof text !== "string") return null;
  const cleaned = text.replace(/[$,%≈~\s]/g, "").replace(/,/g, "");
  const match = cleaned.match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}
function firstNumberAfter(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}[^\\d+-]{0,80}([+-]?[\\d,.]+)`, "i"));
    if (match) {
      const value = numberFrom(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}
function pctAfter(text, labels) {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`${escaped}[^\\d+-]{0,80}([+-]?[\\d,.]+)\\s*%`, "i"));
    if (match) return numberFrom(match[1]);
  }
  return null;
}
function sameBtccHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "btcc.com" || host.endsWith(".btcc.com");
  } catch { return false; }
}

class CdpSession {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.seq = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out connecting to Chrome DevTools.")), 8_000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not connect to Chrome DevTools.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "CDP error"));
      else pending.resolve(message.result);
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out.`));
      }, 12_000).unref?.();
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error("Browser evaluation failed.");
    return result.result?.value;
  }
  async navigate(url) {
    if (!sameBtccHost(url)) throw new Error("Refusing to navigate outside btcc.com.");
    await this.send("Page.navigate", { url, transitionType: "typed" });
    await sleep(NAVIGATION_DELAY_MS);
  }
  close() { try { this.ws.close(); } catch {} }
}

async function findBtccTab() {
  const response = await fetch(`${CDP_HTTP}/json`);
  if (!response.ok) throw new Error(`Chrome DevTools endpoint returned ${response.status}.`);
  const targets = await response.json();
  const candidates = targets.filter((target) => target.type === "page" && sameBtccHost(target.url || "") && target.webSocketDebuggerUrl);
  if (!candidates.length) throw new Error("No open BTCC tab found. Open BTCC in the remote-debugging Chrome window and log in manually.");
  return candidates[0];
}

const SAFE_DOM_EXTRACTOR = `(() => {
  const text = document.body?.innerText || "";
  const anchors = Array.from(document.querySelectorAll("a[href]")).map(a => ({
    href: a.href,
    text: (a.innerText || a.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 240)
  })).filter(x => x.href && x.text);
  return { url: location.href, title: document.title, text: text.slice(0, 250000), anchors };
})()`;

function parseAccount(page) {
  const text = page.text;
  const total = firstNumberAfter(text, ["Estimated Total Value", "Total Assets", "Total Value"]);
  const futures = firstNumberAfter(text, ["Futures Account", "Futures Balance", "Available Margin", "Available"]);
  const wallet = firstNumberAfter(text, ["Wallet Account", "Wallet Balance", "Funding Account"]);
  const openMargin = firstNumberAfter(text, ["Open Margin", "Position Margin", "Used Margin"]);
  const positions = firstNumberAfter(text, ["Open Positions", "Positions"]);
  const evidence = [total, futures, wallet].filter((x) => x !== null).length;
  return {
    total_usdt: total ?? 0,
    futures_free_usdt: futures ?? 0,
    wallet_usdt: wallet ?? 0,
    open_margin_usdt: openMargin ?? 0,
    active_positions: Number.isFinite(positions) ? positions : 0,
    source_timestamp: now(),
    provenance: { source: "dom", page_url: page.url, confidence: evidence >= 3 ? 0.9 : evidence === 2 ? 0.72 : evidence === 1 ? 0.45 : 0.2, captured_at: now() }
  };
}

function discoverTraderUrls(page) {
  const ranked = [];
  for (const anchor of page.anchors || []) {
    if (!sameBtccHost(anchor.href)) continue;
    const haystack = `${anchor.href} ${anchor.text}`.toLowerCase();
    if (!/(copy|trader|lead|follow)/.test(haystack)) continue;
    if (/(copy trade now|copy now|start copy|confirm|transfer|deposit|withdraw|buy|sell)/i.test(anchor.text)) continue;
    ranked.push({ href: anchor.href.split("#")[0], text: anchor.text });
  }
  const unique = [];
  const seen = new Set();
  for (const item of ranked) {
    if (seen.has(item.href)) continue;
    seen.add(item.href); unique.push(item);
  }
  return unique.slice(0, MAX_TRADER_PAGES);
}

function parseTrader(page, hint = "") {
  const text = page.text;
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const titleCandidate = lines.find((line) => line.length >= 2 && line.length <= 60 && !/(history|contract|copy trade|pnl|win rate|aum|copier|trading days)/i.test(line));
  const name = titleCandidate || hint || "Unknown trader";
  const pnl30d = pctAfter(text, ["Lead trader’s 30d PnL", "Lead trader's 30d PnL", "30d PnL", "30-day PnL"]);
  const winRate = pctAfter(text, ["Win rate", "Winning rate"]);
  const aum = firstNumberAfter(text, ["AUM", "Assets under management"]);
  const copierMatch = text.match(/([\d,]+)\s*\/\s*([\d,]+)\s*(?:copiers?|followers?)?/i);
  const copiers = copierMatch ? numberFrom(copierMatch[1]) : firstNumberAfter(text, ["Cumulative copy traders", "Copiers", "Followers"]);
  const capacity = copierMatch ? numberFrom(copierMatch[2]) : null;
  const trades = parseRecentTrades(text, page.url);
  return {
    name,
    pnl_30d_pct: pnl30d,
    aum_usdt: aum,
    win_rate_pct: winRate,
    copiers,
    copier_capacity: capacity,
    recent_trades: trades,
    source_timestamp: now(),
    provenance: { source: "dom", page_url: page.url, confidence: trades.length ? 0.82 : 0.58, captured_at: now() }
  };
}

function parseRecentTrades(text, pageUrl) {
  const chunks = text.split(/(?=(?:BTC|ETH|SOL|XRP|DOGE|JUP|XMR|ADA|BNB|AVAX|LINK|LTC|DOT|TRX|SUI|APT|ARB|OP|PEPE)[A-Z0-9]*USDT\s+Perp)/i);
  const trades = [];
  for (const chunk of chunks) {
    const symbolMatch = chunk.match(/\b([A-Z0-9]{2,15}USDT)\s+Perp/i);
    if (!symbolMatch) continue;
    const directionMatch = chunk.match(/\b(LONG|SHORT)\b/i);
    const levMatch = chunk.match(/\b(\d+(?:\.\d+)?)\s*[x×]\b/i);
    const margin = firstNumberAfter(chunk, ["Margin"]);
    const pnl = firstNumberAfter(chunk, ["Closing PnL", "Realized PnL", "PnL"]);
    const ratio = pctAfter(chunk, ["Closing PnL", "Realized PnL", "PnL"]);
    if (!directionMatch && !levMatch && margin === null && pnl === null) continue;
    trades.push({
      symbol: symbolMatch[1].toUpperCase(),
      direction: directionMatch ? directionMatch[1].toUpperCase() : "UNKNOWN",
      leverage: levMatch ? Number(levMatch[1]) : 0,
      margin_usdt: margin ?? 0,
      pnl_usdt: pnl ?? 0,
      pnl_ratio_pct: ratio ?? 0,
      provenance: { source: "dom", page_url: pageUrl, confidence: levMatch && pnl !== null ? 0.86 : 0.62, captured_at: now() }
    });
    if (trades.length >= 50) break;
  }
  return trades;
}

async function readPage(session) {
  const page = await session.evaluate(SAFE_DOM_EXTRACTOR);
  if (!page?.url || !sameBtccHost(page.url)) throw new Error("Attached page is no longer a BTCC page.");
  return page;
}

async function pushSnapshot(payload) {
  if (DRY_RUN) {
    console.log(JSON.stringify(payload, null, 2));
    return { dryRun: true };
  }
  const response = await fetch(`${MANAGER_URL}/api/v1/sentinel/collector`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Manager collector returned ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) : { ok: true };
}

async function scanOnce() {
  const target = await findBtccTab();
  const session = new CdpSession(target.webSocketDebuggerUrl);
  await session.open();
  try {
    const startPage = await readPage(session);
    const startUrl = startPage.url;
    const account = parseAccount(startPage);
    const traderLinks = discoverTraderUrls(startPage);
    const traders = [];

    for (const link of traderLinks) {
      try {
        await session.navigate(link.href);
        const page = await readPage(session);
        const trader = parseTrader(page, link.text);
        if (trader.name !== "Unknown trader" || trader.recent_trades.length || trader.pnl_30d_pct !== null) traders.push(trader);
      } catch (error) {
        console.warn(`[worker] skipped ${link.href}: ${error.message}`);
      }
    }

    if (startUrl && sameBtccHost(startUrl)) {
      try { await session.navigate(startUrl); } catch {}
    }

    const payload = { account, traders, collector_id: "btcc-authenticated-cdp-worker", captured_at: now() };
    const result = await pushSnapshot(payload);
    console.log(`[worker] ${now()} pushed account + ${traders.length} trader snapshots`, result);
    return result;
  } finally {
    session.close();
  }
}

async function main() {
  console.log(`[worker] read-only mode; Chrome=${CDP_HTTP}; manager=${MANAGER_URL}; interval=${SCAN_INTERVAL_MS}ms`);
  console.log("[worker] No cookies, passwords, tokens, storage, forms, or trade controls are read or changed.");
  do {
    try { await scanOnce(); }
    catch (error) { console.error(`[worker] scan failed: ${error.message}`); }
    if (ONCE) break;
    await sleep(SCAN_INTERVAL_MS);
  } while (true);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
