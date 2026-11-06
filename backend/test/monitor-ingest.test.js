import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StateStore, closeStateStores } from '../src/storage/state-store.js';
import { ingestMonitor } from '../src/services/monitor-ingest.js';
import { buildApp } from '../src/app.js';

const event=(harness='claude',dataset='personal',extra={})=>({schema_version:1,harness,dataset,event_id:'demo-1',
  session_id:'same-session',machine_id:'demo-machine',type:'SessionStart',timestamp:'2026-01-01T10:00:00Z',project:'demo',...extra});
const usage=n=>({model:'demo-model',usage:{input_tokens:n,output_tokens:10,cache_creation_input_tokens:0,cache_read_input_tokens:20}});
test('hook collection isolates all harness/dataset pairs, retries and machines, without storing raw inputs',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-hook-')),store=new StateStore(path.join(dir,'burn.sqlite'));
  try {
    for (const h of ['claude','codex','opencode']) for (const d of ['personal','enterprise']) {
      assert.equal(ingestMonitor(event(h,d),{store}).duplicate,false);
      assert.equal(ingestMonitor(event(h,d),{store}).duplicate,true);
    }
    ingestMonitor(event('claude','personal',{machine_id:'other-machine'}),{store});
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM monitor_sessions').get().n,7);
    ingestMonitor(event('claude','personal',{event_id:'tool',type:'PostToolUse',tool_name:'Read',request_id:'proxy-exchange-1',client_request_id:'client-1',tool_input:{secret:'DO_NOT_STORE'},prompt:'DO_NOT_STORE',usage_snapshot:usage(100)}),{store});
    ingestMonitor(event('claude','personal',{event_id:'final',type:'Stop',timestamp:'2026-01-01T10:03:00Z',final_usage:usage(200)}),{store});
    ingestMonitor(event('claude','personal',{event_id:'late-provisional',type:'Usage',timestamp:'2026-01-01T10:04:00Z',usage_snapshot:usage(300)}),{store});
    ingestMonitor(event('claude','personal',{event_id:'older-final',type:'Stop',timestamp:'2026-01-01T10:02:00Z',final_usage:usage(150)}),{store});
    ingestMonitor(event('claude','personal',{event_id:'agent-usage',type:'SubagentStop',agent_id:'agent-demo',usage_snapshot:usage(900)}),{store});
    let s=JSON.parse(store.db.prepare("SELECT payload FROM monitor_sessions WHERE source=?").get(JSON.stringify(['claude','personal','demo-machine'])).payload);
    assert.equal(s.tokens,230);assert.equal(s.usage.final,true);assert.equal(s.endedAt,null);assert.deepEqual(s.tools,['Read']);
    assert.equal(store.db.prepare('SELECT payload FROM monitor_events').all().some(r=>r.payload.includes('DO_NOT_STORE')),false);
    const correlated=JSON.parse(store.db.prepare("SELECT payload FROM monitor_events WHERE id='tool'").get().payload);
    assert.equal(correlated.requestId,'proxy-exchange-1');
    assert.equal(correlated.clientRequestId,'client-1');
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM daily_usage').get().n,0);
    assert.throws(()=>ingestMonitor(event('claude','personal',{event_id:'invalid',usage_snapshot:usage(-1)}),{store}));
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM monitor_events').get().n,12);
    // Legacy compatibility does not guess the billing environment.
    const legacy={hook_event_name:'PreToolUse',session_id:'legacy',tool_use_id:'tool-legacy',tool_name:'Bash'};
    assert.equal(ingestMonitor(legacy,{store,legacy:true}).duplicate,false);
    assert.equal(ingestMonitor(legacy,{store,legacy:true}).duplicate,true);
    s=JSON.parse(store.db.prepare("SELECT payload FROM monitor_sessions WHERE id='legacy'").get().payload);
    assert.equal(s.dataset,'unclassified');assert.equal(s.tokens,null);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('local-only receiver is opt-in and persists across recreation, with read-only filtered queries',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-hook-api-'));
  const oldState=process.env.STATE_DIR,oldEnabled=process.env.MONITOR_INGEST_ENABLED;
  process.env.STATE_DIR=dir;process.env.MONITOR_INGEST_ENABLED='0';
  const collector={start(){},async stop(){},status(){return{};},intervals:{local:60000,personal:60000,enterprise:300000}};
  let app=await buildApp({collector});
  try {
    const send=(url,payload,host='localhost')=>app.inject({method:'POST',url,headers:{host},payload});
    assert.equal((await send('/api/monitor/events',event())).statusCode,503);
    process.env.MONITOR_INGEST_ENABLED='1';
    assert.equal((await send('/api/monitor/events',event(),'burn.example')).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/api/monitor/events',headers:{host:'localhost',origin:'https://other.example'},payload:event()})).statusCode,403);
    assert.equal((await send('/api/monitor/events',event())).statusCode,200);
    assert.equal((await send('/api/hook',{hook_event_name:'SessionStart',session_id:'legacy'})).statusCode,200);
    assert.equal((await send('/api/monitor/events',{...event(),dataset:'guess'})).statusCode,400);
    await app.close();app=await buildApp({collector});
    const query=await app.inject({url:'/api/monitor?project=demo&range=all',headers:{host:'localhost'}});
    assert.equal(query.statusCode,200);assert.equal(query.json().summary.sessions,1);
    assert.equal(query.json().summary.missingUsage,1);
    const source=encodeURIComponent(JSON.stringify(['claude','personal','demo-machine']));
    const detail=await app.inject({url:`/api/monitor/session?source=${source}&id=same-session`,headers:{host:'localhost'}});
    assert.equal(detail.statusCode,200);assert.equal(detail.json().totalEvents,1);
    assert.equal((await app.inject({url:'/api/monitor?range=custom&from=bad&to=bad',headers:{host:'localhost'}})).statusCode,400);
  } finally {
    await app.close();closeStateStores();
    if (oldState===undefined) delete process.env.STATE_DIR;else process.env.STATE_DIR=oldState;
    if (oldEnabled===undefined) delete process.env.MONITOR_INGEST_ENABLED;else process.env.MONITOR_INGEST_ENABLED=oldEnabled;
    rmSync(dir,{recursive:true,force:true});
  }
});

test('common sender filters raw contents before transport and retries with one stable ID',async()=>{
  const {createServer}=await import('node:http');
  const {spawn}=await import('node:child_process');
  const payloads=[];
  const server=createServer(async(req,res)=>{
    let raw='';for await(const part of req) raw+=part;
    payloads.push(JSON.parse(raw));res.statusCode=payloads.length===1 ? 503 : 200;res.end('{}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const child=spawn(process.execPath,[path.resolve(import.meta.dirname,'../../scripts/send-monitor-event.mjs')],{
      env:{...process.env,BURN_MONITOR_HARNESS:'codex',BURN_MONITOR_DATASET:'enterprise',BURN_MONITOR_MACHINE:'demo',
        BURN_MONITOR_URL:`http://127.0.0.1:${server.address().port}/api/monitor/events`},stdio:['pipe','pipe','pipe']});
    child.stdin.end(JSON.stringify({...event('codex','enterprise'),tool_input:{secret:'DO_NOT_SEND'},prompt:'DO_NOT_SEND',usage_snapshot:usage(10)}));
    const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.equal(exit,0);assert.equal(payloads.length,2);assert.equal(payloads[0].event_id,payloads[1].event_id);
    assert.equal(JSON.stringify(payloads).includes('DO_NOT_SEND'),false);
    assert.equal(payloads[0].harness,'codex');assert.equal(payloads[0].dataset,'enterprise');
    assert.equal(payloads[0].usage_snapshot.usage.input_tokens,10);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('monitoring dimensions count one invocation per lifecycle pair and omit Bash arguments',async()=>{
  const {monitorMetrics}=await import('../src/services/monitor-metrics.js');
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-dimensions-')),store=new StateStore(path.join(dir,'burn.sqlite'));
  try {
    const emit=(id,type,fields={})=>ingestMonitor(event('claude','enterprise',{event_id:id,type,...fields}),{store});
    emit('bash-pre','PreToolUse',{tool_use_id:'bash-call',tool_name:'Bash',cli_name:'node',tool_input:{command:'node scripts/demo.mjs --token DO_NOT_RETAIN'},workflow_name:'demo-workflow',workflow_run_id:'wf-demo'});
    emit('bash-post','PostToolUse',{tool_use_id:'bash-call',tool_name:'Bash',cli_name:'node',tool_input:{command:'node scripts/demo.mjs --token DO_NOT_RETAIN'},workflow_name:'demo-workflow',workflow_run_id:'wf-demo',exit_code:0});
    emit('mcp-pre','PreToolUse',{tool_use_id:'mcp-call',tool_name:'mcp__jira__search'});
    emit('mcp-post','PostToolUse',{tool_use_id:'mcp-call',tool_name:'mcp__jira__search',is_error:true});
    emit('skill-pre','PreToolUse',{tool_use_id:'skill-call',tool_name:'Skill',skill_name:'demo-skill'});
    emit('skill-post','PostToolUse',{tool_use_id:'skill-call',tool_name:'Skill',skill_name:'demo-skill'});
    emit('agent-start','SubagentStart',{agent_id:'agent-demo',agent_type:'demo-agent',parent_tool_use_id:'agent-call',workflow_name:'demo-workflow',workflow_run_id:'wf-demo'});
    emit('agent-stop','SubagentStop',{agent_id:'agent-demo',agent_type:'demo-agent',parent_tool_use_id:'agent-call'});
    emit('unpaired','PostToolUse',{tool_name:'Bash',tool_input:{command:'TOKEN=secret bash script.sh'}});
    const metrics=monitorMetrics(store.db);
    assert.equal(metrics.tools.find(r=>r.name==='Bash').calls,1);
    assert.equal(metrics.tools.find(r=>r.name==='mcp__jira__search').failed,1);
    assert.equal(metrics.cli[0].calls,1);assert.equal(metrics.commands[0].name,'node');
    assert.equal(metrics.scripts[0].name,'demo.mjs');assert.equal(metrics.scripts[0].calls,1);
    assert.equal(metrics.mcp[0].name,'jira / search');assert.equal(metrics.mcp[0].calls,1);
    assert.equal(metrics.skills[0].calls,1);assert.equal(metrics.workflowRuns[0].runs,1);
    assert.equal(metrics.agents[0].starts,1);assert.equal(metrics.agents[0].stopEvents,1);
    assert.equal(metrics.coverage.unpairedToolEvents,1);assert.equal(metrics.coverage.unidentifiedCommandEvents,1);
    assert.equal(store.db.prepare('SELECT payload FROM monitor_events').all().some(r=>r.payload.includes('DO_NOT_RETAIN') || r.payload.includes('TOKEN=secret')),false);
    assert.equal(monitorMetrics(store.db,'WHERE s.project=?',['not-observed']).events.length,0);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
