import { createHash } from 'node:crypto';
const HARNESS = new Set(['claude','codex','opencode']);
const DATASETS = new Set(['personal','enterprise','unclassified']);
// Legacy collectors still send the former dataset id.
const LEGACY_DATASETS = {accorgpt:'enterprise'};
const KINDS = new Set(['SessionStart','SessionEnd','PreToolUse','PostToolUse','PostToolUseFailure','Stop','Notification','UserPromptSubmit','SubagentStart','SubagentStop','Usage','Interrupt','PreCompact','PostCompact']);
function string(v, max=256) {
  if (v == null || v === '') return null;
  if (typeof v !== 'string' || v.length>max) throw new Error('Invalid metadata');
  return v;
}
function timestamp(v, fallback) {
  if (v == null) return new Date(fallback).toISOString();
  if (typeof v !== 'string' || !/Z$|[+-]\d{2}:\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))) throw new Error('Invalid timestamp');
  return new Date(v).toISOString();
}
function tokens(v) {
  if (v == null) return null;
  if (!Number.isSafeInteger(v) || v<0) throw new Error('Invalid tokens');
  return v;
}
function usageReading(snapshot, final, at) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const u=snapshot.usage;
  if (!u || typeof u !== 'object') return null;
  const result={model:string(snapshot.model),input:tokens(u.input_tokens),output:tokens(u.output_tokens),
    cacheWrite:tokens(u.cache_creation_input_tokens),cacheRead:tokens(u.cache_read_input_tokens),final,measuredAt:at};
  const values=[result.input,result.output,result.cacheWrite,result.cacheRead];
  result.tokens=values.every(v=>v!==null) ? values.reduce((a,b)=>a+b,0) : null;
  if (result.tokens!==null && !Number.isSafeInteger(result.tokens)) throw new Error('Token count too large');
  return result;
}
// Identify only a plain executable/script name; never retain shell arguments.
function commandIdentity(body) {
  const simple=v=>typeof v==='string' && /^[A-Za-z0-9_@./:+-]{1,256}$/.test(v) ? v.split(/[\\/]/).at(-1) : null;
  const raw=body.tool_name==='Bash' && typeof body.tool_input?.command==='string' ? body.tool_input.command.trim() : '';
  const parts=raw.split(/\s+/),command=simple(body.command_name) || simple(parts[0]);
  let script=simple(body.script_name);
  if (!script && /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1)$/.test(parts[0] || '')) script=simple(parts[0]);
  if (!script && /^(bash|sh|zsh|python[0-9.]*|node|bun|pwsh|powershell)$/.test(command || '') && /\.(sh|bash|zsh|py|js|mjs|cjs|ts|ps1)$/.test(parts[1] || '')) script=simple(parts[1]);
  return {command,script};
}
// Shared protocol; Claude's existing /api/hook payload is one adapter into it.
export function normalizeMonitorEvent(body, {legacy=false,now=Date.now()}={}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid event');
  if (!legacy && body.schema_version!==1) throw new Error('Unsupported event schema');
  const harness=legacy ? (body.harness || 'claude') : body.harness;
  const dataset=LEGACY_DATASETS[body.dataset] || body.dataset || (legacy ? 'unclassified' : null);
  if (!HARNESS.has(harness) || !DATASETS.has(dataset)) throw new Error('Specify harness and dataset');
  const sessionId=string(body.session_id),machine=string(body.machine_id),kind=string(body.hook_event_name || body.type);
  if (!sessionId || !KINDS.has(kind) || !legacy && !machine) throw new Error('Specify session, machine and event type');
  const source=JSON.stringify([harness,dataset,machine || 'unknown-machine']);
  const at=timestamp(body.timestamp || body.logged_at,now);
  const final=!!body.final_usage || body.usage?.final===true;
  const usage=usageReading(body.final_usage || body.usage_snapshot || body.usage,final,at);
  const explicitId=string(body.event_id || (!legacy ? body.id : null));
  if (!legacy && !explicitId) throw new Error('Specify a stable event_id');
  const command=commandIdentity(body);
  const mcpParts=typeof body.tool_name==='string' && body.tool_name.startsWith('mcp__') ? body.tool_name.slice(5).split('__') : [];
  const event={harness,dataset,sessionId,machine,hostname:string(body.hostname),type:kind,timestamp:at,
    requestId:string(body.request_id),clientRequestId:string(body.client_request_id),
    project:string(body.project,1000),branch:string(body.branch),ticket:string(body.ticket),
    tool:string(body.tool_name),toolUseId:string(body.tool_use_id),parentToolUseId:string(body.parent_tool_use_id),
    agent:string(body.agent_type),agentId:string(body.agent_id),subagentModel:string(body.subagent_model),forkOrigin:string(body.fork_origin),
    skill:string(body.skill_name),workflow:string(body.workflow_name || body.active_workflow),workflowRunId:string(body.workflow_run_id),
    cli:string(body.cli_name),command:command.command,script:command.script,
    mcpServer:string(body.mcp_server) || mcpParts[0] || null,mcpTool:string(body.mcp_tool_name) || mcpParts.slice(1).join('__') || null,
    isMcp:body.is_mcp===true || mcpParts.length>0,exitCode:Number.isSafeInteger(body.exit_code) ? body.exit_code : null,interrupted:typeof body.interrupted==='boolean' ? body.interrupted : null,
    isError:typeof body.is_error==='boolean' ? body.is_error : null};
  // Legacy hooks do not provide an event ID. Tool events have stable tool IDs;
  // other legacy events use a best-effort metadata/snapshot fingerprint.
  const fingerprint={...event,timestamp:body.timestamp || body.logged_at || null,usage:usage ? {...usage,measuredAt:null} : null};
  const id=explicitId || createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
  event.signature=createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex');
  event.usageScope=event.agentId || kind.startsWith('Subagent') ? 'agent' : 'session';
  if (usage) event.usageSnapshot=usage;
  return {source,id,event,usage};
}
