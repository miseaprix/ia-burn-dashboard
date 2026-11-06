#!/usr/bin/env node
// Use the existing local Admin API. No credentials in CLI arguments or reports.
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{url:{type:'string',default:'http://localhost:4095'},catalog:{type:'boolean'},status:{type:'boolean'},stop:{type:'boolean'},models:{type:'string'},budget:{type:'string',default:'0.05'},'max-tokens':{type:'string',default:'5120'},'confirm-isolation':{type:'boolean'}}});
const base=new URL(values.url);
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)throw new Error('Local Admin URL required');
let route='/api/admin/calibration',body;
if(values.catalog)route+='/catalog';else if(values.stop)route+='/stop';else if(!values.status){
 if(!values.models || !values['confirm-isolation'])throw new Error('Select --models and --confirm-isolation before paid tests');
 body={models:values.models.split(','),efforts:['default','low','high'],maxBudget:Number(values.budget),maxTokens:Number(values['max-tokens']),isolationConfirmed:true};
}
const response=await fetch(new URL(route,base),{method:values.status ? 'GET':'POST',headers:{'Content-Type':'application/json'},body:values.status ? undefined:JSON.stringify(body || {})});
if(!response.ok)throw new Error('Admin refused this operation');
console.log(JSON.stringify(await response.json(),null,2));
