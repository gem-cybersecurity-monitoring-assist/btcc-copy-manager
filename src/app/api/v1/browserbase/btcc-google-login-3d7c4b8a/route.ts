import type { NextRequest as OwnerRequest } from "next/server";
import { withOwnerRequest } from "@/lib/owner-request";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BTCC_LOGIN_URL = "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";

function esc(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function page(body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>BTCC one-tap login</title><style>body{font-family:system-ui;background:#07111f;color:#f8fafc;margin:0;padding:24px}main{max-width:560px;margin:auto;background:#0f172a;border:1px solid #334155;border-radius:18px;padding:24px}button,a{display:block;width:100%;box-sizing:border-box;padding:17px;margin:14px 0;border:0;border-radius:12px;background:#fff;color:#111;text-align:center;text-decoration:none;font-weight:750;font-size:16px}.muted{color:#cbd5e1;line-height:1.5}.warn{color:#fbbf24;line-height:1.5}.ok{color:#86efac}.err{color:#fca5a5}code{overflow-wrap:anywhere}</style></head><body><main>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex,nofollow,noarchive" } });
}

class CDP {
  ws: WebSocket;
  seq = 0;
  pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(url: string) { this.ws = new WebSocket(url); }
  async open() {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Cloud browser connection timed out.")), 10_000);
      this.ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Could not connect to the cloud browser.")); }, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let message: any;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      message.error ? pending.reject(new Error(message.error.message || "Cloud browser command failed.")) : pending.resolve(message.result);
    });
  }
  send(method: string, params: any = {}, sessionId?: string) {
    const id = ++this.seq;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, 12_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async pageTargets() {
    const targets = await this.send("Target.getTargets");
    return (targets.targetInfos || []).filter((target: any) => target.type === "page");
  }
  async attach(targetId: string) {
    const attached = await this.send("Target.attachToTarget", { targetId, flatten: true });
    await this.send("Page.enable", {}, attached.sessionId);
    await this.send("Runtime.enable", {}, attached.sessionId);
    return attached.sessionId as string;
  }
  async attachFirstPage() {
    const pages = await this.pageTargets();
    let targetId = pages[0]?.targetId;
    if (!targetId) targetId = (await this.send("Target.createTarget", { url: "about:blank" })).targetId;
    if (!targetId) throw new Error("No browser page was available.");
    return this.attach(targetId);
  }
  async eval(sessionId: string, expression: string) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    return result?.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForGoogleTarget(cdp: CDP, fallbackTargetId?: string) {
  for (let i = 0; i < 10; i++) {
    const pages = await cdp.pageTargets();
    const google = pages.find((p: any) => /accounts\.google\.com|google\.com\/signin/i.test(p.url || ""));
    if (google?.targetId) return google.targetId as string;
    await sleep(700);
  }
  return fallbackTargetId;
}

async function snapshot(cdp: CDP, sid: string) {
  return cdp.eval(sid, `(()=>({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,16000),hasEmail:!!document.querySelector('input[type="email"]'),hasPassword:!!document.querySelector('input[type="password"]')}))()`);
}

async function clickText(cdp: CDP, sid: string, patterns: string[]) {
  return cdp.eval(sid, `(()=>{const pats=${JSON.stringify(patterns)}.map(x=>new RegExp(x,'i'));const els=[...document.querySelectorAll('button,a,[role="button"],div[role="link"],li')];const el=els.find(e=>{const r=e.getBoundingClientRect();const t=(e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').trim();return r.width>0&&r.height>0&&pats.some(p=>p.test(t))});if(!el)return {clicked:false};el.click();return {clicked:true,text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,120)}})()`);
}

async function releaseSession(apiKey: string, projectId: string, sessionId: string) {
  await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BB-API-Key": apiKey },
    body: JSON.stringify({ status: "REQUEST_RELEASE", projectId }),
    cache: "no-store",
  }).catch(() => undefined);
}

async function ownerGET(request: Request) {
  const url = new URL(request.url);
  const supplied = (url.searchParams.get("email") || "").trim();
  const fallback = (process.env.BTCC_USERNAME || "").trim();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplied) ? supplied : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallback) ? fallback : "");
  const hidden = email ? `<input type="hidden" name="email" value="${esc(email)}">` : "";
  return page(`<h1>One-tap BTCC Google login</h1><p class="muted">No cloud-browser clicking or keyboard is required. This will open BTCC, press Google sign-in, enter the Google email identifier, and try to select a phone/passkey approval method. Passwords and verification codes are never requested by this page.</p>${email ? `<p class="ok">Google email is ready.</p>` : `<p class="warn">No Google email was supplied. Open the prepared link from ChatGPT again.</p>`}<form method="post">${hidden}<button type="submit" ${email ? "" : "disabled"}>Start Google phone approval</button></form><p class="warn">After tapping Start, watch your phone for a Google approval prompt. Keep this page open while it works.</p>`);
}

