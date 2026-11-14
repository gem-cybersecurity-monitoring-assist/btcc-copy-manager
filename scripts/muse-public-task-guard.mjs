/** Public task intake: fail-closed, single-purpose code proof. Never store secret tasks in GitHub. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPO="gem-cybersecurity-monitoring-assist/btcc-copy-manager";
const TOKEN=/(github_pat_[A-Za-z0-9_]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|sk-[A-Za-z0-9_-]{15,}|-----BEGIN [^-]+ PRIVATE KEY-----|bearer\s+[a-z0-9._-]{15,})/i;
export function validateMusePublicTask(input) {
  if(!input||typeof input!=="object"||Array.isArray(input))throw Error("invalid_task");
  const allowed=["version","taskId","repository","kind","instruction"].sort();
  if(JSON.stringify(Object.keys(input).sort())!==JSON.stringify(allowed))throw Error("invalid_task_fields");
  if(input.version!==1||input.repository!==REPO||!["add_function","clamp_function"].includes(input.kind))throw Error("task_not_allowlisted");
  if(typeof input.taskId!=="string"||!UUID.test(input.taskId))throw Error("invalid_task_id");
  if(typeof input.instruction!=="string"||input.instruction.length<15||input.instruction.length>400||input.instruction.includes("\0")||TOKEN.test(input.instruction))throw Error("unsafe_instruction");
  const id=input.taskId.toLowerCase();
  return Object.freeze({id,repository:REPO,kind:input.kind,instruction:input.instruction.trim(),branch:"muse/ai-task-"+id.slice(0,8)+"-20261114",path:"scripts/muse-proposals/ai-task-"+id.slice(0,8)+".mjs"});
}
