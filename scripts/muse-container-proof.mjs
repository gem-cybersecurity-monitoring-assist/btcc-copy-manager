/** Network-disabled Docker evaluation of an already allowlisted small Muse model output.
 * Not a general-purpose sandbox for arbitrary model code; source is separately filtered.
 */
import {execFileSync} from "node:child_process";
import {lstatSync,realpathSync,chmodSync,readFileSync} from "node:fs";
import {resolve} from "node:path";
import {validateMusePublicTask} from "./muse-public-task-guard.mjs";
const DEFAULT_FILE=".muse-task/verified.mjs";
const SPECS=Object.freeze({
 add_function:Object.freeze({
  fn:"add",
  checks:"if(typeof f!=='function'||f(2,3)!==5||f(-7,2)!==-5||f(0,0)!==0)process.exit(3);"
 }),
 clamp_function:Object.freeze({
  fn:"clamp",
  checks:"if(typeof f!=='function'||f(-5,0,10)!==0||f(12,0,10)!==10||f(4,0,10)!==4||f(10,10,10)!==10)process.exit(3);"
 })
});
function buildProgram(kind){
 const spec=SPECS[kind];
 if(!spec)throw Error("container_task_kind_not_allowed");
 return [
  "const fs=require('node:fs');",
  "const vm=require('node:vm');",
  "const s=fs.readFileSync('/mnt/generated.mjs','utf8').replace(/^export\\s+/,'');",
  "const f=new vm.Script(s+';"+spec.fn+";').runInNewContext(Object.create(null),{timeout:400});",
  spec.checks,
  "console.log('GEM Muse container: model-derived "+spec.fn+" function passed isolated tests');"
 ].join("");
}
export function museContainerArgs({cwd=process.cwd(),file=DEFAULT_FILE,kind="add_function"}={}){
 if(file!==DEFAULT_FILE)throw Error("file_path_not_allowlisted");
 const program=buildProgram(kind);
 const p=resolve(cwd,file),stat=lstatSync(p);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<15||stat.size>12000)throw Error("invalid_model_artifact");
 const real=realpathSync(p);
 if(real!==p)throw Error("symlink_not_allowed");
 return ["run","--rm","--network","none","--read-only","--pids-limit","64","--memory","256m","--cpus","1",
  "--cap-drop","ALL","--security-opt","no-new-privileges","--user","65534:65534",
  "--tmpfs","/tmp:rw,nosuid,size=32m",
  "--mount","type=bind,src="+real+",dst=/mnt/generated.mjs,readonly",
  "--workdir","/tmp","--entrypoint","node","node:24-alpine","-e",program];
}
export function verifyMuseInContainer({cwd=process.cwd(),execImpl=execFileSync,kind="add_function"}={}){
 const file=resolve(cwd,DEFAULT_FILE);
 const args=museContainerArgs({cwd,kind});
 chmodSync(file,0o444);
 const result=execImpl("docker",args,{cwd,timeout:120000,maxBuffer:16000,env:{PATH:process.env.PATH||"/usr/bin:/bin",HOME:"/tmp"}});
 return {verified:true,kind,network:"disabled",filesystem:"read_only",sourceMount:"read_only",
  modelOutputEvaluated:true,stdout:String(result).slice(0,400)};
}
if(import.meta.url==="file://"+process.argv[1]){
 const raw=JSON.parse(readFileSync(DEFAULT_FILE.replace("verified.mjs","request.json"),"utf8"));
 const task=validateMusePublicTask(raw);
 const result=verifyMuseInContainer({kind:task.kind});
 process.stdout.write(JSON.stringify(result)+"\n");
}