async function ownerPOST(request: Request) {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  if (!apiKey || !projectId) return page(`<h1>Browserbase not configured</h1>`, 503);

  const form = await request.formData();
  const email = String(form.get("email") || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return page(`<h1>Email identifier missing</h1><p class="err">Open the prepared one-tap link again.</p>`, 400);
  }

  const headers = { "Content-Type": "application/json", "X-BB-API-Key": apiKey };
  let cdp: CDP | undefined;
  let sessionId = "";
  let contextId = "";

  try {
    const contextResponse = await fetch("https://api.browserbase.com/v1/contexts", {
      method: "POST",
      headers,
      body: JSON.stringify({ projectId, name: `btcc-sentinel-primary-${Date.now()}` }),
      cache: "no-store",
    });
    if (!contextResponse.ok) throw new Error(`Context creation failed (${contextResponse.status}).`);
    const context = await contextResponse.json();
    contextId = String(context.id || "");
    if (!contextId) throw new Error("Browserbase did not return a Context ID.");

    const sessionResponse = await fetch("https://api.browserbase.com/v1/sessions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId,
        timeout: 120,
        browserSettings: { context: { id: contextId, persist: true }, viewport: { width: 1280, height: 900 } },
        userMetadata: { purpose: "btcc-google-one-tap" },
      }),
      cache: "no-store",
    });
    if (!sessionResponse.ok) throw new Error(`Cloud session creation failed (${sessionResponse.status}).`);
    const session = await sessionResponse.json();
    sessionId = String(session.id || "");
    if (!sessionId || !session.connectUrl) throw new Error("Cloud session connection details were missing.");

    cdp = new CDP(session.connectUrl);
    await cdp.open();
    const btccSid = await cdp.attachFirstPage();
    await cdp.send("Page.navigate", { url: BTCC_LOGIN_URL }, btccSid);
    await sleep(3000);

    const btccPages = await cdp.pageTargets();
    const btccTargetId = btccPages.find((p: any) => /btcc\.com/i.test(p.url || ""))?.targetId;
    const googleClick = await clickText(cdp, btccSid, ["google"]);
    if (!googleClick?.clicked) throw new Error("BTCC Google sign-in button was not found. BTCC may have changed the login page.");

    await sleep(2200);
    const googleTargetId = await waitForGoogleTarget(cdp, btccTargetId);
    if (!googleTargetId) throw new Error("Google sign-in did not open.");
    const googleSid = googleTargetId === btccTargetId ? btccSid : await cdp.attach(googleTargetId);
    await sleep(1200);

    let state = await snapshot(cdp, googleSid);
    if (state?.hasEmail) {
      await cdp.eval(googleSid, `(()=>{const el=document.querySelector('input[type="email"]');if(!el)return false;el.focus();el.value='';return true})()`);
      await cdp.send("Input.insertText", { text: email }, googleSid);
      const next = await clickText(cdp, googleSid, ["^Next$", "continue", "identifierNext"]);
      if (!next?.clicked) {
        await cdp.eval(googleSid, `(()=>{const el=document.querySelector('#identifierNext,button[type="submit"]');if(!el)return false;el.click();return true})()`);
      }
      await sleep(3200);
      state = await snapshot(cdp, googleSid);
    }

    if (state?.hasPassword) {
      const alt = await clickText(cdp, googleSid, ["try another way", "other ways", "more ways"]);
      if (alt?.clicked) {
        await sleep(2200);
        state = await snapshot(cdp, googleSid);
      }
    }

    const bodyText = String(state?.text || "");
    const alreadyPhone = /check your phone|tap yes|sent a notification|google prompt|approve.*phone/i.test(bodyText);
    let phoneTriggered = alreadyPhone;

    if (!phoneTriggered) {
      const phone = await clickText(cdp, googleSid, ["use.*phone", "phone.*tablet", "google prompt", "tap yes", "approve.*phone"]);
      if (phone?.clicked) {
        phoneTriggered = true;
        await sleep(1800);
      }
    }

    if (!phoneTriggered) {
      const passkey = await clickText(cdp, googleSid, ["use your passkey", "passkey"]);
      if (passkey?.clicked) {
        await sleep(1800);
        state = await snapshot(cdp, googleSid);
      }
    }

    const startedAt = Date.now();
    let loggedIn = false;
    let lastState = state;
    while (Date.now() - startedAt < 32_000) {
      await sleep(1800);
      const pages = await cdp.pageTargets();
      const btcc = pages.find((p: any) => /btcc\.com/i.test(p.url || "") && !/\/login(?:[/?#]|$)/i.test(p.url || ""));
      if (btcc) { loggedIn = true; break; }
      try { lastState = await snapshot(cdp, googleSid); } catch {}
    }

    cdp.close();
    cdp = undefined;
    await releaseSession(apiKey, projectId, sessionId);

    if (loggedIn) {
      return page(`<h1 class="ok">BTCC login completed</h1><p class="muted">The authenticated browser state is being saved into a persistent Browserbase Context. You did not need to use the cloud preview.</p><p class="ok">Next: Sentinel can verify this Context with a fresh read-only session.</p>`);
    }

    const finalText = String(lastState?.text || "");
    if (/password/i.test(finalText) && !/try another way|phone|passkey/i.test(finalText)) {
      return page(`<h1>Google requires a password</h1><p class="warn">Google did not offer a password-free phone/passkey route in this cloud session. No password was entered or collected.</p><p class="muted">The next safest workaround is a mobile control page that sends your typing directly to the focused cloud-browser field without exposing it to Sentinel logs.</p>`);
    }

    return page(`<h1>Approval not completed yet</h1><p class="warn">The Google approval flow was started, but BTCC was not logged in before this one-tap attempt timed out. No password or verification code was collected.</p><p class="muted">If you received a Google approval notification, approve it and run the one-tap link once more. If no notification appeared, I’ll switch to the mobile control-page fallback.</p>`);
  } catch (error) {
    cdp?.close();
    if (sessionId) await releaseSession(apiKey, projectId, sessionId);
    const message = error instanceof Error ? error.message : "Unknown login bootstrap failure.";
    return page(`<h1>One-tap login could not finish</h1><p class="err">${esc(message)}</p><p class="muted">No password, 2FA code, cookie, or session connection URL was collected.</p>`, 502);
  }
}

export async function GET(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerGET(request));
}

export async function POST(request: OwnerRequest) {
  return withOwnerRequest(request, () => ownerPOST(request), { mutation: true, requireJson: false });
}
