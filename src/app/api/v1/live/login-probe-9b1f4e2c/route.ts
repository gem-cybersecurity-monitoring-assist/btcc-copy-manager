import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function need(name:string){const v=process.env[name]?.trim();if(!v)throw new Error(`${name} missing`);return v;}
function enc(v:string){return encodeURIComponent(v).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}
function sign(params:Record<string,string|number>, secret:string){const entries=[...Object.entries(params),["secret_key",secret] as [string,string]].sort(([a],[b])=>a<b?-1:a>b?1:0);const src=entries.map(([k,v])=>`${enc(k)}=${enc(String(v))}`).join("&");return createHash("md5").update(src,"utf8").digest("hex");}
async function attempt(base:string){const params={user_name:need("BTCC_USERNAME"),password:need("BTCC_PASSWORD"),company_id:1,api_key:need("BTCC_API_KEY")};const fields=new URLSearchParams({...Object.fromEntries(Object.entries(params).map(([k,v])=>[k,String(v)])),sign:sign(params,need("BTCC_SECRET_KEY"))});const started=Date.now();try{const r=await fetch(`${base}/v1/user/login`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:fields,cache:"no-store",signal:AbortSignal.timeout(12000)});const text=await r.text();let data:any={};try{data=JSON.parse(text)}catch{}return{base,status:r.status,ms:Date.now()-started,code:data.code??null,msg:typeof data.msg==="string"?data.msg.slice(0,180):null,tokenReturned:Boolean(data.token),accountReturned:Boolean(data.account)};}catch(e){return{base,status:null,ms:Date.now()-started,error:e instanceof Error?`${e.name}:${e.message}`:String(e)}}}
export async function GET(){try{return Response.json({results:await Promise.all([attempt("https://api1.btloginc.com"),attempt("https://api1.btloginc.com:9081")])},{headers:{"cache-control":"no-store"}})}catch(e){return Response.json({error:e instanceof Error?e.message:"probe failed"},{status:500,headers:{"cache-control":"no-store"}})}}
