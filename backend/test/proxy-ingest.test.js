import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StateStore,closeStateStores } from '../src/storage/state-store.js';
import { ingestProxy } from '../src/services/proxy-ingest.js';
import { buildApp } from '../src/app.js';
const exchange={schema_version:1,dataset:'enterprise',request_id:'demo-exchange',machine_id:'demo-machine',timestamp:'2026-10-11T10:00:00Z',
  harness:null,session_id:null,status:200,response_headers_ms:20,stream:true,response_complete:true,
  usage:{input:100,output:10,cacheRead:90,total:110},prompt:'PRIVATE',res_body:'PRIVATE',authorization:'SECRET'};
test('proxy exchanges persist separately, deduplicate atomically and omit content',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-exchanges-')),file=path.join(dir,'burn.sqlite');let store=new StateStore(file);
  try {
    assert.equal(ingestProxy(exchange,{store}).duplicate,false);
    assert.equal(ingestProxy(exchange,{store}).duplicate,true);
    assert.throws(()=>ingestProxy({...exchange,status:500},{store}));
    assert.throws(()=>ingestProxy({...exchange,request_id:'bad',usage:{total:-1}},{store}));
    const row=JSON.parse(store.db.prepare('SELECT payload FROM monitor_requests').get().payload);
    assert.equal(row.harness,null);assert.equal(row.session_id,null);assert.equal(row.usage.total,110);
    assert.equal(JSON.stringify(row).includes('PRIVATE'),false);assert.equal(JSON.stringify(row).includes('SECRET'),false);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM daily_usage').get().n,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM monitor_usage').get().n,0);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM monitor_sessions').get().n,0);
    // Simulate the previous schema without modifying any usage/session tables.
    store.db.exec('DROP TABLE monitor_requests; PRAGMA user_version=6;');
    store.close();store=new StateStore(file);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,7);
    ingestProxy(exchange,{store});
    store.close();store=new StateStore(file);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM monitor_requests').get().n,1);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('proxy receiver is local-only, opt-in and reports missing identity',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-exchange-api-'));
  const oldDir=process.env.STATE_DIR,oldEnabled=process.env.MONITOR_INGEST_ENABLED;
  process.env.STATE_DIR=dir;process.env.MONITOR_INGEST_ENABLED='0';
  const collector={start(){},async stop(){},status(){return{};},intervals:{local:60000,personal:60000,enterprise:300000}};
  const app=await buildApp({collector});
  try {
    const send=(host='localhost')=>app.inject({method:'POST',url:'/api/monitor/requests',headers:{host},payload:exchange});
    assert.equal((await send()).statusCode,503);process.env.MONITOR_INGEST_ENABLED='1';
    assert.equal((await send('remote.example')).statusCode,403);
    assert.equal((await send()).statusCode,200);assert.equal((await send()).json().duplicate,true);
    const data=(await app.inject({url:'/api/monitor/requests',headers:{host:'localhost'}})).json();
    assert.equal(data.summary.requests,1);assert.equal(data.summary.unknownHarness,1);assert.equal(data.summary.unknownSession,1);
    const past=(await app.inject({url:'/api/monitor/requests?range=custom&from=2026-10-01&to=2026-10-02',headers:{host:'localhost'}})).json();
    assert.equal(past.summary.requests,0);
    assert.equal((await app.inject({url:'/api/monitor/requests?offset=-1',headers:{host:'localhost'}})).statusCode,400);
  } finally {await app.close();closeStateStores();if(oldDir===undefined)delete process.env.STATE_DIR;else process.env.STATE_DIR=oldDir;
    if(oldEnabled===undefined)delete process.env.MONITOR_INGEST_ENABLED;else process.env.MONITOR_INGEST_ENABLED=oldEnabled;rmSync(dir,{recursive:true,force:true});}
});
