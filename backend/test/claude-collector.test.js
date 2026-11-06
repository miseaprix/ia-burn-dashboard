import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
import {installClaudeMonitor,removeClaudeHooks} from '../../scripts/install-claude-monitor.mjs';
import {monitorContext} from '../../scripts/monitor-context.mjs';
import {StateStore} from '../src/storage/state-store.js';
import {ingestMonitor} from '../src/services/monitor-ingest.js';

test('Claude installer preserves existing hooks/settings, previews, backs up and is idempotent',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-install-')),file=path.join(dir,'settings.json');
  const original={env:{PRIVATE:'do-not-print'},permissions:{allow:['Read']},hooks:{PreToolUse:[{matcher:'*',hooks:[{type:'command',command:'bun old-monitor.ts'}]}]}};
  try {
    writeFileSync(file,JSON.stringify(original));
    const preview=installClaudeMonitor({dataset:'personal',settingsFile:file});
    assert.equal(preview.applied,false);assert.deepEqual(JSON.parse(readFileSync(file)),original);
    assert.equal(JSON.stringify(preview).includes('do-not-print'),false);
    const applied=installClaudeMonitor({dataset:'personal',settingsFile:file,apply:true});
    assert.deepEqual(JSON.parse(readFileSync(applied.backup)),original);assert.equal(statSync(applied.backup).mode & 0o777,0o600);
    const installed=JSON.parse(readFileSync(file));assert.deepEqual(installed.env,original.env);
    assert.deepEqual(installed.permissions,original.permissions);assert.deepEqual(installed.hooks.PreToolUse[0],original.hooks.PreToolUse[0]);
    assert.equal(installed.hooks.PreToolUse.length,2);assert.equal(Object.keys(installed.hooks).length,10);
    assert.equal(installClaudeMonitor({dataset:'personal',settingsFile:file,apply:true}).changed,false);
    assert.throws(()=>installClaudeMonitor({dataset:'enterprise',settingsFile:file,apply:true}),/different Burn/);
    assert.throws(()=>installClaudeMonitor({dataset:'personal',url:'https://remote.invalid/api/monitor/events'}),/local/);
    installClaudeMonitor({dataset:'personal',settingsFile:file,url:'http://localhost:4096/api/monitor/events',apply:true,replace:true});
    assert.equal(JSON.stringify(JSON.parse(readFileSync(file))).includes('localhost:4095'),false);
    assert.equal(installClaudeMonitor({dataset:'personal',settingsFile:file,url:'http://localhost:4096/api/monitor/events',apply:true,replace:true}).changed,false);
    installClaudeMonitor({dataset:'personal',settingsFile:file,apply:true,remove:true});
    assert.deepEqual(JSON.parse(readFileSync(file)),original);
    assert.equal(installClaudeMonitor({dataset:'personal',settingsFile:file,apply:true,remove:true}).changed,false);
    const other={hooks:{Stop:[{hooks:[{command:"node claude-monitor-hook.mjs '--dataset' 'enterprise'"},{command:'existing-hook'}]}],SessionEnd:[]}};
    assert.deepEqual(removeClaudeHooks(other,'personal'),other);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('context identifies repository from nested directory, handles ambiguous tickets and explicit overrides',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-context-'));
  try {
    execFileSync('git',['init','-q',dir]);execFileSync('git',['-C',dir,'symbolic-ref','HEAD','refs/heads/codex/DEMO-123-tools']);
    const context=await monitorContext({cwd:dir,tool_name:'Skill',tool_input:{skill:'wcod:test',args:'private'}} ,{});
    assert.equal(context.project,path.basename(dir));assert.equal(context.ticket,'DEMO-123');assert.equal(context.skill_name,'wcod:test');
    execFileSync('git',['-C',dir,'symbolic-ref','HEAD','refs/heads/DEMO-123-OTHER-456']);
    assert.equal((await monitorContext({cwd:dir},{})).ticket,undefined);
    assert.equal((await monitorContext({cwd:dir},{BURN_MONITOR_TICKET:'TASK-9'})).ticket,'TASK-9');
    assert.equal((await monitorContext({cwd:'/missing-burn-project'},{})).branch,undefined);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('native Claude hook writes sanitized events to SQLite, isolates datasets and remains silent on outage',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-native-')),store=new StateStore(path.join(dir,'burn.sqlite'));
  const received=[];
  const server=http.createServer(async(req,res)=>{
    let text='';for await(const chunk of req)text+=chunk;
    const payload=JSON.parse(text);received.push(payload);ingestMonitor(payload,{store});res.writeHead(200).end('{}');
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const endpoint=`http://127.0.0.1:${server.address().port}/api/monitor/events`;
  const script=fileURLToPath(new URL('../../scripts/claude-monitor-hook.mjs',import.meta.url));
  const invoke=(dataset,body,url=endpoint)=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[script,'--dataset',dataset,'--url',url],{env:{...process.env,BURN_MONITOR_MACHINE:'test-machine',BURN_MONITOR_DEBUG:'0'}});
    let output='';child.stdout.on('data',s=>output+=s);child.stderr.on('data',s=>output+=s);
    child.on('error',reject);child.on('close',code=>resolve({code,output}));child.stdin.end(JSON.stringify(body));
  });
  try {
    const body={session_id:'same-session',hook_event_name:'PostToolUse',tool_use_id:'tool-1',tool_name:'Bash',tool_input:{command:'node /private/example.mjs --token supersecret'},tool_response:{stdout:'private-output'},prompt:'private-prompt',transcript_path:'/private/history.jsonl',project:'demo',ticket:'DEMO-123'};
    assert.deepEqual(await invoke('personal',body),{code:0,output:''});
    assert.deepEqual(await invoke('enterprise',body),{code:0,output:''});
    assert.equal(store.db.prepare('SELECT COUNT(*) n FROM monitor_sessions').get().n,2);
    assert.equal(received[0].command_name,'node');assert.equal(received[0].script_name,'example.mjs');
    assert.equal(received[0].session_id,'same-session');assert.equal(received[0].ticket,'DEMO-123');
    assert.equal(received[0].usage_snapshot,undefined);
    for(const forbidden of ['supersecret','private-output','private-prompt','history.jsonl','tool_input','tool_response'])assert.equal(JSON.stringify(received).includes(forbidden),false);
    await new Promise(r=>server.close(r));
    assert.deepEqual(await invoke('personal',body),{code:0,output:''});
  } finally {if(server.listening)await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
});
