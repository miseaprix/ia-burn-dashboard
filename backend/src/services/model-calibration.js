import {createHash,randomUUID} from 'node:crypto';
import {stateStore} from '../storage/state-store.js';
import {calibrationReference} from './calibration-reference.js';
import {corporateConfig} from '../config/corporate-config.js';
const prompt='Calcule 103 × 107. Vérifie ton calcul en deux étapes courtes.';
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error('Cancelled'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();});
const number=x=>typeof x==='number' && Number.isFinite(x) && x>=0 ? x : null;
export function summarizeCatalog(list,info) {
 return {updatedAt:new Date().toISOString(),models:(list.data || []).map(m=>{
  const deployments=(info.data || []).filter(d=>d.model_name===m.id).map(d=>{
   const i=d.model_info || {};
   return {input:number(i.input_cost_per_token),output:number(i.output_cost_per_token),cacheRead:number(i.cache_read_input_token_cost),cacheWrite:number(i.cache_creation_input_token_cost),mode:i.mode || null,maxCompletionTokens:i.supported_openai_params?.includes('max_completion_tokens') ?? false,maxTokens:i.supported_openai_params?.includes('max_tokens') ?? false,effort:i.supported_openai_params ? i.supported_openai_params.includes('reasoning_effort') : null};
  });
  const unique=k=>{const v=[...new Set(deployments.map(d=>d[k]))];return v.length===1 ? v[0] : null;};
  return {id:m.id,kind:/embedding/.test(m.id) ? 'embedding' : /image/.test(m.id) ? 'image' : ['tts','whisper'].includes(m.id) ? 'audio' : 'text',
   rates:{input:unique('input'),output:unique('output'),cacheRead:unique('cacheRead'),cacheWrite:unique('cacheWrite')},
   limitParameter:unique('maxCompletionTokens')===true ? 'max_completion_tokens':unique('maxTokens')===true ? 'max_tokens':null,effort:unique('effort'),deployments:deployments.length,source:'Gateway /model/info (declared)'};
 })};
}
export function ledgerObservation(result,before,after,stable){
 if(after.date!==before.date)throw Object.assign(new Error('Billing day changed'),{code:'billing_day_changed'});
 const requestsDelta=after.total.api_requests-before.total.api_requests,measuredCost=after.total.spend-before.total.spend,tokensDelta=after.total.total_tokens-before.total.total_tokens;
 const billedModels=[...new Set([...Object.keys(before.models),...Object.keys(after.models)])].map(model=>({model,cost:(after.models[model]?.spend || 0)-(before.models[model]?.spend || 0),tokens:(after.models[model]?.total_tokens || 0)-(before.models[model]?.total_tokens || 0)})).filter(d=>d.cost!==0 || d.tokens!==0);
 const ok=result.httpStatus>=200 && result.httpStatus<300;
 const isolated=billedModels.length===1 && billedModels[0].tokens===result.usage?.total_tokens && Math.abs(billedModels[0].cost-measuredCost)<.000001 && ok && requestsDelta===1 && stable && Number.isFinite(measuredCost) && measuredCost>=0 && Number.isFinite(result.usage?.total_tokens) && tokensDelta===result.usage.total_tokens && !!result.finishReason && result.finishReason!=='length';
 return {billingStable:!!stable,requestsDelta,measuredCost,tokensDelta,billedModels,status:isolated?'observed':requestsDelta>1?'contaminated':!ok?'api_error':'unconfirmed',difference:result.predictedCost==null?null:measuredCost-result.predictedCost};
}
export class ModelCalibration {
 constructor({store=stateStore,config=corporateConfig,request=fetch,delay=sleep,pollMs=10000,polls=13,reference=calibrationReference}={}) {
  Object.assign(this,{store,config,request,delay,pollMs,polls,reference});this.active=null;this.pending=null;
 }
 async scope(){const c=await this.config();return {c,key:'calibration:'+createHash('sha256').update(c.token || 'missing').digest('hex').slice(0,24)};}
 async call(c,route,{body,signal}={}) {
  const base=new URL(c.baseUrl);
  if(base.protocol!=='https:' || base.username || base.password)throw new Error('Direct HTTPS gateway required');
  const r=await this.request(new URL(route,base),{method:body ? 'POST':'GET',redirect:'error',headers:{Authorization:`Bearer ${c.token}`,'x-api-key':c.token,'Content-Type':'application/json','anthropic-version':'2023-06-01'},body:body ? JSON.stringify(body):undefined,signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(45000)]) : AbortSignal.timeout(15000)});
  const text=await r.text();if(text.length>16*1024*1024)throw Object.assign(new Error('Oversized gateway response'),{code:'oversized_response',httpStatus:r.status});
  let data;try{data=JSON.parse(text);}catch{throw Object.assign(new Error('Invalid gateway response'),{code:'invalid_json',httpStatus:r.status});}
  return {status:r.status,ok:r.ok,data,retryAfter:r.headers.get('retry-after')};
 }
 async catalog(){const {key}=await this.scope();return this.store().collection(key+':catalog')?.value || {updatedAt:this.reference.generatedAt,reference:true,models:this.reference.models.map(({cells,...m})=>({...m,source:'Référence catalogue · '+this.reference.generatedAt?.slice(0,10)}))};}
 async discover(){
  if(this.active || this.starting)throw new Error('A campaign is already running');
  const {c,key}=await this.scope();if(!c.token)throw new Error('Configure the API key first');
  const list=await this.call(c,'/v1/models'),info=await this.call(c,'/model/info');
  if(!list.ok || !info.ok || !Array.isArray(list.data.data) || !Array.isArray(info.data.data))throw new Error('Catalog unavailable; previous prices retained');
  const value=summarizeCatalog(list.data,info.data);this.store().saveCollection(key+':catalog',{value,lastSuccess:Date.now()});return value;
 }
 async matrix(){
  const {key}=await this.scope(),catalog=await this.catalog();
  const runs=this.store().db.prepare('SELECT payload FROM collection_state WHERE source LIKE ? ORDER BY rowid DESC LIMIT 1000').all(key+':run:%').map(row=>JSON.parse(row.payload));
  const latest=new Map();
  for(const run of runs)for(const result of [...run.results].reverse()){
   const cell=result.model+'|'+result.effort;
   if(!latest.has(cell))latest.set(cell,{...result,status:result.status==='pending' ? this.active?.run.id===run.id ? 'pending':'unconfirmed':result.status || (result.httpStatus>=400 ? 'api_error':this.active?.run.id===run.id ? 'pending':'unconfirmed'),runId:run.id,testedAt:run.finishedAt || run.startedAt,promptHash:run.promptHash,maxTokens:run.maxTokens});
  }
  const efforts=['default','low','medium','high'];
  return {reference:{generatedAt:this.reference.generatedAt,measurements:this.reference.models.reduce((n,m)=>n+m.cells.length,0)},updatedAt:catalog.updatedAt || null,busy:!!this.active || !!this.starting,efforts,models:catalog.models.map(model=>({...model,cells:efforts.map(effort=>{
   const local=latest.get(model.id+'|'+effort),shared=this.reference.models.find(m=>m.id===model.id)?.cells.find(c=>c.effort===effort);
   const result=local || (shared ? {...shared,provenance:'reference',referenceDate:this.reference.generatedAt}:null);
   const eligible=model.kind==='text' && model.limitParameter && model.rates.input!=null && model.rates.output!=null && (effort==='default' || model.effort===true);
   if(!result)return {effort,status:eligible ? 'untested':'not_applicable',measuredCost:null};
   // Unsettled/account-wide deltas must never be displayed as this request's cost.
   return {...result,provenance:local?'local':'reference',errorCode:result.errorCode || (result.httpStatus===404 ? 'gateway_not_found':null),retrySafe:result.status==='api_error' && result.httpStatus!==404 && result.httpStatus>=400 && result.measuredCost===0 && result.tokensDelta===0 && result.requestsDelta===1 && result.billingStable===true && result.billedModels?.length===0,measuredCost:result.status==='observed' ? result.measuredCost:null};
  })}))};
 }
 async status(){const {key}=await this.scope();const saved=this.store().collection(key+':latest')?.value || null;
  if(['running','reconciling'].includes(saved?.status) && !this.active)return {...saved,status:'interrupted',message:'Server restarted; no generation was retried.'};return saved;
 }
 async activityPage(c,route,signal){
  // Retry only read-only ledger requests, never generations or invalid accounting data.
  for(let attempt=1;attempt<=3;attempt++){
   try{
    const r=await this.call(c,route,{signal});
    if(!r.ok)throw Object.assign(new Error('Billing HTTP error'),{code:'billing_http_error',httpStatus:r.status,retryAfter:r.retryAfter});
    return r;
   }catch(error){
    if(signal?.aborted)throw Object.assign(new Error('Billing cancelled'),{code:'billing_cancelled',attempts:attempt});
    const status=error.httpStatus || null;
    const network=['TypeError','TimeoutError'].includes(error.name);
    const retryable=status===429 || status>=500 && status<=599 || !status && network;
    const raw=error.retryAfter;
    const retryDelay=raw ? /^\d+$/.test(raw) ? Number(raw)*1000:Date.parse(raw)-Date.now():null;
    if(!retryable || attempt===3 || raw && (!Number.isFinite(retryDelay) || retryDelay>10000))throw Object.assign(new Error('Billing read failed'),{code:error.code || (network ? error.name==='TimeoutError' ? 'billing_timeout':'billing_network_error':'billing_read_error'),httpStatus:status,attempts:attempt});
    await this.delay(Math.max(2000*attempt,retryDelay || 0),signal);
   }
  }
 }
 async activity(c,signal,date=new Intl.DateTimeFormat('en-CA',{timeZone:process.env.TZ || 'UTC'}).format(new Date())){
  if(typeof date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)throw new Error('Invalid billing date');
  const total={spend:0,api_requests:0,total_tokens:0},models={};
  for(let page=1;page<=100;page++){
   const r=await this.activityPage(c,`/user/daily/activity?start_date=${date}&end_date=${date}&page_size=100&page=${page}`,signal);
   if(!r.ok || !Array.isArray(r.data.results))throw Object.assign(new Error('Billing activity unavailable'),{code:'billing_schema_error',httpStatus:r.status});
   for(const row of r.data.results){if(['spend','api_requests','total_tokens'].some(k=>number(row.metrics?.[k])==null))throw Object.assign(new Error('Incomplete billing activity'),{code:'billing_incomplete_metrics',httpStatus:r.status});}
   for(const row of r.data.results)for(const [k,v] of Object.entries(row.metrics || {}))if(number(v)!=null)total[k]=(total[k] || 0)+v;
   for(const row of r.data.results)for(const [model,value] of Object.entries(row.breakdown?.models || {})){models[model] ||= {spend:0,total_tokens:0};for(const [k,v] of Object.entries(value.metrics || {}))if(number(v)!=null)models[model][k]=(models[model][k] || 0)+v;}
   if(!r.data.metadata?.has_more && !(r.data.metadata?.total_pages>page))return {date,total,models};
  }throw new Error('Billing pagination exceeded');
 }
 async start(input){
  if(this.active || this.starting)throw new Error('A campaign is already running');
  this.starting=true;try{return await this.prepare(input);}finally{this.starting=false;}
 }
 async prepare(input){
  if(!input || Object.keys(input).some(k=>!['models','efforts','maxBudget','maxTokens','isolationConfirmed'].includes(k)) || input.isolationConfirmed!==true || !Array.isArray(input.models) || input.models.length<1 || input.models.length>5 || !Array.isArray(input.efforts) || !input.efforts.length || input.efforts.length>3 || input.efforts.some(e=>!['default','low','medium','high'].includes(e)) || !(typeof input.maxBudget==='number' && input.maxBudget>=.01 && input.maxBudget<=1) || !Number.isInteger(input.maxTokens) || input.maxTokens<64 || input.maxTokens>8192)throw new Error('Invalid campaign: isolation, budget and bounded model selection required');
  const {c,key}=await this.scope();if(!c.token)throw new Error('Configure the API key first');
  const catalog=await this.catalog();if(catalog.reference)throw new Error('Refresh the live catalogue before a paid campaign');
  const models=[...new Set(input.models)].map(id=>catalog.models.find(m=>m.id===id));
  if(models.some(m=>!m || !m.limitParameter || m.kind!=='text' || !Number.isFinite(m.rates.input) || !Number.isFinite(m.rates.output)))throw new Error('Select text models with unambiguous declared prices');
  const run={id:randomUUID(),startedAt:new Date().toISOString(),status:'running',maxBudget:input.maxBudget,maxTokens:input.maxTokens,observedSpend:0,results:[],promptHash:createHash('sha256').update(prompt).digest('hex'),message:'Serial direct calls; account isolation must remain in effect.'};
  const controller=new AbortController();this.active={run,controller,key};this.save(key,run);
  this.pending=this.execute(c,key,run,models,input.efforts,controller.signal).finally(()=>{this.active=null;this.pending=null;});
  return run;
 }
 save(key,run){this.store().saveCollection(key+':latest',{value:run});this.store().saveCollection(key+':run:'+run.id,{value:run});}
 async execute(c,key,run,models,efforts,signal){
  let phase='preflight';
  try {
   for(const model of models)for(const effort of [...new Set(efforts)]){
    if(signal.aborted)throw new Error('cancelled');
    if(effort!=='default' && model.effort!==true){run.results.push({model:model.id,effort,status:'skipped',reason:'Effort not declared for every deployment'});this.save(key,run);continue;}
    const reserve=512*model.rates.input+run.maxTokens*model.rates.output;
    if(run.observedSpend+reserve>run.maxBudget){run.status='budget_stop';return;}
    phase='billing_before';
    const before=await this.activity(c,signal),start=Date.now();
    // Chat Completions is the gateway's shared text contract, including reasoning_effort.
    const body={model:model.id,[model.limitParameter]:run.maxTokens,messages:[{role:'user',content:prompt}],...(effort==='default' ? {}:{reasoning_effort:effort})};
    const result={model:model.id,effort,status:'pending',billingBefore:before};
    run.results.push(result);this.save(key,run);
    phase='generation';
    const response=await this.call(c,'/v1/chat/completions',{body,signal});
    const raw=response.data.usage || {},usage=Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens'].filter(k=>number(raw[k])!=null).map(k=>[k,raw[k]]));
    usage.cacheRead=number(raw.prompt_tokens_details?.cached_tokens);usage.reasoning=number(raw.completion_tokens_details?.reasoning_tokens);
    const answer=response.data.choices?.[0]?.message?.content;
    Object.assign(result,{responseModel:typeof response.data.model==='string' ? response.data.model.slice(0,200):null,qualityCheck:typeof answer==='string' ? /11[,. ]?021/.test(answer):null,model:model.id,effort,httpStatus:response.status,durationMs:Date.now()-start,usage,responseId:typeof response.data.id==='string' ? response.data.id.slice(0,200):null,finishReason:response.data.choices?.[0]?.finish_reason || null});
    if(!response.ok){
     if(response.status===404)result.errorCode='gateway_not_found';
     // Keep only known parameter names mentioned by the gateway, never its raw error.
     const errorText=typeof response.data.error?.message==='string' ? response.data.error.message:'';
     result.errorParameterHints=['reasoning_effort','max_completion_tokens','max_tokens','thinking'].filter(name=>errorText.includes(name));
     if(/max_tokens.*must be greater than.*thinking\.budget_tokens/s.test(errorText.replaceAll('`','')))result.errorCode='thinking_budget_exceeds_output_limit';
    }
    result.predictedCost=usage.cacheRead===0 && Number.isFinite(usage.prompt_tokens) && Number.isFinite(usage.completion_tokens) ? usage.prompt_tokens*model.rates.input+usage.completion_tokens*model.rates.output:null;
    this.save(key,run);
    phase='billing_after';
    let after=before,stable=0,previous='',limit=this.polls;
    for(let i=0;i<limit;i++){
     if(i)await this.delay(this.pollMs,signal);if(signal.aborted)throw new Error('cancelled');
     after=await this.activity(c,signal);if(after.date!==before.date)throw new Error('Billing day changed');
     const signature=JSON.stringify(after);stable=signature===previous ? stable+1:0;previous=signature;
     const delta=after.total.api_requests-before.total.api_requests;
     if(delta>=1 && stable>=1)break;
     // A first update on the last poll still needs a stable confirming read.
     if(i===limit-1 && limit===this.polls && delta===1 && stable<1)limit+=2;
    }
    Object.assign(result,ledgerObservation(result,before,after,stable>=1));
    run.observedSpend+=Math.max(0,result.measuredCost || 0);
    const isolated=result.status==='observed';
    // Request acceptance is not evidence that effort was honored or quality preserved.
    if(isolated && result.predictedCost!=null && Math.abs(result.difference)<=.000001){
     const catalog=this.store().collection(key+':catalog')?.value;
     const item=catalog?.models.find(m=>m.id===model.id);
     if(item){item.verification={at:new Date().toISOString(),runId:run.id,effort,kind:'input/output concordance only; cache and effort effect unverified'};this.store().saveCollection(key+':catalog',{value:catalog});}
    }
    this.save(key,run);
    if(!isolated){run.status='stopped';run.message='Billing unconfirmed, truncated response, API error or concurrent usage; no next generation.';return;}
   }
   run.status='completed';
  }catch(error) {run.failurePhase=phase;run.failure={code:error.code || 'operation_failed',httpStatus:error.httpStatus || null,attempts:error.attempts || 1};for(const result of run.results)if(!result.status || result.status==='pending')result.status=result.httpStatus>=400 ? 'api_error':'unconfirmed';run.status=signal.aborted ? 'cancelled':'interrupted';run.message='Stopped without retry; a timed-out request may still be billed.';}
  finally {run.finishedAt=new Date().toISOString();this.save(key,run);}
 }
 async reconcile(runId){
  if(this.active || this.starting)throw new Error('A campaign is already running');
  this.starting=true;
  try{
   if(typeof runId!=='string' || !/^[0-9a-f-]{36}$/.test(runId))throw new Error('Invalid campaign ID');
   const {c,key}=await this.scope(),run=this.store().collection(key+':run:'+runId)?.value;
   if(!run)throw new Error('Campaign unavailable for this account');
   const candidates=run.results.filter(r=>['unconfirmed','pending'].includes(r.status) && r.httpStatus>=200 && r.httpStatus<300 && r.billingBefore && Number.isFinite(r.usage?.total_tokens) && !!r.finishReason && r.finishReason!=='length');
   if(!candidates.length)throw new Error('No stored evidence to reconcile');
   const controller=new AbortController();run.status='reconciling';run.reconciliationStartedAt=new Date().toISOString();delete run.failure;delete run.failurePhase;
   run.message='Reading the original billing day; no generation will be repeated.';
   this.active={run,controller,key};this.save(key,run);
   this.pending=this.reconcileExecute(c,key,run,candidates,controller.signal).finally(()=>{this.active=null;this.pending=null;});
   return run;
  }finally{this.starting=false;}
 }
 async reconcileExecute(c,key,run,candidates,signal){
  try{
   for(const result of candidates){
    const before=result.billingBefore,first=await this.activity(c,signal,before.date);
    await this.delay(this.pollMs,signal);
    const after=await this.activity(c,signal,before.date);
    if(signal.aborted)throw new Error('cancelled');
    Object.assign(result,ledgerObservation(result,before,after,JSON.stringify(first)===JSON.stringify(after)),{reconciledAt:new Date().toISOString()});
   }
   run.observedSpend=run.results.reduce((n,r)=>n+Math.max(0,r.measuredCost || 0),0);
   run.status=run.results.every(r=>['observed','skipped'].includes(r.status))?'completed':'stopped';
   run.message=run.status==='completed'?'Billing confirmed by read-only reconciliation; no generation repeated.':'Ledger still cannot isolate this generation; no generation repeated.';
  }catch(error){
   run.status=signal.aborted?'cancelled':'interrupted';run.failurePhase='reconciliation';run.failure={code:error.code || 'reconciliation_failed',httpStatus:error.httpStatus || null,attempts:error.attempts || 1};run.message='Reconciliation stopped; no generation repeated.';
  }finally{run.reconciledAt=new Date().toISOString();this.save(key,run);}
 }
 async stop(){this.active?.controller.abort();if(this.pending)await this.pending;}
}
