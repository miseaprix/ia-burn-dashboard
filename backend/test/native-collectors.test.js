import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {installClaudeMonitor} from '../../scripts/install-claude-monitor.mjs';
import {installOpenCodeMonitor} from '../../scripts/install-opencode-monitor.mjs';
import {setupOpenCodeMonitor} from '../../scripts/opencode-monitor.mjs';
import {StateStore} from '../src/storage/state-store.js';
import {ingestMonitor} from '../src/services/monitor-ingest.js';

test('Codex preserves unrelated hooks/config and native hook input reaches isolated SQLite',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-codex-')),store=new StateStore(path.join(dir,'burn.sqlite'));
  const file=path.join(dir,'hooks.json'),original={description:'existing',hooks:{Stop:[{hooks:[{type:'command',command:'old-notification'}]}]}};
  const server=http.createServer(async(req,res)=>{
    let input='';for await(const c of req)input+=c;const body=JSON.parse(input);
    assert.equal(JSON.stringify(body).includes('private'),false);ingestMonitor(body,{store});res.writeHead(200).end('{}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url=`http://127.0.0.1:${server.address().port}/api/monitor/events`;
  try {
    writeFileSync(file,JSON.stringify(original));
    const result=installClaudeMonitor({harness:'codex',dataset:'personal',settingsFile:file,url,apply:true});
    assert.equal(result.events,11);
    const installed=JSON.parse(readFileSync(file));assert.deepEqual(installed.hooks.Stop[0],original.hooks.Stop[0]);
    assert.equal(installed.hooks.SessionEnd[0].hooks[0].timeout,3);
    assert.equal(installed.hooks.Notification,undefined);assert.equal(installed.hooks.PostToolUseFailure,undefined);
    const script=fileURLToPath(new URL('../../scripts/codex-monitor-hook.mjs',import.meta.url));
    for(const dataset of ['personal','enterprise']) {
      const output=await new Promise((resolve,reject)=>{
        const child=spawn(process.execPath,[script,'--dataset',dataset,'--url',url]);let text='';
        child.stdout.on('data',c=>text+=c);child.stderr.on('data',c=>text+=c);child.on('error',reject);child.on('close',code=>resolve({code,text}));
        child.stdin.end(JSON.stringify({session_id:'thr_demo',hook_event_name:'PostToolUse',tool_name:'Bash',tool_use_id:'call_demo',tool_input:{command:'node demo.mjs --key private'},tool_response:'private-output',transcript_path:'/private/log'}));
      });
      assert.deepEqual(output,{code:0,text:''});
    }
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM monitor_sessions').get().n,2);
    installClaudeMonitor({harness:'codex',dataset:'personal',settingsFile:file,remove:true,apply:true});
    assert.deepEqual(JSON.parse(readFileSync(file)),original);
  } finally {await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
});

test('OpenCode 2 plugin observes future native operations without mutating inputs, importing history or mixing locations/providers',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-opencode-')),store=new StateStore(path.join(dir,'burn.sqlite'));
  const hooks={},packets=[],events=[],waiters=[];let closed=false,disposed=0;
  const info={id:'ses_demo',location:{directory:dir},model:{providerID:'enterprise',id:'demo'},agent:'build'};
  const push=e=>{events.push(e);waiters.shift()?.();};
  const ctx={location:{directory:dir},options:{datasets:['personal','enterprise'],providers:{personal:['openai'],enterprise:['enterprise']}},
    tool:{hook:async(name,fn)=>{hooks[name]=fn;return {dispose:async()=>disposed++};}},
    session:{get:async()=>({...info}),hook:async(name,fn)=>{hooks[name]=fn;return {dispose:async()=>disposed++};}},
    event:{subscribe:async function*({signal}) {
      signal.addEventListener('abort',()=>{closed=true;waiters.shift()?.();});
      while(!closed){if(!events.length)await new Promise(r=>waiters.push(r));if(events.length)yield events.shift();}
    }}};
  const cleanup=await setupOpenCodeMonitor(ctx,{send:async(payload)=>{packets.push(payload);ingestMonitor(payload,{store});return true;}});
  const settle=async(n)=>{for(let i=0;i<100 && packets.length<n;i++)await new Promise(r=>setTimeout(r,10));assert.equal(packets.length,n);};
  try {
    assert.equal(packets.length,0);
    const raw={tool:'bash',sessionID:'ses_demo',id:'call_demo',input:{command:'bash private-script.sh --token private-key'},result:{output:'private-output'},status:'completed'};
    const original=structuredClone(raw);
    hooks['execute.before'](raw);await settle(1);hooks['execute.after'](raw);await settle(2);assert.deepEqual(raw,original);
    const native=(type,data,id)=>({type,data,id,created:Date.now(),location:{directory:dir}});
    push(native('session.skill.activated',{sessionID:'ses_demo',name:'wcod:test',text:'private-skill'},'evt_skill'));await settle(3);
    push(native('session.usage.updated',{sessionID:'ses_demo',tokens:{input:100,output:20,reasoning:5,cache:{read:80,write:0}}},'evt_usage'));await settle(4);
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM monitor_usage').get().n,1);
    assert.equal(packets.at(-1).usage_snapshot.usage.output_tokens,25);
    assert.equal(JSON.parse(store.db.prepare('SELECT payload FROM monitor_sessions').get().payload).tokens,205);
    push(native('session.execution.succeeded',{sessionID:'ses_demo'},'evt_stop'));await settle(5);
    const state=JSON.parse(store.db.prepare('SELECT payload FROM monitor_sessions').get().payload);assert.equal(state.endedAt,null);
    const elsewhere=native('session.skill.activated',{sessionID:'ses_elsewhere',name:'other'},'evt_elsewhere');elsewhere.location.directory='/other';push(elsewhere);
    info.model.providerID='unknown-corporate-provider';hooks['execute.before']({...raw,id:'unknown'});await new Promise(r=>setTimeout(r,50));assert.equal(packets.length,5);
    info.model.providerID='openai';hooks['execute.before']({...raw,id:'personal'});await settle(6);
    assert.equal(packets.at(-1).dataset,'personal');
    push(native('session.usage.updated',{sessionID:'ses_demo',tokens:{input:200,output:30,cache:{read:80,write:0}}},'evt_mixed'));await new Promise(r=>setTimeout(r,50));assert.equal(packets.length,6);
    push(native('session.deleted',{sessionID:'ses_demo'},'evt_end'));await settle(8);
    assert.equal(packets.at(-1).type,'SessionEnd');
    assert.ok(store.db.prepare('SELECT payload FROM monitor_sessions').all().every(r=>JSON.parse(r.payload).endedAt));
    for(const secret of ['private-key','private-output','private-skill','tool_input','result'])assert.equal(JSON.stringify(packets).includes(secret),false);
  } finally {await cleanup();assert.equal(disposed,3);store.close();rmSync(dir,{recursive:true,force:true});}
});

test('OpenCode installer preserves all other settings/plugins and supports previews, reconfiguration and removal',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-opencode-install-')),file=path.join(dir,'opencode.json');
  const original={plugins:['@company/existing'],plugin:['legacy-unchanged'],providers:{custom:{key:'private-key'}}};
  try {
    writeFileSync(file,JSON.stringify(original));
    installOpenCodeMonitor({datasets:['personal','enterprise'],configFile:file});assert.deepEqual(JSON.parse(readFileSync(file)),original);
    const result=installOpenCodeMonitor({datasets:['personal','enterprise'],configFile:file,apply:true});assert.deepEqual(JSON.parse(readFileSync(result.backup)),original);
    assert.equal(installOpenCodeMonitor({datasets:['enterprise','personal'],configFile:file,apply:true}).changed,false);
    installOpenCodeMonitor({datasets:['enterprise'],configFile:file,apply:true});
    const installed=JSON.parse(readFileSync(file));assert.deepEqual(installed.providers,original.providers);assert.deepEqual(installed.plugin,original.plugin);
    assert.deepEqual(installed.plugins[1].options.datasets,['enterprise']);
    installed.plugins[1].options.providers={enterprise:['custom-corporate'],personal:['openai']};
    writeFileSync(file,JSON.stringify(installed));
    installOpenCodeMonitor({datasets:['personal','enterprise'],configFile:file,apply:true});
    assert.deepEqual(JSON.parse(readFileSync(file)).plugins[1].options.providers,installed.plugins[1].options.providers);
    installOpenCodeMonitor({datasets:[],configFile:file,apply:true});assert.deepEqual(JSON.parse(readFileSync(file)),original);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
