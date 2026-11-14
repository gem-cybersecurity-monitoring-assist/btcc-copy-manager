import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync,statSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {museContainerArgs,verifyMuseInContainer} from "../scripts/muse-container-proof.mjs";
function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),"muse-container-test-"));
 try{mkdirSync(join(dir,".muse-task"));writeFileSync(join(dir,".muse-task/verified.mjs"),"function add(a,b){return a+b;}\n",{mode:0o600});return fn(dir)}
 finally{rmSync(dir,{recursive:true,force:true})}
}
test("pins network-disabled, read-only and non-root container settings",()=>fixture(cwd=>{
 const args=museContainerArgs({cwd});
 for(const a of ["--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges","--pids-limit","--memory","256m","--user","65534:65534","--entrypoint","node"])assert(args.includes(a));
 assert(args.some(x=>x.includes("dst=/mnt/generated.mjs,readonly")));
}));
test("fails closed for paths outside verified artifact",()=>fixture(cwd=>assert.throws(()=>museContainerArgs({cwd,file:"../secrets.env"}),/not_allowlisted/)));
test("executes only Docker and removes inherited secrets from the container runtime",()=>fixture(cwd=>{
 let calls=0;
 const result=verifyMuseInContainer({cwd,execImpl:(cmd,args,opts)=>{calls++;assert.equal(cmd,"docker");assert.equal(opts.env.HOME,"/tmp");assert(!Object.hasOwn(opts.env,"GITHUB_TOKEN"));assert(!Object.hasOwn(opts.env,"DATABASE_URL"));assert(args.includes("--read-only"));return Buffer.from("OK");}});
 assert.equal(calls,1);assert.equal(result.verified,true);assert.equal(result.network,"disabled");
 assert.equal(statSync(join(cwd,".muse-task/verified.mjs")).mode&0o777,0o444);
}));
test("does not modify the model source contents",()=>fixture(cwd=>{
 const path=join(cwd,".muse-task/verified.mjs"),before=readFileSync(path,"utf8");
 verifyMuseInContainer({cwd,execImpl:()=>Buffer.from("passed")});
 assert.equal(readFileSync(path,"utf8"),before);
}));


test("clamp task enforces independent boundary checks in the Docker program",()=>fixture(cwd=>{
 const args=museContainerArgs({cwd,kind:"clamp_function"});
 const program=args[args.length-1];
 assert(program.includes("clamp"));assert(program.includes("f(-5,0,10)"));
 assert(!program.includes("require('node:child_process')"));
}));
test("rejects unsupported kinds before invoking Docker",()=>fixture(cwd=>{
 assert.throws(()=>museContainerArgs({cwd,kind:"arbitrary_code"}),/not_allowed/);
}));
