import {randomUUID} from 'node:crypto';
import {hostname} from 'node:os';
import {normalizeMonitorEvent} from '../backend/src/domain/monitor-event.js';
import {monitorContext} from './monitor-context.mjs';

export function monitorEndpoint(url='http://localhost:4095/api/monitor/events') {
  const endpoint=new URL(url);
  if(endpoint.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname!=='/api/monitor/events')throw new Error('Use a local HTTP event receiver');
  return endpoint;
}
export async function prepareMonitorPayload(body,{harness,dataset,machine=hostname(),context=false,env=process.env}={}) {
  const extra=context ? await monitorContext(body,env) : {};
  const {event,usage,id}=normalizeMonitorEvent({...body,...extra,schema_version:1,harness,dataset,machine_id:machine,
    event_id:body.event_id || randomUUID(),timestamp:body.timestamp || body.logged_at || new Date().toISOString()});
  const snapshot=usage ? {model:usage.model,usage:{input_tokens:usage.input,output_tokens:usage.output,
    cache_creation_input_tokens:usage.cacheWrite,cache_read_input_tokens:usage.cacheRead}} : undefined;
  return {schema_version:1,event_id:id,harness,dataset,session_id:event.sessionId,machine_id:event.machine,
    timestamp:event.timestamp,type:event.type,hostname:event.hostname,project:event.project,branch:event.branch,ticket:event.ticket,
    request_id:event.requestId,client_request_id:event.clientRequestId,
    tool_name:event.tool,tool_use_id:event.toolUseId,parent_tool_use_id:event.parentToolUseId,agent_type:event.agent,
    skill_name:event.skill,workflow_name:event.workflow,workflow_run_id:event.workflowRunId,
    agent_id:event.agentId,subagent_model:event.subagentModel,fork_origin:event.forkOrigin,cli_name:event.cli,
    command_name:event.command,script_name:event.script,mcp_server:event.mcpServer,mcp_tool_name:event.mcpTool,is_mcp:event.isMcp,
    exit_code:event.exitCode,interrupted:event.interrupted,is_error:event.isError,
    ...(snapshot ? usage.final ? {final_usage:snapshot} : {usage_snapshot:snapshot} : {})};
}
export async function sendMonitorPayload(payload,url) {
  const endpoint=monitorEndpoint(url);
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(1000)});
      if(response.ok)return true;
      if(response.status<500)return false;
    } catch {}
  }
  return false;
}
