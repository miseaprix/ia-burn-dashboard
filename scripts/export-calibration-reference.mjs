#!/usr/bin/env node
// Explicit export of synthetic benchmark measurements only; never copy ledger/account fields.
import {parseArgs} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {buildCalibrationReference} from '../backend/src/services/calibration-reference.js';
const {values}=parseArgs({options:{url:{type:'string',default:'http://localhost:4095'}}});
const base=new URL(values.url);
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname) || !['http:','https:'].includes(base.protocol) || base.username || base.password)throw new Error('Local Burn URL required');
const response=await fetch(new URL('/api/admin/calibration/matrix',base),{signal:AbortSignal.timeout(15000)});
if(!response.ok)throw new Error('Matrix unavailable');
const matrix=await response.json();
if(matrix.busy)throw new Error('Stop the campaign before exporting');
const snapshot=buildCalibrationReference(matrix);
await writeFile(new URL('../backend/data/model-calibration-reference.json',import.meta.url),JSON.stringify(snapshot,null,2)+'\n');
console.log(JSON.stringify({date:snapshot.generatedAt,models:snapshot.models.length,validated:snapshot.models.reduce((n,m)=>n+m.cells.length,0)}));
