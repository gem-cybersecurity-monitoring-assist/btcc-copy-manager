export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BTCC_LOGIN_URL = "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";

function page(body: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>BTCC Google Login</title><style>body{font-family:system-ui;background:#07111f;color:#f8fafc;margin:0;padding:24px}main{max-width:560px;margin:auto;background:#0f172a;border:1px solid #334155;border-radius:18px;padding:24px}button,a{display:block;width:100%;box-sizing:border-box;padding:16px;margin:12px 0;border:0;border-radius:12px;background:#fff;color:#111;text-align:center;text-decoration:none;font-weight:700}.muted{color:#cbd5e1}.warn{color:#fbbf24}</style></head><body><main>${body}</main></body></html>`, {status, headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store","x-robots-tag":"noindex,nofollow,noarchive"}});
}

class CDP {
  ws: WebSocket; seq=0; pending=new Map<number,{resolve:(v:any)=>void,reject:(e:Error)=>void}>();
  constructor(url:string){this.ws=new WebSocket(url)}
  async open(){await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("CDP timeout")),10000);this.ws.addEventListener("open",()=>{clearTimeout(t);resolve()},{once:true});this.ws.addEventListener("error",()=>{clearTimeout(t);reject(new Error("CDP connection failed"))},{once:true})});this.ws.addEventListener("message",e=>{if(typeof e.data!=="string")return;let m:any;try{m=JSON.parse(e.data)}catch{return}if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message||"CDP error")):p.resolve(m.result)})}
  send(method:string,params:any={},sessionId?:string){const id=++this.seq;return new Promise<any>((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));setTimeout(()=>{if(this.pending.delete(id))reject(new Error(`${method} timeout`))},12000)})}
  async attach(){const ts=await this.send("Target.getTargets");let tid=ts.targetInfos?.find((x:any)=>x.type==="page")?.targetId;if(!tid)tid=(await this.send("Target.createTarget",{url:"about:blank"})).targetId;const a=await this.send("Target.attachToTarget",{targetId:tid,flatten:true});await this.send("Page.enable",{},a.sessionId);await this.send("Runtime.enable",{},a.sessionId);return a.sessionId as string}
  close(){try{this.ws.close()}catch{}}
}

async function sleep(ms:number){return new Promise(r=>setTimeout(r,ms))}

export async function GET(){return page(`<h1>Keyboard-free Google login</h1><p class="muted">This opens BTCC in a persistent Browserbase session and automatically presses the Google sign-in option. You still approve Google authentication yourself; no Google or BTCC password is collected here.</p><form method="post"><button>Create session + press Google sign-in</button></form><p class="warn">If Google asks for a password rather than phone/passkey approval, do not enter the password into this page.</p>`)}

export async function POST(){
 const apiKey=process.env.BROWSERBASE_API_KEY, projectId=process.env.BROWSERBASE_PROJECT_ID;
 if(!apiKey||!projectId)return page(`<h1>Browserbase not configured</h1>`,503);
 const headers={"Content-Type":"application/json","X-BB-API-Key":apiKey}; let cdp:CDP|undefined;
 try{
  const cr=await fetch("https://api.browserbase.com/v1/contexts",{method:"POST",headers,body:JSON.stringify({projectId,name:`btcc-google-${Date.now()}`}),cache:"no-store"}); if(!cr.ok)throw new Error(`Context failed (${cr.status})`); const context=await cr.json();
  const sr=await fetch("https://api.browserbase.com/v1/sessions",{method:"POST",headers,body:JSON.stringify({projectId,timeout:900,keepAlive:true,browserSettings:{context:{id:context.id,persist:true},viewport:{width:1280,height:900}},userMetadata:{purpose:"btcc-google-login"}}),cache:"no-store"}); if(!sr.ok)throw new Error(`Session failed (${sr.status})`); const session=await sr.json();
  cdp=new CDP(session.connectUrl); await cdp.open(); const sid=await cdp.attach(); await cdp.send("Page.navigate",{url:BTCC_LOGIN_URL},sid); await sleep(3000);
  const result=await cdp.send("Runtime.evaluate",{returnByValue:true,awaitPromise:true,expression:`(()=>{const els=[...document.querySelectorAll('button,a,[role="button"],div')];const el=els.find(e=>/google/i.test((e.innerText||e.getAttribute('aria-label')||e.getAttribute('title')||'').trim()) && e.getBoundingClientRect().width>0 && e.getBoundingClientRect().height>0);if(!el)return {clicked:false};el.click();return {clicked:true,text:(el.innerText||el.getAttribute('aria-label')||'').trim().slice(0,80)}})()`},sid); await sleep(2500); cdp.close(); cdp=undefined;
  const dr=await fetch(`https://api.browserbase.com/v1/sessions/${encodeURIComponent(session.id)}/debug`,{headers:{"X-BB-API-Key":apiKey},cache:"no-store"});if(!dr.ok)throw new Error(`Live View failed (${dr.status})`);const debug=await dr.json();
  return page(`<h1>Google login prepared</h1><p>Google button automation: <strong>${result?.result?.value?.clicked?"clicked":"not found"}</strong>.</p><a href="${String(debug.debuggerFullscreenUrl).replaceAll('&','&amp;').replaceAll('"','&quot;')}" rel="noreferrer">Open Live View</a><p class="muted">If Google offers your account, phone approval, QR, or passkey, use that. This route does not type or receive passwords.</p><p>Context ID: <code>${String(context.id).replaceAll('<','&lt;')}</code></p>`)
 }catch(e){cdp?.close();return page(`<h1>Setup failed</h1><p>${e instanceof Error?e.message:"Unknown error"}</p>`,502)}
}
