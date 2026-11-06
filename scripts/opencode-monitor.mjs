import {randomUUID} from 'node:crypto';
import {prepareMonitorPayload,sendMonitorPayload,monitorEndpoint} from './monitor-client.mjs';
import {normalizeMonitorEvent} from '../backend/src/domain/monitor-event.js';

// OpenCode 2.0.25 API. No startup enumeration, transcript or message reads.
export async function setupOpenCodeMonitor(ctx,{send=sendMonitorPayload}={}) {
  const options=ctx.options || {},enabled=new Set(options.datasets || []);
  const endpoint=monitorEndpoint(options.url).href;
  const providers=options.providers || {personal:['openai','chatgpt','anthropic','opencode','opencode-go','github-copilot','openrouter'],enterprise:(process.env.ENTERPRISE_OPENCODE_PROVIDERS || '').split(',').map(s=>s.trim()).filter(Boolean)};
  const controller=new AbortController(),registrations=[],seen=new Map();
  let pending=0;
  const remember=(id,value)=>{seen.set(id,value);if(seen.size>4096)seen.delete(seen.keys().next().value);};
  function datasetFor(provider) {
    const matches=['personal','enterprise'].filter(d=>Array.isArray(providers[d]) && providers[d].includes(provider));
    return matches.length===1 && enabled.has(matches[0]) ? matches[0] : null;
  }
  async function emit(body,info) {
    if(controller.signal.aborted)return;
    const session=info || (body.type==='SessionEnd' ? seen.get(body.session_id)?.info : await ctx.session.get({sessionID:body.session_id}));
    if(!session)return;
    const directory=session.location?.directory;
    if(!directory || directory!==ctx.location.directory)return;
    const dataset=datasetFor(session.model?.providerID);
    if(!dataset)return; // Unknown/disabled providers are never silently labelled personal.
    const previous=seen.get(session.id),mixed=previous?.mixed || !!previous && previous.dataset!==dataset;
    const safeInfo={id:session.id,model:{providerID:session.model.providerID,id:session.model.id},location:{directory},parentID:session.parentID,agent:session.agent};
    remember(session.id,{dataset,mixed,info:safeInfo,infos:{...previous?.infos,[dataset]:safeInfo}});
    if(body.type==='Usage' && mixed)return; // Cumulative snapshots cannot split mixed environments.
    const payload=await prepareMonitorPayload({...body,cwd:directory,
      ...(body.usage_snapshot ? {usage_snapshot:{...body.usage_snapshot,model:session.model.id}} : {}),
      ...(session.parentID ? {agent_id:session.id} : {})},
      {harness:'opencode',dataset,context:true,machine:options.machine});
    if(!controller.signal.aborted)await send(payload,endpoint);
  }
  function schedule(body,info) {
    if(pending>=128 || controller.signal.aborted)return;
    pending++;
    // Raw arguments/results never enter the asynchronous queue.
    void emit(body,info).catch(()=>{}).finally(()=>pending--);
  }
  function tool(event,type) {
    try {
      const name=event.tool==='bash' ? 'Bash' : event.tool;
      const {event:safe}=normalizeMonitorEvent({schema_version:1,harness:'opencode',dataset:'unclassified',machine_id:'local',
        event_id:randomUUID(),session_id:event.sessionID,type,tool_name:name,tool_use_id:event.id,tool_input:event.input});
      schedule({session_id:event.sessionID,event_id:randomUUID(),type,tool_name:name,tool_use_id:event.id,
        command_name:safe.command,script_name:safe.script,is_error:event.status==='error'});
    } catch {}
  }
  registrations.push(await ctx.tool.hook('execute.before',e=>tool(e,'PreToolUse')));
  registrations.push(await ctx.tool.hook('execute.after',e=>tool(e,e.status==='error' ? 'PostToolUseFailure' : 'PostToolUse')));
  registrations.push(await ctx.session.hook('prompt',e=>schedule({session_id:e.sessionID,type:'UserPromptSubmit',event_id:`prompt:${e.messageID}`})));

  // Public stream is live-only, no cursor/replay or old database import.
  const listening=(async()=>{
    try {
      for await(const native of ctx.event.subscribe({signal:controller.signal})) {
        const data=native.data;
        if(!data?.sessionID || native.location && native.location.directory!==ctx.location.directory)continue;
        const base={session_id:data.sessionID,event_id:native.id || randomUUID(),timestamp:new Date(native.created).toISOString()};
        if(native.type==='session.created') {
          schedule({...base,type:'SessionStart'},{id:data.sessionID,location:data.location,model:data.model,parentID:data.parentID,agent:data.agent});
          if(data.parentID)schedule({...base,event_id:`agent:${base.event_id}`,session_id:data.parentID,type:'SubagentStart',agent_id:data.sessionID,agent_type:data.agent});
        } else if(native.type==='session.deleted') {
          for(const info of Object.values(seen.get(data.sessionID)?.infos || {}))schedule({...base,type:'SessionEnd'},info);
        }
        else if(native.type==='session.execution.succeeded' || native.type==='session.execution.failed') {
          schedule({...base,type:'Stop',is_error:native.type.endsWith('failed')});
          const child=seen.get(data.sessionID)?.info;
          if(child?.parentID)schedule({...base,event_id:`agent:${base.event_id}`,session_id:child.parentID,type:'SubagentStop',agent_id:child.id,agent_type:child.agent});
        }
        else if(native.type==='session.execution.interrupted')schedule({...base,type:'Interrupt',interrupted:true});
        else if(native.type==='session.skill.activated')schedule({...base,type:'PostToolUse',tool_name:'Skill',tool_use_id:`skill:${base.event_id}`,skill_name:data.name});
        else if(native.type==='session.shell.started' || native.type==='session.shell.ended') {
          const shell=data.shell;
          if(shell?.id) {
            try {
              const {event:safe}=normalizeMonitorEvent({schema_version:1,harness:'opencode',dataset:'unclassified',machine_id:'local',event_id:base.event_id,
                session_id:base.session_id,type:'PreToolUse',tool_name:'Bash',tool_input:{command:shell.command}});
              const failed=Number.isSafeInteger(shell.exit) && shell.exit!==0;
              schedule({...base,type:native.type.endsWith('started') ? 'PreToolUse' : failed ? 'PostToolUseFailure' : 'PostToolUse',tool_name:'Bash',tool_use_id:`shell:${shell.id}`,command_name:safe.command,script_name:safe.script,exit_code:shell.exit,is_error:failed});
            } catch {}
          }
        }
        else if(native.type==='session.usage.updated') {
          const u=data.tokens;
          const output=Number.isSafeInteger(u?.output) && Number.isSafeInteger(u?.reasoning) ? u.output+u.reasoning : null;
          if(u)schedule({...base,type:'Usage',usage_snapshot:{usage:{input_tokens:u.input,output_tokens:output,
            cache_read_input_tokens:u.cache?.read,cache_creation_input_tokens:u.cache?.write}}});
        }
      }
    } catch {} // Server disconnect/unload does not affect native operations.
  })();
  return async()=>{
    controller.abort();
    await Promise.allSettled(registrations.map(r=>r.dispose()));
    await Promise.race([listening,new Promise(resolve=>setTimeout(resolve,100))]);
  };
}
