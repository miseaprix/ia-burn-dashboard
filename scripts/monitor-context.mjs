import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const run=promisify(execFile);
const metadata=v=>typeof v==='string' && v.length<=256 && !/[\x00-\x1f\x7f]/.test(v) ? v : undefined;

// Inspect repository metadata only; never run shell text or read transcripts.
export async function monitorContext(body,env=process.env) {
  const cwd=typeof body.cwd==='string' && path.isAbsolute(body.cwd) ? body.cwd : null;
  async function git(args) {
    if(!cwd)return '';
    try {return (await run('git',['-C',cwd,...args],{timeout:300,maxBuffer:8192,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}})).stdout.trim();}
    catch{return '';}
  }
  const [root,branchValue]=await Promise.all([git(['rev-parse','--show-toplevel']),git(['symbolic-ref','--quiet','--short','HEAD'])]);
  const branch=metadata(branchValue) || undefined;
  const tickets=[...new Set((branch || '').match(/\b[A-Z][A-Z0-9]+-\d+\b/g) || [])];
  return {
    project:metadata(env.BURN_MONITOR_PROJECT) || metadata(body.project) || (cwd ? metadata(path.basename(root || cwd)) : undefined),
    branch:metadata(body.branch) || branch,
    ticket:metadata(env.BURN_MONITOR_TICKET) || metadata(body.ticket) || (tickets.length===1 ? tickets[0] : undefined),
    skill_name:metadata(body.skill_name) || (body.tool_name==='Skill' ? metadata(body.tool_input?.skill) : undefined),
    workflow_name:metadata(env.BURN_MONITOR_WORKFLOW) || metadata(body.workflow_name),
    workflow_run_id:metadata(env.BURN_MONITOR_WORKFLOW_RUN_ID) || metadata(body.workflow_run_id)
  };
}
