import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const STEEL_API = "https://api.steel.dev/v1";
const STEEL_CDP = "wss://connect.steel.dev";
const LOGIN = "https://www.btcc.com/en-US/login?redirect=%2Fuser-center%2Fassets";

function need(name:string){const v=process.env[name]?.trim();if(!v)throw new Error(`${name} missing`);return v;}
type Pending={resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>};
class Cdp{
  ws:WebSocket;seq=0;pending=new Map<number,Pending>();events:any[]=[];
  constructor(sessionId:string){this.ws=new WebSocket(`${STEEL_CDP}?apiKey=${encodeURIComponent(need("STEEL_API_KEY"))}&sessionId=${encodeURIComponent(sessionId)}`)}
  async open(){await new Promise<void>((resolve,reject)=>{const t=setTimeout(()=>reject(new Error("cdp timeout")),10000);this.ws.addEventListener("open",()=>{clearTimeout(t);resolve()},{once:true});this.ws.addEventListener("error",()=>{clearTimeout(t);reject(new Error("cdp open failed"))},{once:true})});this.ws.addEventListener("message",e=>{if(typeof e.data!=="string")return;let m:any;try{m=JSON.parse(e.data)}catch{return}if(m.method==="Network.responseReceived"){const r=m.params?.response;const u=String(r?.url||"");if(/btcc|btlogin|login/i.test(u))this.events.push({url:u.replace(/[?#].*$/,""),status:r?.status,mime:r?.mimeType})}if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;this.pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(new Error(m.error.message||"cdp error")):p.resolve(m.result)})}
  send(method:string,params:Record<string,unknown>={},sessionId?:string,timeout=15000){const id=++this.seq;return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${method} timeout`))},timeout);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}))})}
  async page(){const ts=await this.send("Target.getTargets");let targetId=ts.targetInfos?.find((t:any)=>t.type==="page")?.targetId;if(!targetId)targetId=(await this.send("Target.createTarget",{url:"about:blank"})).targetId;const a=await this.send("Target.attachToTarget",{targetId,flatten:true});await this.send("Page.enable",{},a.sessionId);await this.send("Runtime.enable",{},a.sessionId);await this.send("Network.enable",{},a.sessionId);return a.sessionId as string}
  close(){try{this.ws.close()}catch{}}
}
async function run(){
  const apiKey=need("STEEL_API_KEY"), email=need("BTCC_USERNAME"), password=need("BTCC_PASSWORD");
  const created=await fetch(`${STEEL_API}/sessions`,{method:"POST",headers:{"content-type":"application/json","steel-api-key":apiKey},body:JSON.stringify({timeout:600000,blockAds:true,persistProfile:true,deviceConfig:{device:"mobile"}}),cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!created.ok){const text=await created.text().catch(()=>"");throw new Error(`steel ${created.status} ${text.slice(0,160)}`)}
  const s=await created.json() as {id?:string};if(!s.id)throw new Error("no session id");
  const c=new Cdp(s.id);await c.open();
  try{
    const p=await c.page();await c.send("Page.navigate",{url:LOGIN},p);await new Promise(r=>setTimeout(r,3000));
    const meta=await c.send("Runtime.evaluate",{expression:`(()=>{const ins=[...document.querySelectorAll('input')];const e=ins.find(i=>i.type==='email'||/email/i.test(i.placeholder||''))||ins.find(i=>i.type==='text');const pw=ins.find(i=>i.type==='password');const b=[...document.querySelectorAll('button')].find(x=>/login/i.test((x.textContent||'').trim())&&x.type==='submit')||[...document.querySelectorAll('button')].find(x=>/^login$/i.test((x.textContent||'').trim()));const rect=b?.getBoundingClientRect();return{e:!!e,p:!!pw,b:!!b,ex:e?e.getBoundingClientRect().x+e.getBoundingClientRect().width/2:null,ey:e?e.getBoundingClientRect().y+e.getBoundingClientRect().height/2:null,px:pw?pw.getBoundingClientRect().x+pw.getBoundingClientRect().width/2:null,py:pw?pw.getBoundingClientRect().y+pw.getBoundingClientRect().height/2:null,bx:rect?rect.x+rect.width/2:null,by:rect?rect.y+rect.height/2:null}})()`,returnByValue:true},p);const m=meta.result?.value||{};
    if(!m.e||!m.p||!m.b)throw new Error("login controls missing");
    for(const [x,y,text] of [[m.ex,m.ey,email],[m.px,m.py,password]] as Array<[number,number,string]>){await c.send("Input.dispatchMouseEvent",{type:"mousePressed",x,y,button:"left",clickCount:1},p);await c.send("Input.dispatchMouseEvent",{type:"mouseReleased",x,y,button:"left",clickCount:1},p);await c.send("Input.insertText",{text},p);await new Promise(r=>setTimeout(r,300));}
    await c.send("Input.dispatchMouseEvent",{type:"mousePressed",x:m.bx,y:m.by,button:"left",clickCount:1},p);await c.send("Input.dispatchMouseEvent",{type:"mouseReleased",x:m.bx,y:m.by,button:"left",clickCount:1},p);
    await new Promise(r=>setTimeout(r,10000));
    const state=await c.send("Runtime.evaluate",{expression:`(()=>{const t=(document.body?.innerText||'').slice(0,5000);return{url:location.href,text:t,html:(document.body?.innerHTML||'').slice(0,8000)}})()`,returnByValue:true},p);const v=state.result?.value||{};const text=String(v.text||"");
    return {ok:true,signedIn:typeof v.url==="string"&&v.url.includes("btcc.com")&&!v.url.includes("/login"),url:v.url||null,signals:{captcha:/captcha|geetest|verify you are human|slide/i.test(text),verification:/verification code|authenticator|2fa|security verification|send code/i.test(text),credentialError:/incorrect|wrong password|invalid password|account.*not found|login failed/i.test(text)},text:text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,"[redacted-email]").slice(0,2200),network:c.events.slice(-25)};
  }finally{c.close();fetch(`${STEEL_API}/sessions/${encodeURIComponent(s.id)}/release`,{method:"POST",headers:{"steel-api-key":apiKey},cache:"no-store"}).catch(()=>{})}
}
export async function GET(){try{return NextResponse.json(await run(),{headers:{"cache-control":"no-store"}})}catch(e){return NextResponse.json({ok:false,error:e instanceof Error?e.message:"failed"},{status:500,headers:{"cache-control":"no-store"}})}}
