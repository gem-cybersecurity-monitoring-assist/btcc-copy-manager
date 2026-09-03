import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOGIN = "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";
const COPY = "https://www.btcc.com/en-US/copy-trading";

function need(name: string) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} missing`);
  return v;
}

type P = { resolve:(v:any)=>void; reject:(e:Error)=>void; timer:ReturnType<typeof setTimeout> };
class Cdp {
  ws: WebSocket; id=0; pending=new Map<number,P>();
  constructor(url:string){ this.ws=new WebSocket(url); }
  async open(){
    await new Promise<void>((resolve,reject)=>{ const t=setTimeout(()=>reject(new Error("cdp timeout")),10000); this.ws.addEventListener("open",()=>{clearTimeout(t);resolve();},{once:true}); this.ws.addEventListener("error",()=>{clearTimeout(t);reject(new Error("cdp failed"));},{once:true}); });
    this.ws.addEventListener("message",e=>{ if(typeof e.data!=="string")return; let m:any;try{m=JSON.parse(e.data)}catch{return} if(!m.id)return; const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message||"cdp error")):p.resolve(m.result); });
  }
  send(method:string,params:Record<string,unknown>={},sessionId?:string,timeout=12000){ const id=++this.id; return new Promise<any>((resolve,reject)=>{ const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timeout`));},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})); }); }
  async page(){ const t=await this.send("Target.getTargets"); let targetId=t.targetInfos?.find((x:any)=>x.type==="page")?.targetId; if(!targetId)targetId=(await this.send("Target.createTarget",{url:"about:blank"})).targetId; const a=await this.send("Target.attachToTarget",{targetId,flatten:true}); await this.send("Page.enable",{},a.sessionId); await this.send("Runtime.enable",{},a.sessionId); return a.sessionId as string; }
  close(){try{this.ws.close()}catch{}}
}

async function execute(){
  const apiKey=need("BROWSERBASE_API_KEY"), projectId=need("BROWSERBASE_PROJECT_ID"), username=need("BTCC_USERNAME"), password=need("BTCC_PASSWORD");
  const headers={"content-type":"application/json","X-BB-API-Key":apiKey};
  const cr=await fetch("https://api.browserbase.com/v1/contexts",{method:"POST",headers,body:JSON.stringify({projectId,name:`btcc-recovery-${Date.now()}`}),cache:"no-store",signal:AbortSignal.timeout(15000)});
  if(!cr.ok)throw new Error(`context ${cr.status}`); const context=await cr.json() as {id?:string}; if(!context.id)throw new Error("context id missing");
  const sr=await fetch("https://api.browserbase.com/v1/sessions",{method:"POST",headers,body:JSON.stringify({projectId,timeout:900,browserSettings:{context:{id:context.id,persist:true},viewport:{width:390,height:844}},userMetadata:{purpose:"btcc-recovery"}}),cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!sr.ok){const txt=await sr.text().catch(()=>"");throw new Error(`session ${sr.status} ${txt.slice(0,240)}`)}
  const s=await sr.json() as {id?:string;connectUrl?:string}; if(!s.id||!s.connectUrl)throw new Error("session details missing");
  const cdp=new Cdp(s.connectUrl); await cdp.open();
  try{
    const page=await cdp.page(); await cdp.send("Page.navigate",{url:LOGIN},page); await new Promise(r=>setTimeout(r,3000));
    const expr=`(()=>{const set=(el,v)=>{const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el),'value');d?.set?d.set.call(el,v):el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}))};const ins=[...document.querySelectorAll('input')];const e=ins.find(i=>/email|user|account/i.test((i.placeholder||'')+' '+(i.name||'')+' '+(i.type||'')))||ins.find(i=>i.type==='text'||i.type==='email');const p=ins.find(i=>i.type==='password');if(e)set(e,${JSON.stringify(username)});if(p)set(p,${JSON.stringify(password)});const bs=[...document.querySelectorAll('button,[role=button]')];const b=bs.find(x=>/^log\\s*in$/i.test((x.textContent||'').trim())||/^login$/i.test((x.textContent||'').trim()));if(b)b.click();return{email:!!e,password:!!p,login:!!b}})()`;
    const fill=await cdp.send("Runtime.evaluate",{expression:expr,returnByValue:true},page); await new Promise(r=>setTimeout(r,8000));
    const state=await cdp.send("Runtime.evaluate",{expression:`({url:location.href,text:(document.body?.innerText||'').slice(0,4500)})`,returnByValue:true},page); const v=state.result?.value||{};
    const signedIn=typeof v.url==="string"&&v.url.includes("btcc.com")&&!v.url.includes("/login"); let copy:any=null;
    if(signedIn){await cdp.send("Page.navigate",{url:COPY},page);await new Promise(r=>setTimeout(r,3500));const q=await cdp.send("Runtime.evaluate",{expression:`({url:location.href,text:(document.body?.innerText||'').slice(0,6000)})`,returnByValue:true},page);copy=q.result?.value||null;}
    return {ok:true,signedIn,contextId:context.id,sessionId:s.id,fill:fill.result?.value||null,page:{url:v.url||null,text:String(v.text||"").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g,"[redacted-email]")},copy:copy?{url:copy.url||null,text:String(copy.text||"").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/g,"[redacted-email]")}:null};
  }finally{cdp.close();}
}

export async function GET(){try{return NextResponse.json(await execute(),{headers:{"cache-control":"no-store"}})}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"recovery failed"},{status:500,headers:{"cache-control":"no-store"}})}}
