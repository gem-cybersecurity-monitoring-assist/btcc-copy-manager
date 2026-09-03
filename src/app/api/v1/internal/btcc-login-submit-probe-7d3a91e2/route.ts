import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STEEL_API = "https://api.steel.dev/v1";
const STEEL_CDP = "wss://connect.steel.dev";
const LOGIN = "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";

function need(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} missing`);
  return value;
}

type Waiter = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
class Cdp {
  private ws: WebSocket;
  private id = 0;
  private waiters = new Map<number, Waiter>();
  constructor(sessionId: string) {
    const u = `${STEEL_CDP}?apiKey=${encodeURIComponent(need("STEEL_API_KEY"))}&sessionId=${encodeURIComponent(sessionId)}`;
    this.ws = new WebSocket(u);
  }
  async open() {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("cdp open timeout")), 10000);
      this.ws.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(t); reject(new Error("cdp open failed")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let msg: any; try { msg = JSON.parse(event.data); } catch { return; }
      if (!msg.id) return;
      const w = this.waiters.get(msg.id); if (!w) return;
      this.waiters.delete(msg.id); clearTimeout(w.timer);
      msg.error ? w.reject(new Error(msg.error.message || "cdp error")) : w.resolve(msg.result);
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

function redact(text: string) {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]").slice(0, 5000);
}

export async function GET() {
  let sessionId = "";
  try {
    const apiKey = need("STEEL_API_KEY");
    const username = need("BTCC_USERNAME");
    const password = need("BTCC_PASSWORD");
    const created = await fetch(`${STEEL_API}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "steel-api-key": apiKey },
      body: JSON.stringify({ timeout: 1800000, persistProfile: true, blockAds: true, deviceConfig: { device: "mobile" } }),
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const createdText = await created.text();
    if (!created.ok) throw new Error(`steel ${created.status} ${createdText.slice(0,160)}`);
    const session = JSON.parse(createdText) as { id?: string };
    if (!session.id) throw new Error("steel session id missing");
    sessionId = session.id;

    const cdp = new Cdp(session.id);
    await cdp.open();
    try {
      const page = await cdp.page();
      await cdp.send("Page.navigate", { url: LOGIN }, page);
      await new Promise(r => setTimeout(r, 2800));
      const expr = `(() => {
        const set = (el, value) => {
          const proto = Object.getPrototypeOf(el);
          const d = Object.getOwnPropertyDescriptor(proto, 'value');
          if (d && d.set) d.set.call(el, value); else el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        const inputs = [...document.querySelectorAll('input')];
        const email = inputs.find(i => i.type === 'email') || inputs.find(i => /email/i.test((i.placeholder||'')+' '+(i.name||''))) || inputs.find(i => i.type === 'text');
        const pass = inputs.find(i => i.type === 'password');
        if (email) set(email, ${JSON.stringify(username)});
        if (pass) set(pass, ${JSON.stringify(password)});
        const form = pass?.form || email?.form || document.querySelector('form');
        const submit = form?.querySelector('button[type=submit],input[type=submit]') || [...document.querySelectorAll('button')].find(b => /^login$/i.test((b.textContent||'').trim()));
        let action = 'none';
        if (form && typeof form.requestSubmit === 'function') { form.requestSubmit(submit instanceof HTMLElement ? submit : undefined); action = 'requestSubmit'; }
        else if (submit instanceof HTMLElement) { submit.click(); action = 'click'; }
        return { email: !!email, pass: !!pass, form: !!form, submit: !!submit, action };
      })()`;
      const submit = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true }, page);
      await new Promise(r => setTimeout(r, 9000));
      const state = await cdp.send("Runtime.evaluate", { expression: `({url:location.href,text:document.body?.innerText||'', dialogs:[...document.querySelectorAll('[role=dialog],.ant-message,.ant-notification,.el-message')].map(x=>(x.textContent||'').trim()).filter(Boolean).slice(0,10)})`, returnByValue: true }, page);
      const value = state.result?.value || {};
      const signedIn = typeof value.url === "string" && value.url.includes("btcc.com") && !value.url.includes("/login");
      return NextResponse.json({ ok: true, submit: submit.result?.value || null, signedIn, url: value.url || null, dialogs: value.dialogs || [], text: redact(String(value.text || "")) }, { headers: { "cache-control": "no-store" } });
    } finally {
      cdp.close();
    }
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "probe failed" }, { status: 500, headers: { "cache-control": "no-store" } });
  } finally {
    if (sessionId) {
      const key = process.env.STEEL_API_KEY?.trim();
      if (key) await fetch(`${STEEL_API}/sessions/${encodeURIComponent(sessionId)}/release`, { method: "POST", headers: { "content-type": "application/json", "steel-api-key": key }, cache: "no-store" }).catch(() => {});
    }
  }
}
