import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STEEL_API = "https://api.steel.dev/v1";
const STEEL_CDP = "wss://connect.steel.dev";
const LOGIN = "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";
const COPY = "https://www.btcc.com/en-US/copy-trading";

function need(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} missing`);
  return value;
}

class Cdp {
  ws: WebSocket;
  id = 0;
  waiters = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(sessionId: string) {
    const url = `${STEEL_CDP}?apiKey=${encodeURIComponent(need("STEEL_API_KEY"))}&sessionId=${encodeURIComponent(sessionId)}`;
    this.ws = new WebSocket(url);
  }
  async open() {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cdp open timeout")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("cdp open failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let msg: any; try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg.id) return;
      const pending = this.waiters.get(msg.id); if (!pending) return;
      this.waiters.delete(msg.id); clearTimeout(pending.timer);
      msg.error ? pending.reject(new Error(msg.error.message || "cdp command failed")) : pending.resolve(msg.result);
    });
  }
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeout = 12000) {
    const id = ++this.id;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(id); reject(new Error(`${method} timeout`)); }, timeout);
      this.waiters.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async page() {
    const targets = await this.send("Target.getTargets");
    let targetId = targets.targetInfos?.find((t: any) => t.type === "page")?.targetId;
    if (!targetId) targetId = (await this.send("Target.createTarget", { url: "about:blank" })).targetId;
    const attached = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, attached.sessionId);
    await this.send("Runtime.enable", {}, attached.sessionId);
    return attached.sessionId as string;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function run() {
  const apiKey = need("STEEL_API_KEY");
  const username = need("BTCC_USERNAME");
  const password = need("BTCC_PASSWORD");
  const created = await fetch(`${STEEL_API}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "steel-api-key": apiKey },
    body: JSON.stringify({ timeout: 1800000, solveCaptcha: true, persistProfile: true, blockAds: true, deviceConfig: { device: "mobile" } }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000)
  });
  if (!created.ok) throw new Error(`steel create ${created.status}`);
  const session = await created.json() as { id?: string; profileId?: string };
  if (!session.id) throw new Error("steel session id missing");
  const cdp = new Cdp(session.id);
  await cdp.open();
  try {
    const page = await cdp.page();
    await cdp.send("Page.navigate", { url: LOGIN }, page);
    await new Promise(r => setTimeout(r, 2500));
    const script = `(() => {
      const set = (el, value) => { const p = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(p, 'value'); if (d?.set) d.set.call(el, value); else el.value = value; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); };
      const inputs = [...document.querySelectorAll('input')];
      const email = inputs.find(i => /email|user|account/i.test((i.placeholder||'')+' '+(i.name||'')+' '+(i.type||''))) || inputs.find(i => i.type==='text' || i.type==='email');
      const pass = inputs.find(i => i.type==='password');
      if (email) set(email, ${JSON.stringify(username)});
      if (pass) set(pass, ${JSON.stringify(password)});
      const buttons = [...document.querySelectorAll('button,[role=button]')];
      const login = buttons.find(b => /^log\s*in$/i.test((b.textContent||'').trim()) || /login/i.test((b.textContent||'').trim()));
      if (login) login.click();
      return {email:!!email, pass:!!pass, login:!!login};
    })()`;
    const filled = await cdp.send("Runtime.evaluate", { expression: script, returnByValue: true }, page);
    await new Promise(r => setTimeout(r, 7000));
    const state = await cdp.send("Runtime.evaluate", { expression: `({url:location.href,text:(document.body?.innerText||'').slice(0,4000)})`, returnByValue: true }, page);
    const value = state.result?.value || {};
    const signedIn = typeof value.url === "string" && value.url.includes("btcc.com") && !value.url.includes("/login");
    if (signedIn) {
      await cdp.send("Page.navigate", { url: COPY }, page);
      await new Promise(r => setTimeout(r, 3500));
      const copyState = await cdp.send("Runtime.evaluate", { expression: `({url:location.href,text:(document.body?.innerText||'').slice(0,5000)})`, returnByValue: true }, page);
      value.copy = copyState.result?.value || {};
    }
    return {
      ok: true,
      signedIn,
      profileId: session.profileId || null,
      sessionId: session.id,
      fill: filled.result?.value || null,
      page: { url: value.url || null, text: String(value.text || "").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]") },
      copy: value.copy ? { url: value.copy.url || null, text: String(value.copy.text || "").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]") } : null
    };
  } finally {
    cdp.close();
  }
}

export async function GET() {
  try {
    const result = await run();
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "recovery failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  }
}
