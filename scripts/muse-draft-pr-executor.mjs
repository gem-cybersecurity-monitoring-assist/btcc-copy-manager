/** GEM Muse constrained code-proposal publisher. No merge or deploy actions. */
import { createHash } from "node:crypto";
const TARGET="gem-cybersecurity-monitoring-assist/btcc-copy-manager";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE=/^scripts\/muse-proposals\/[a-z][a-z0-9-]{2,64}\.mjs$/;
const SENSITIVE=/(?:github_pat_[\w]{12,}|gh[pousr]_[\w]{12,}|sk-[\w-]{15,}|-----BEGIN [^-]+ PRIVATE KEY-----)/i;
function demand(ok,code){if(!ok)throw new Error(code)}
export function validateMuseProposal(p){
 demand(p&&typeof p==="object"&&!Array.isArray(p),"invalid_proposal");
 demand(p.repository===TARGET,"repository_not_allowed");
 demand(typeof p.taskId==="string"&&ID.test(p.taskId),"invalid_task_id");
 demand(typeof p.path==="string"&&FILE.test(p.path)&&!p.path.includes(".."),"path_not_allowed");
 demand(typeof p.content==="string"&&p.content.length>0&&Buffer.byteLength(p.content)<=12000,"invalid_content_size");
 demand(!SENSITIVE.test(p.content),"credential_shaped_content");
 demand(!p.content.includes("\0"),"nul_character_forbidden");
 const taskId=p.taskId.toLowerCase(),hash=createHash("sha256").update(p.content,"utf8").digest("hex");
 return Object.freeze({repository:TARGET,taskId,path:p.path,contentHash:hash,branch:"muse/proposal-"+taskId});
}
function validApproval(a,p){return a?.authorized===true&&a.repository===p.repository&&a.taskId===p.taskId&&a.path===p.path&&a.contentHash===p.contentHash&&/^[a-zA-Z0-9_-]{8,100}$/.test(a.approvalId||"")}
async function github(fetchImpl,token,method,path,data){
 const r=await fetchImpl("https://api.github.com/repos/"+TARGET+"/"+path,{method,headers:{accept:"application/vnd.github+json",authorization:"Bearer "+token,"x-github-api-version":"2022-11-28","user-agent":"gem-muse-draft-pr/1.0",...(data?{"content-type":"application/json"}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(12000),redirect:"error"});
 if(!r.ok)throw new Error("github_"+method.toLowerCase()+"_"+r.status);
 return await r.json();
}
export async function publishMuseDraftPR({proposal,token,verifyApproval,fetchImpl=fetch,dryRun=true}={}){
 const p=validateMuseProposal(proposal);
 if(dryRun)return {...p,mode:"dry_run",requiresVerifiedApproval:true,pullRequestCreated:false};
 demand(typeof token==="string"&&token.length>=12,"github_access_unconfigured");
 demand(typeof verifyApproval==="function","approval_verifier_unconfigured");
 // This callback MUST validate a server-side signed owner approval. Client booleans are not valid approval.
 const approval=await verifyApproval({...p});demand(validApproval(approval,p),"owner_approval_not_verified");
 const base=await github(fetchImpl,token,"GET","branches/main");
 demand(/^[a-f0-9]{40}$/.test(base.commit?.sha||""),"base_commit_invalid");
 await github(fetchImpl,token,"POST","git/refs",{ref:"refs/heads/"+p.branch,sha:base.commit.sha});
 const file=await github(fetchImpl,token,"PUT","contents/"+p.path,{message:"muse: propose code for "+p.taskId,content:Buffer.from(proposal.content,"utf8").toString("base64"),branch:p.branch});
 demand(typeof file.commit?.sha==="string","change_commit_unverified");
 const pr=await github(fetchImpl,token,"POST","pulls",{title:"GEM Muse code proposal "+p.taskId.slice(0,8),head:p.branch,base:"main",draft:true,maintainer_can_modify:false,body:"Owner approval: "+approval.approvalId+"\n\nIsolated file: "+p.path+"\nSHA-256: "+p.contentHash+"\n\nDraft only. No merge, deploy, or money movement."});
 demand(pr.draft===true&&typeof pr.html_url==="string","draft_pr_not_confirmed");
 return {mode:"draft_pr",taskId:p.taskId,url:pr.html_url,path:p.path,branch:p.branch,contentHash:p.contentHash,draft:true,merged:false,deployed:false};
}
