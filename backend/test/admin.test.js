import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {corporateDataset} from '../src/config/datasets.js';
import {buildApp} from '../src/app.js';
import {Collector} from '../src/services/collector.js';
import {corporateConfig} from '../src/config/corporate-config.js';
import {saveSettings,storedApiKey,readSettings} from '../src/config/admin-settings.js';

test('Admin validates edits, encrypts credentials, persists settings and never returns secrets',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'burn-admin-'));
  const previous=process.env.STATE_DIR;process.env.STATE_DIR=dir;
  const collector=new Collector({tasks:{},intervals:{local:60000,personal:60000,enterprise:300000}});
  const app=await buildApp({collector});
  try {
    const headers={host:'localhost:4095',origin:'http://localhost:4095'};
    const originalDataset = await corporateDataset();
    const secret='admin-fixture-secret';
    const update=await app.inject({method:'PUT',url:'/api/admin/settings',headers,payload:{apiKey:secret,budget:450,localSeconds:30,quotaSeconds:60,corporateSeconds:120}});
    assert.equal(update.statusCode,200);
    const newDataset = await corporateDataset();assert.notEqual(newDataset,originalDataset);
    assert.equal(update.json().keySource,'admin');
    assert.equal(update.body.includes(secret),false);
    assert.equal((await corporateConfig({ANTHROPIC_AUTH_TOKEN:'fallback'})).token,secret);
    assert.equal((await corporateConfig()).budget,450);
    assert.equal((await readFile(path.join(dir,'admin-settings.json'),'utf8')).includes(secret),false);
    assert.equal((await stat(path.join(dir,'admin-settings.json'))).mode & 0o777,0o600);
    assert.equal((await stat(path.join(dir,'admin-secret.key'))).mode & 0o777,0o600);
    assert.equal(storedApiKey(readSettings()),secret);
    const get=await app.inject({url:'/api/admin/settings',headers});
    assert.equal(get.body.includes(secret),false);assert.equal(get.headers['cache-control'],'no-store');
    const bad=await app.inject({method:'PUT',url:'/api/admin/settings',headers,payload:{budget:-1}});
    assert.equal(bad.statusCode,400);assert.equal((await corporateConfig()).budget,450);
    for(const headers of [{host:'evil.example'},{host:'localhost:4095',origin:'https://evil.example'},{host:'localhost:4095','sec-fetch-site':'cross-site'}]) {
      assert.equal((await app.inject({method:'PUT',url:'/api/admin/settings',headers,payload:{budget:999}})).statusCode,403);
    }
    await app.inject({method:'PUT',url:'/api/admin/settings',headers,payload:{apiKey:''}});
    assert.equal(storedApiKey(),secret);assert.equal(await corporateDataset(),newDataset);
    await app.inject({method:'PUT',url:'/api/admin/settings',headers,payload:{useEnvironmentKey:true}});
    assert.equal((await corporateConfig({ANTHROPIC_AUTH_TOKEN:'fallback'})).token,'fallback');
  } finally {await app.close();if(previous===undefined)delete process.env.STATE_DIR;else process.env.STATE_DIR=previous;await rm(dir,{recursive:true,force:true});}
});

test('saved intervals apply to collectors after recreation and reconfiguration',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'burn-admin-intervals-'));
  const previous=process.env.STATE_DIR;process.env.STATE_DIR=dir;
  try {
    saveSettings({localSeconds:30,quotaSeconds:90,corporateSeconds:120});
    const collector=new Collector({tasks:{}});
    assert.equal(collector.intervals.local,30000);assert.equal(collector.intervals['enterprise-local'],30000);
    assert.equal(collector.intervals.personal,90000);assert.equal(collector.intervals.enterprise,120000);
    saveSettings({corporateSeconds:600});await collector.reconfigure();assert.equal(collector.intervals.enterprise,600000);
    assert.equal(new Collector({tasks:{}}).intervals.enterprise,600000);
  } finally {if(previous===undefined)delete process.env.STATE_DIR;else process.env.STATE_DIR=previous;await rm(dir,{recursive:true,force:true});}
});
