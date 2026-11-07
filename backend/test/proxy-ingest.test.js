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
    store.db.exec('DROP TABLE monitor_requests; DROP TABLE monitor_model_requests; PRAGMA user_version=6;');
    store.close();store=new StateStore(file);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,9);
    ingestProxy(exchange,{store});
    store.close();store=new StateStore(file);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM monitor_requests').get().n,1);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('schema 7 exchanges keep their data and request identity after the migration',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-exchange-migrate-'));
  const file=path.join(dir,'burn.sqlite');
  let store=new StateStore(file);
  try {
    ingestProxy(exchange,{store});
    const canonical=JSON.parse(store.db.prepare('SELECT payload FROM monitor_requests').get().payload);
    const legacy={...canonical,dataset:'accorgpt'};
    store.db.exec(`DROP TABLE monitor_requests; DROP TABLE monitor_model_requests;
      CREATE TABLE monitor_requests(machine TEXT NOT NULL,id TEXT NOT NULL,timestamp TEXT NOT NULL,harness TEXT,session_id TEXT,project TEXT,ticket TEXT,payload TEXT NOT NULL,PRIMARY KEY(machine,id)) STRICT;
      CREATE INDEX monitor_requests_filters ON monitor_requests(timestamp,harness,project,ticket);
      PRAGMA user_version=7;`);
    store.db.prepare('INSERT INTO monitor_requests VALUES(?,?,?,?,?,?,?,?)').run(
      legacy.machine_id,legacy.request_id,legacy.timestamp,null,null,null,null,JSON.stringify(legacy));
    store.close();
    store=new StateStore(file);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version,9);
    const row=store.db.prepare('SELECT dataset,payload FROM monitor_requests').get();
    assert.equal(row.dataset,'enterprise');
    assert.deepEqual(JSON.parse(row.payload),canonical);
    assert.equal(ingestProxy(exchange,{store}).duplicate,true);
    assert.equal(ingestProxy({...exchange,dataset:'personal'},{store}).duplicate,false);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM monitor_requests').get().n,2);
  } finally {store.close();rmSync(dir,{recursive:true,force:true});}
});
test('proxy receiver is local-only, opt-in and keeps personal and enterprise exchanges distinct',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-exchange-api-'));
  const oldDir=process.env.STATE_DIR,oldEnabled=process.env.MONITOR_INGEST_ENABLED;
  process.env.STATE_DIR=dir;process.env.MONITOR_INGEST_ENABLED='0';
  const collector={start(){},async stop(){},status(){return{};},intervals:{local:60000,personal:60000,enterprise:300000}};
  const app=await buildApp({collector});
  try {
    const send=(host='localhost',dataset='enterprise')=>app.inject({
      method:'POST',url:'/api/monitor/requests',headers:{host},payload:{...exchange,dataset},
    });
    assert.equal((await send()).statusCode,503);process.env.MONITOR_INGEST_ENABLED='1';
    assert.equal((await send('remote.example')).statusCode,403);
    assert.equal((await send()).statusCode,200);
    assert.equal((await send('localhost','accorgpt')).json().duplicate,true);
    const personal=await send('localhost','personal');
    assert.equal(personal.statusCode,200);
    assert.equal(personal.json().duplicate,false);
    assert.equal((await send('localhost','personal')).json().duplicate,true);
    assert.equal((await send('localhost','unknown')).statusCode,400);
    const data=(await app.inject({url:'/api/monitor/requests',headers:{host:'localhost'}})).json();
    assert.equal(data.summary.requests,2);assert.equal(data.summary.unknownHarness,2);assert.equal(data.summary.unknownSession,2);
    assert.deepEqual(data.requests.map(row=>row.dataset).sort(),['enterprise','personal']);
    for (const dataset of ['enterprise','personal']) {
      const result=await app.inject({url:`/api/monitor/requests?dataset=${dataset}`,headers:{host:'localhost'}});
      assert.equal(result.statusCode,200);
      assert.equal(result.json().summary.requests,1);
      assert.deepEqual(result.json().requests.map(row=>row.dataset),[dataset]);
    }
    assert.equal((await app.inject({url:'/api/monitor/requests?dataset=unknown',headers:{host:'localhost'}})).statusCode,400);
    const past=(await app.inject({url:'/api/monitor/requests?range=custom&from=2026-10-01&to=2026-10-02',headers:{host:'localhost'}})).json();
    assert.equal(past.summary.requests,0);
    const timed=(fromTime,toTime)=>app.inject({
      url:`/api/monitor/requests?${new URLSearchParams({fromTime,toTime})}`,headers:{host:'localhost'},
    });
    assert.equal((await timed('2026-10-11T12:00:00+02:00','2026-10-11T12:00:00+02:00')).json().summary.requests,2);
    assert.equal((await timed('2026-10-11T10:00:01Z','2026-10-11T11:00:00Z')).json().summary.requests,0);
    assert.equal((await timed('2026-10-11T10:00:00','2026-10-11T11:00:00Z')).statusCode,400);
    assert.equal((await app.inject({url:'/api/monitor/requests?offset=-1',headers:{host:'localhost'}})).statusCode,400);
  } finally {await app.close();closeStateStores();if(oldDir===undefined)delete process.env.STATE_DIR;else process.env.STATE_DIR=oldDir;
    if(oldEnabled===undefined)delete process.env.MONITOR_INGEST_ENABLED;else process.env.MONITOR_INGEST_ENABLED=oldEnabled;rmSync(dir,{recursive:true,force:true});}
});
