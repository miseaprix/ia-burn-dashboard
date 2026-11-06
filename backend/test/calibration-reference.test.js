import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StateStore} from '../src/storage/state-store.js';
import {ModelCalibration} from '../src/services/model-calibration.js';
import {buildCalibrationReference,calibrationReference} from '../src/services/calibration-reference.js';
test('reference export whitelists validated synthetic measurements and never exports account/request evidence',()=>{
 const matrix={models:[{id:'gpt-test',kind:'text',effort:true,limitParameter:'max_tokens',rates:{input:.1,output:.2,api_key:'SECRET'},token:'SECRET',cells:[
 {effort:'low',status:'observed',measuredCost:0,predictedCost:0,maxTokens:5120,testedAt:'2026-10-13T14:00:00Z',usage:{prompt_tokens:24,completion_tokens:100,total_tokens:124,secret:'SECRET'},runId:'SECRET',responseId:'SECRET',billingBefore:{account:'SECRET'},billedModels:[{account:'SECRET'}]},
 {effort:'medium',status:'unconfirmed',measuredCost:9},
 {effort:'high',status:'contaminated',measuredCost:9},
 {effort:'default',status:'observed',provenance:'reference',measuredCost:1,usage:{prompt_tokens:24,completion_tokens:100}}]}]};
 const reference=buildCalibrationReference(matrix,{generatedAt:'2026-10-13T15:00:00Z'});
 assert.equal(reference.models[0].cells.length,1);
 assert.equal(reference.models[0].cells[0].measuredCost,0);
 assert.equal(reference.models[0].cells[0].testedAt,'2026-10-13');
 assert.ok(!JSON.stringify(reference).includes('SECRET'));
 assert.equal(reference.models[0].rates.cacheWrite1h,null);
});
test('bundled reference is available on an empty installation without a key or historical data import',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'burn-reference-')),store=new StateStore(path.join(dir,'burn.sqlite'));
 try{
  const service=new ModelCalibration({store:()=>store,config:async()=>({token:null}),request:()=>{throw new Error('Unexpected network');}});
  const catalog=await service.catalog(),matrix=await service.matrix();
  assert.equal(catalog.reference,true);assert.equal(catalog.models.length,4);
  const cells=matrix.models.flatMap(m=>m.cells).filter(c=>c.status==='observed');
  assert.equal(cells.length,8);assert.ok(cells.every(c=>c.provenance==='reference' && !c.runId && !c.billingBefore));
  assert.equal(await service.status(),null);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM collection_state').get().n,0);
  assert.equal(calibrationReference.schemaVersion,1);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('local uncertainty overrides shared measurements and paid calls require live catalogue refresh',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'burn-reference-')),store=new StateStore(path.join(dir,'burn.sqlite'));
 try{
  const reference={generatedAt:'2026-10-13T14:00:00Z',models:[{id:'test',kind:'text',effort:true,limitParameter:'max_tokens',rates:{input:.000001,output:.000002},cells:[{effort:'low',status:'observed',measuredCost:.001}]}]};
  let requests=0;const service=new ModelCalibration({store:()=>store,config:async()=>({token:'SECRET'}),reference,request:()=>{requests++;}});
  await assert.rejects(service.start({models:['test'],efforts:['low'],maxTokens:128,maxBudget:.1,isolationConfirmed:true}),/live catalogue/);
  assert.equal(requests,0);
  const {key}=await service.scope();
  service.save(key,{id:'local',startedAt:'2026-10-14',results:[{model:'test',effort:'low',status:'unconfirmed',measuredCost:99}]});
  let cell=(await service.matrix()).models[0].cells.find(c=>c.effort==='low');
  assert.equal(cell.provenance,'local');assert.equal(cell.status,'unconfirmed');assert.equal(cell.measuredCost,null);
  service.config=async()=>({token:'ANOTHER'});
  cell=(await service.matrix()).models[0].cells.find(c=>c.effort==='low');
  assert.equal(cell.provenance,'reference');assert.equal(cell.measuredCost,.001);
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
