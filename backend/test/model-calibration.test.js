import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StateStore} from '../src/storage/state-store.js';
import {ModelCalibration,summarizeCatalog} from '../src/services/model-calibration.js';
const catalog={data:[{id:'gpt-test'}]},info={data:[{model_name:'gpt-test',model_info:{mode:'chat',input_cost_per_token:.000002,output_cost_per_token:.00001,supported_openai_params:['reasoning_effort','max_completion_tokens']},litellm_params:{api_key:'SECRET'}}]};
const input={models:['gpt-test'],efforts:['low','high'],maxTokens:128,maxBudget:.1,isolationConfirmed:true};
function fixture({contaminated=false,fail=false}={}) {
 const dir=mkdtempSync(path.join(tmpdir(),'burn-calibrate-')),store=new StateStore(path.join(dir,'burn.sqlite'));
 let count=0;const calls=[];
 const request=async(url,options)=>{
  calls.push({path:url.pathname,body:options.body ? JSON.parse(options.body):null});
  assert.equal(url.origin,'https://api.test.example.com');
  if(url.pathname==='/v1/models')return Response.json(catalog);
  if(url.pathname==='/model/info')return Response.json(info);
  if(url.pathname==='/v1/chat/completions'){
   if(fail)throw new Error('SECRET could appear in network error');
   count+=contaminated ? 2:1;
   return Response.json({id:'request-test',usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,prompt_tokens_details:{cached_tokens:0}},choices:[{finish_reason:'stop',message:{content:'private generated text'}}]});
  }
  return Response.json({results:[{metrics:{spend:count*.00022,api_requests:count,total_tokens:count*30},breakdown:{models:{'provider/gpt-test':{metrics:{spend:count*.00022,total_tokens:count*30}}}}}]});
 };
 const service=new ModelCalibration({store:()=>store,config:async()=>({token:'SECRET',baseUrl:'https://api.test.example.com'}),request,delay:async()=>{},polls:3,reference:{models:[]}});
 return {service,calls,store,close:()=>{store.close();rmSync(dir,{recursive:true,force:true});}};
}
test('declared catalog omits credentials, mixed deployment prices remain unknown',()=>{
 const d=summarizeCatalog(catalog,info);assert.ok(!JSON.stringify(d).includes('SECRET'));assert.equal(d.models[0].effort,true);
 const mixed=summarizeCatalog(catalog,{data:[...info.data,{...info.data[0],model_info:{...info.data[0].model_info,input_cost_per_token:.01}}]});assert.equal(mixed.models[0].rates.input,null);
});
test('campaign is serial, reconciles ledger, persists across restart and does not retain text or keys',async()=>{
 const f=fixture();try{
  await f.service.discover();await f.service.start(input);await f.service.pending;
  const result=await f.service.status();assert.equal(result.status,'completed');assert.equal(result.results.length,2);
  assert.ok(result.results.every(r=>r.status==='observed' && Math.abs(r.difference)<1e-12));
  assert.deepEqual(f.calls.filter(c=>c.body).map(c=>c.body.reasoning_effort),['low','high']);
  const serialized=JSON.stringify(f.store.db.prepare('SELECT * FROM collection_state').all());assert.ok(!serialized.includes('SECRET'));assert.ok(!serialized.includes('private generated text'));
  const restarted=new ModelCalibration({store:()=>f.store,config:f.service.config});assert.equal((await restarted.status()).id,result.id);
  restarted.config=async()=>({token:'OTHER'});assert.equal(await restarted.status(),null);
 }finally{f.close();}
});
test('contaminated billing stops before next generation',async()=>{
 const f=fixture({contaminated:true});try{await f.service.discover();await f.service.start(input);await f.service.pending;assert.equal((await f.service.status()).status,'stopped');assert.equal(f.calls.filter(c=>c.body).length,1);}finally{f.close();}
});
test('budget reserves costs and isolation is mandatory; uncertain requests never retry',async()=>{
 const f=fixture({fail:true});try{
  await f.service.discover();await assert.rejects(f.service.start({...input,isolationConfirmed:false}));
  await f.service.start(input);await f.service.pending;assert.equal((await f.service.status()).status,'interrupted');assert.equal(f.calls.filter(c=>c.body).length,1);
  const {key}=await f.service.scope();const saved=await f.service.catalog();saved.models[0].rates.output=1;f.store.saveCollection(key+':catalog',{value:saved});
  await f.service.start(input);await f.service.pending;assert.equal((await f.service.status()).status,'budget_stop');assert.equal(f.calls.filter(c=>c.body).length,1);
 }finally{f.close();}
});
test('concurrent campaign starts allow only one job',async()=>{
 const f=fixture();try{await f.service.discover();const r=await Promise.allSettled([f.service.start(input),f.service.start(input)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);await f.service.pending;}finally{f.close();}
});

test('Admin campaign endpoints reject foreign origins and do not auto-run paid tests',async()=>{
 const {buildApp}=await import('../src/app.js');
 const {Collector}=await import('../src/services/collector.js');
 const f=fixture();const app=await buildApp({collector:new Collector({tasks:{}}),calibration:f.service});
 try{
  const headers={host:'localhost:4095'};
  assert.equal((await app.inject({url:'/api/context/models',headers})).json().models.length,0);
  assert.equal(f.calls.length,0);
  for(const url of ['/api/admin/calibration','/api/admin/calibration/catalog','/api/admin/calibration/stop','/api/admin/calibration/reconcile'])assert.equal((await app.inject({method:'POST',url,headers:{...headers,origin:'https://evil.example'},payload:input})).statusCode,403);
  assert.equal(f.calls.length,0);
  assert.equal((await app.inject({method:'POST',url:'/api/admin/calibration/catalog',headers,payload:{}})).statusCode,200);
  assert.equal(f.calls.filter(c=>c.body).length,0);
  assert.equal((await app.inject({method:'POST',url:'/api/admin/calibration',headers,payload:{...input,isolationConfirmed:false}})).statusCode,400);
 }finally{await app.close();f.close();}
});


test('global matrix keeps campaigns, separates API keys and never validates contaminated costs',async()=>{
 const f=fixture();try{
  await f.service.discover();let matrix=await f.service.matrix();assert.equal(matrix.models[0].cells.find(c=>c.effort==='low').status,'untested');
  await f.service.start({...input,efforts:['low']});await f.service.pending;
  await f.service.start({...input,efforts:['high']});await f.service.pending;
  matrix=await f.service.matrix();assert.equal(matrix.models[0].cells.find(c=>c.effort==='low').status,'observed');assert.equal(matrix.models[0].cells.find(c=>c.effort==='high').status,'observed');
  const {key}=await f.service.scope();f.store.saveCollection(key+':run:new',{value:{id:'new',startedAt:'2026-10-12T12:00:00Z',results:[{model:'gpt-test',effort:'high',status:'contaminated',measuredCost:99}]}});
  matrix=await f.service.matrix();assert.equal(matrix.models[0].cells.find(c=>c.effort==='high').measuredCost,null);
  f.service.config=async()=>({token:'OTHER'});assert.deepEqual((await f.service.matrix()).models,[]);
 }finally{f.close();}
});


test('ledger failure after API refusal keeps an explicit cell error without retry or measured cost',async()=>{
 const f=fixture();try{
  const request=f.service.request;let reads=0;
  f.service.request=async(url,options)=>{
   if(url.pathname==='/user/daily/activity' && ++reads>1)throw new Error('SECRET ledger error');
   if(url.pathname==='/v1/chat/completions')return Response.json({error:{message:'SECRET provider error: reasoning_effort: `max_tokens` must be greater than `thinking.budget_tokens`'}},{status:400});
   return request(url,options);
  };
  await f.service.discover();await f.service.start(input);await f.service.pending;
  const run=await f.service.status();assert.equal(run.status,'interrupted');assert.equal(run.failurePhase,'billing_after');assert.equal(run.results.length,1);assert.equal(run.results[0].status,'api_error');assert.deepEqual(run.results[0].errorParameterHints,['reasoning_effort','max_tokens','thinking']);assert.equal(run.results[0].errorCode,'thinking_budget_exceeds_output_limit');
  // Older stored runs may have no result status; the matrix must still expose the HTTP refusal.
  const {key}=await f.service.scope();delete run.results[0].status;f.service.save(key,run);
  const matrix=await f.service.matrix();const cell=matrix.models[0].cells.find(c=>c.effort==='low');assert.equal(cell.status,'api_error');assert.equal(cell.measuredCost,null);
  assert.ok(!JSON.stringify(run).includes('SECRET'));
 }finally{f.close();}
});


test('reasoning output cap is configurable and used for both reservation and the actual request',async()=>{
 const f=fixture();try{
  await f.service.discover();await assert.rejects(f.service.start({...input,maxTokens:8193}));
  await f.service.start({...input,efforts:['low'],maxTokens:5120});await f.service.pending;
  assert.equal((await f.service.status()).status,'completed');assert.equal(f.calls.find(c=>c.body)?.body.max_completion_tokens,5120);
  const calls=f.calls.filter(c=>c.body).length;
  await f.service.start({...input,efforts:['low'],maxTokens:5120,maxBudget:.01});await f.service.pending;
  assert.equal((await f.service.status()).status,'budget_stop');assert.equal(f.calls.filter(c=>c.body).length,calls);
 }finally{f.close();}
});

test('transient ledger failures retry reads but generate once and persist the baseline',async()=>{
 const f=fixture();try{
  const request=f.service.request;let failures=0,generated=false;
  f.service.request=async(url,options)=>{
   if(url.pathname==='/v1/chat/completions')generated=true;
   if(url.pathname==='/user/daily/activity' && generated && failures++<2){
    if(failures===1)return Response.json({error:{message:'SECRET'}},{status:503});
    throw new TypeError('SECRET network failure');
   }
   return request(url,options);
  };
  await f.service.discover();await f.service.start({...input,efforts:['low']});await f.service.pending;
  const run=await f.service.status();assert.equal(run.status,'completed');assert.equal(f.calls.filter(c=>c.body).length,1);assert.equal(run.results[0].billingBefore.total.api_requests,0);assert.ok(!JSON.stringify(run).includes('SECRET'));
 }finally{f.close();}
});
test('persistent ledger failure records HTTP and attempts without replaying generation',async()=>{
 const f=fixture();try{
  const request=f.service.request;let generated=false,failures=0;
  f.service.request=async(url,options)=>{
   if(url.pathname==='/v1/chat/completions')generated=true;
   if(url.pathname==='/user/daily/activity' && generated){failures++;return Response.json({error:{message:'SECRET'}},{status:503});}
   return request(url,options);
  };
  await f.service.discover();await f.service.start({...input,efforts:['low']});await f.service.pending;
  const run=await f.service.status();assert.equal(failures,3);assert.equal(f.calls.filter(c=>c.body).length,1);assert.equal(run.results[0].status,'unconfirmed');assert.deepEqual(run.failure,{code:'billing_http_error',httpStatus:503,attempts:3});
 }finally{f.close();}
});
test('401 and incomplete ledger are not retried; cancellation interrupts backoff',async()=>{
 const f=fixture();try{
  let count=0;f.service.request=async()=>{count++;return Response.json({},{status:401});};
  await assert.rejects(f.service.activity(await f.service.config()),e=>e.httpStatus===401 && e.attempts===1);assert.equal(count,1);
  count=0;f.service.request=async()=>{count++;return Response.json({results:[{metrics:{spend:0}}]});};
  await assert.rejects(f.service.activity(await f.service.config()),e=>e.code==='billing_incomplete_metrics');assert.equal(count,1);
  const controller=new AbortController();count=0;f.service.request=async()=>{count++;return Response.json({},{status:429,headers:{'Retry-After':'1'}});};
  f.service.delay=async()=>{controller.abort();throw new Error('cancelled');};
  await assert.rejects(f.service.activity(await f.service.config(),controller.signal));assert.equal(count,1);
 }finally{f.close();}
});
test('API refusal can retry only after stable ledger confirms one failed request and zero usage',async()=>{
 const f=fixture();try{
  await f.service.discover();const {key}=await f.service.scope();
  const run={id:'refusal',results:[{model:'gpt-test',effort:'low',status:'api_error',httpStatus:400,measuredCost:0,tokensDelta:0,requestsDelta:0,billedModels:[]}]};
  f.service.save(key,run);assert.equal((await f.service.matrix()).models[0].cells.find(c=>c.effort==='low').retrySafe,false);
  Object.assign(run.results[0],{requestsDelta:1,billingStable:true});f.service.save(key,run);assert.equal((await f.service.matrix()).models[0].cells.find(c=>c.effort==='low').retrySafe,true);
  run.results[0].httpStatus=404;f.service.save(key,run);const cell=(await f.service.matrix()).models[0].cells.find(c=>c.effort==='low');assert.equal(cell.retrySafe,false);assert.equal(cell.errorCode,'gateway_not_found');
 }finally{f.close();}
});


test('a ledger update on the last poll gets bounded stable reads without replaying generation',async()=>{
 const f=fixture();try{
  const request=f.service.request;let generated=false,afterReads=0;
  f.service.request=async(url,options)=>{
   if(url.pathname==='/v1/chat/completions')generated=true;
   if(url.pathname==='/user/daily/activity' && generated && ++afterReads<=2)return Response.json({results:[{metrics:{spend:0,api_requests:0,total_tokens:0},breakdown:{models:{}}}]});
   return request(url,options);
  };
  await f.service.discover();await f.service.start({...input,efforts:['low']});await f.service.pending;
  assert.equal((await f.service.status()).status,'completed');assert.equal(afterReads,4);assert.equal(f.calls.filter(c=>c.body).length,1);
 }finally{f.close();}
});

test('read-only reconciliation uses the original day, updates the matrix and never generates again',async()=>{
 const f=fixture();try{
  const request=f.service.request;let generated=false;
  f.service.request=async(url,options)=>{
   if(url.pathname==='/v1/chat/completions')generated=true;
   if(url.pathname==='/user/daily/activity' && generated)return Response.json({results:[]});
   return request(url,options);
  };
  await f.service.discover();await f.service.start({...input,efforts:['low']});await f.service.pending;
  const run=await f.service.status(),{key}=await f.service.scope();assert.equal(run.results[0].status,'unconfirmed');
  run.results[0].billingBefore.date='2026-10-12';f.service.save(key,run);
  const dates=[];f.service.request=async(url,options)=>{if(url.pathname==='/user/daily/activity')dates.push(url.searchParams.get('start_date'));return request(url,options);};
  await f.service.reconcile(run.id);await f.service.pending;
  const reconciled=await f.service.status();assert.equal(reconciled.status,'completed');assert.equal(reconciled.results[0].status,'observed');assert.ok(reconciled.results[0].reconciledAt);assert.deepEqual(dates,['2026-10-12','2026-10-12']);assert.equal(f.calls.filter(c=>c.body).length,1);
  assert.equal((await f.service.matrix()).models[0].cells.find(c=>c.effort==='low').status,'observed');
  f.service.config=async()=>({token:'OTHER'});await assert.rejects(f.service.reconcile(run.id));
 }finally{f.close();}
});
test('reconciliation rejects missing evidence and concurrent jobs, and keeps contaminated cost unvalidated',async()=>{
 const f=fixture();try{
  await f.service.discover();await f.service.start({...input,efforts:['low']});await f.service.pending;
  const run=await f.service.status(),{key}=await f.service.scope(),calls=f.calls.filter(c=>c.body).length;
  run.results[0].status='unconfirmed';const baseline=run.results[0].billingBefore;delete run.results[0].billingBefore;f.service.save(key,run);
  await assert.rejects(f.service.reconcile(run.id));assert.equal(f.calls.filter(c=>c.body).length,calls);
  run.results[0].billingBefore=baseline;f.service.save(key,run);
  const original=f.service.request;f.service.request=async(url,options)=>url.pathname==='/user/daily/activity'?Response.json({results:[{metrics:{spend:.00044,api_requests:2,total_tokens:60},breakdown:{models:{'provider/gpt-test':{metrics:{spend:.00044,total_tokens:60}}}}}]}):original(url,options);
  let release;f.service.delay=()=>new Promise(resolve=>{release=resolve;});
  await f.service.reconcile(run.id);
  for(let i=0;i<20 && !release;i++)await new Promise(r=>setTimeout(r,1));
  await assert.rejects(f.service.start(input));await assert.rejects(f.service.reconcile(run.id));release();await f.service.pending;
  const result=(await f.service.matrix()).models[0].cells.find(c=>c.effort==='low');assert.equal(result.status,'contaminated');assert.equal(result.measuredCost,null);assert.equal(f.calls.filter(c=>c.body).length,calls);
 }finally{f.close();}
});

test('generation 404 remains an explicit gateway error, stops without retry and retains no provider message',async()=>{
 const f=fixture();try{
  const request=f.service.request;
  f.service.request=async(url,options)=>url.pathname==='/v1/chat/completions'?Response.json({error:{message:'SECRET provider URL not found'}},{status:404}):request(url,options);
  await f.service.discover();await f.service.start(input);await f.service.pending;
  const run=await f.service.status();
  assert.equal(run.status,'stopped');assert.equal(run.results.length,1);
  assert.equal(run.results[0].status,'api_error');assert.equal(run.results[0].errorCode,'gateway_not_found');
  assert.ok(!JSON.stringify(run).includes('SECRET'));
 }finally{f.close();}
});
