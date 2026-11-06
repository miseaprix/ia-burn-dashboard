#!/usr/bin/env node
// Serial campaigns through local Admin; no API key or billing data written to Git.
import {parseArgs} from 'node:util';
import {calibrationPlan} from './lib/calibration-plan.mjs';
const {values}=parseArgs({options:{url:{type:'string',default:'http://localhost:4095'},budget:{type:'string',default:'0.50'},'max-tokens':{type:'string',default:'5120'},'confirm-isolation':{type:'boolean'},'dry-run':{type:'boolean'},force:{type:'boolean'}}});
const base=new URL(values.url),budget=Number(values.budget);
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password || !Number.isFinite(budget) || budget<.01 || budget>1)throw new Error('Local URL and budget 0.01–1 USD required');
async function api(route,body){const r=await fetch(new URL(route,base),{method:body ? 'POST':'GET',headers:{'Content-Type':'application/json'},body:body ? JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Admin operation refused');return r.json();}
const maxTokens=Number(values['max-tokens']);
if(!Number.isInteger(maxTokens) || maxTokens<64 || maxTokens>8192)throw new Error('Output limit must be 64–8192 tokens');
const matrix=await api('/api/admin/calibration/matrix');
const {cases,blocked}=calibrationPlan(matrix,{maxTokens,force:values.force});
console.log(JSON.stringify({cases:cases.length,blocked,models:[...new Set(cases.map(c=>c.model))],budget,maxTokens,mode:values['dry-run'] ? 'preview':'paid campaign'}));
if(values['dry-run'])process.exit(0);
if(!values['confirm-isolation'])throw new Error('Suspend other account usage and pass --confirm-isolation before paid tests');
const current=await api('/api/admin/calibration');
if(['running','reconciling'].includes(current?.status))throw new Error('Another campaign is running');
process.once('SIGINT',async()=>{try{await api('/api/admin/calibration/stop',{});}finally{process.exit(130);}});
let spent=0;
for(const item of cases){
 if(spent+item.reserve>budget){console.log(JSON.stringify({status:'budget_stop',spent}));break;}
 const run=await api('/api/admin/calibration',{models:[item.model],efforts:[item.effort],maxBudget:budget-spent,maxTokens:Number(values['max-tokens']),isolationConfirmed:true});
 let result=run;const started=Date.now();
 while(result.status==='running'){
  await new Promise(r=>setTimeout(r,5000));result=await api('/api/admin/calibration');
  if(result?.id!==run.id)throw new Error('Campaign identity changed; stopped');
  if(Date.now()-started>360000){await api('/api/admin/calibration/stop',{});throw new Error('Campaign timed out; no next generation');}
 }
 spent+=result.observedSpend || 0;
 console.log(JSON.stringify({model:item.model,effort:item.effort,status:result.status,spent,results:result.results}));
 // No automatic workaround or new generation after unconfirmed/error/truncated billing.
 if(result.status!=='completed')break;
}
