/** Isolated execution of an ALREADY allowlisted small Muse model output.
 * Docker process is isolated from the GitHub token, host workspace write access and network.
 * This is not a guarantee of safe execution for arbitrary attacker-controlled programs. */
import {execFileSync} from "node:child_process";
import {lstatSync,realpathSync,chmodSync} from "node:fs";
import {resolve} from "node:path";
const DEFAULT_FILE=".muse-task/verified.mjs";
const PROGRAM=[
"const fs=require('node:fs');",
"const vm=require('node:vm');",
"const s=fs.readFileSync('/mnt/generated.mjs','utf8').replace(/^export\\s+/,'');",
"const f=new vm.Script(s+';add;').runInNewContext(Object.create(null),{timeout:400});",
"if(typeof f!=='function'||f(2,3)!==5||f(-7,2)!==-5||f(0,0)!==0)process.exit(3);",
"console.log('GEM Muse container: model-derived function passed isolated tests');"
].join("");

export function museContainerArgs({cwd=process.cwd(),file=DEFAULT_FILE}={}) {
 if(file!==DEFAULT_FILE)throw Error("file_path_not_allowlisted");
 const p=resolve(cwd,file),stat=lstatSync(p);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<15||stat.size>12000)throw Error("invalid_model_artifact");
 const real=realpathSync(p);
 if(real!==p)throw Error("symlink_not_allowed");
 return ["run","--rm","--network","none","--read-only","--pids-limit","64","--memory","256m","--cpus","1",
         "--cap-drop","ALL","--security-opt","no-new-privileges","--user","65534:65534",
         "--tmpfs","/tmp:rw,nosuid,size=32m",
         "--mount","type=bind,src="+real+",dst=/mnt/generated.mjs,readonly",
         "--workdir","/tmp","--entrypoint","node","node:24-alpine","-e",PROGRAM];
}
export function verifyMuseInContainer({cwd=process.cwd(),execImpl=execFileSync}={}){
 const file=resolve(cwd,DEFAULT_FILE);
 const args=museContainerArgs({cwd});
 chmodSync(file,0o444);
 const result=execImpl("docker",args,{cwd,timeout:120000,maxBuffer:16000,env:{PATH:process.env.PATH||"/usr/bin:/bin",HOME:"/tmp"}});
 return {verified:true,network:"disabled",filesystem:"read_only",sourceMount:"read_only",
         modelOutputEvaluated:true,stdout:String(result).slice(0,400)};
}
if(import.meta.url==="file://"+process.argv[1]){
 const result=verifyMuseInContainer();
 process.stdout.write(JSON.stringify(result)+"\n");
}
