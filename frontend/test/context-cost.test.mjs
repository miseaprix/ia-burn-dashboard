import test from 'node:test';
import assert from 'node:assert/strict';
import {contextCost,presets,modelRates,costBudgetStatus,dailyBudget,matchingPreset} from '../src/lib/context-cost.mjs';
const rates={input:4,output:20,cacheWrite:5,cacheRead:.2};
test('reference A/B costs match category sums and do not derive price from effort',()=>{
 const a=contextCost(presets.heavyLow,rates),b=contextCost(presets.cleanHigh,rates);
 assert.ok(Math.abs(a.cost-11.2)<1e-10);assert.ok(Math.abs(b.cost-32.7)<1e-10);
 assert.equal(a.tokens,16250000);assert.equal(b.tokens,5900000);
 assert.equal(contextCost({...presets.heavyLow,effort:'max'},rates).cost,a.cost);
 assert.ok(Math.abs(a.parts.reduce((n,p)=>n+p.cost,0)-a.cost)<1e-12);
});
test('missing tariffs stay unknown, zeros do not invent costs, invalid numbers are rejected',()=>{
 const r=contextCost(presets.heavyLow,{...rates,cacheWrite:null});assert.equal(r.cost,null);assert.equal(r.complete,false);
 assert.equal(contextCost({...presets.heavyLow,cacheWrite:0},{...rates,cacheWrite:null}).complete,true);
 assert.throws(()=>contextCost({...presets.heavyLow,input:-1},rates));assert.throws(()=>contextCost({...presets.heavyLow,turns:Infinity},rates));
});

test('selected catalogue rates convert units without filling absent cache tariffs or mutating the model',()=>{
 const model={rates:{input:.000004,output:.00002,cacheRead:0,cacheWrite:.000005}};
 const rates=modelRates(model);
 assert.deepEqual(rates,{input:4,output:20,cacheRead:0,cacheWrite:5,cacheWrite1h:null});
 rates.input=9;
 assert.equal(model.rates.input,.000004);
 assert.equal(modelRates({rates:{input:-1,output:Infinity}}).input,null);
 assert.equal(modelRates({rates:{output:Infinity}}).output,null);
 assert.equal(contextCost(presets.heavyLow,{...modelRates(model),cacheWrite:modelRates(model).cacheWrite1h}).cost,null);
});

test('budget indicator uses the user target, preserves unknown costs and caps the gauge',()=>{
 const within=costBudgetStatus(11.2,20);
 assert.equal(within.state,'within');assert.equal(within.percent,56);assert.ok(Math.abs(within.fill-56)<1e-10);
 assert.equal(costBudgetStatus(16,20).state,'near');
 assert.equal(costBudgetStatus(20,20).state,'near');
 assert.deepEqual(costBudgetStatus(32.7,20),{state:'over',percent:164,fill:100});
 assert.deepEqual(costBudgetStatus(null,20),{state:'unknown',percent:null,fill:0});
 assert.equal(costBudgetStatus(0,20).state,'within');
 assert.throws(()=>costBudgetStatus(10,0));
});

test('daily reference follows the configured monthly budget and working days without an invented fallback',()=>{
 assert.equal(dailyBudget(300),15);
 assert.equal(dailyBudget(600,20),30);
 assert.equal(dailyBudget(300,25),12);
 assert.equal(dailyBudget(null),null);
 assert.equal(dailyBudget(0),null);
 assert.equal(costBudgetStatus(11.2,dailyBudget(null)).state,'unknown');
 assert.equal(costBudgetStatus(32.7,dailyBudget(300)).percent,218);
 assert.throws(()=>dailyBudget(300,0));
});

test('preset selection follows actual settings and clears when customized',()=>{
 for(const [key,preset] of Object.entries(presets))assert.equal(matchingPreset({...preset}),key);
 assert.equal(matchingPreset({...presets.heavyLow,turns:101}),null);
 assert.equal(matchingPreset({...presets.heavyLow,effort:'medium'}),null);
 assert.equal(matchingPreset({...presets.heavyLow,label:'Old label'}),'heavyLow');
});

test('cache maintenance prices seven reads during a 30-minute pause and compares the same resumption',async()=>{
 const {cacheMaintenance}=await import('../src/lib/context-cost.mjs');
 const r=cacheMaintenance({tokens:150000,minutes:30},rates);
 assert.equal(r.interval,3.75);assert.equal(r.times.length,7);
 assert.equal(r.readTokens,1050000);assert.equal(r.promptTokens,70);assert.equal(r.outputTokens,14);
 assert.ok(Math.abs(r.perRefresh-.03008)<1e-10);
 assert.ok(Math.abs(r.maintenance-.21056)<1e-10);
 assert.ok(Math.abs(r.total-.24056)<1e-10);
 assert.equal(r.without,.75);assert.equal(r.warm,true);
 assert.ok(Math.abs(r.difference-.50944)<1e-10);
});
test('maintenance cap can expire before resumption, and no resumption loses the maintenance spend',async()=>{
 const {cacheMaintenance}=await import('../src/lib/context-cost.mjs');
 const r=cacheMaintenance({tokens:150000,minutes:30,cap:3},rates);
 assert.equal(r.times.length,3);assert.equal(r.warm,false);assert.equal(r.resume,.75);
 assert.ok(Math.abs(r.difference+r.maintenance)<1e-10);
 const off=cacheMaintenance({tokens:150000,minutes:30,cap:0},rates);
 assert.equal(off.maintenance,0);assert.equal(off.difference,0);
});
test('short pause needs no refresh, exact expiry rewrites, and one-hour TTL uses its own tariff',async()=>{
 const {cacheMaintenance}=await import('../src/lib/context-cost.mjs');
 const short=cacheMaintenance({tokens:150000,minutes:3.75},rates);
 assert.deepEqual(short.times,[]);assert.equal(short.total,.03);assert.equal(short.without,.03);
 assert.equal(cacheMaintenance({tokens:150000,minutes:5,cap:0},rates).resume,.75);
 const hour=cacheMaintenance({tokens:150000,minutes:60,ttlMinutes:60},{...rates,cacheWrite1h:8});
 assert.deepEqual(hour.times,[42.25]);assert.equal(hour.without,1.2);assert.equal(hour.warm,true);
});
test('unknown maintenance tariffs propagate only when used and invalid settings fail',async()=>{
 const {cacheMaintenance}=await import('../src/lib/context-cost.mjs');
 const missing={...rates,cacheRead:null};
 assert.equal(cacheMaintenance({tokens:150000,minutes:30},missing).total,null);
 assert.equal(cacheMaintenance({tokens:150000,minutes:30,cap:0},missing).total,.75);
 assert.equal(cacheMaintenance({tokens:150000,minutes:30},{...rates,input:null}).difference,null);
 assert.throws(()=>cacheMaintenance({tokens:-1,minutes:30},rates));
 assert.throws(()=>cacheMaintenance({tokens:150000,minutes:Infinity},rates));
});

test('repeated pauses multiply costs and tokens and plot each resumption, including a million-token prefix',async()=>{
 const {cacheMaintenanceCycles}=await import('../src/lib/context-cost.mjs');
 const one=cacheMaintenanceCycles({tokens:1000000,minutes:30},rates);
 const ten=cacheMaintenanceCycles({tokens:1000000,minutes:30,cycles:10},rates);
 assert.equal(ten.total,one.total*10);assert.equal(ten.without,50);
 assert.equal(ten.maintenance,one.maintenance*10);assert.equal(ten.resume,2);
 assert.equal(ten.readTokens,70000000);assert.equal(ten.refreshCount,70);
 assert.equal(ten.totalMinutes,300);assert.equal(ten.points.at(-1).cost,ten.total);
 assert.equal(ten.withoutPoints.at(-1).cost,50);assert.equal(ten.withoutPoints.length,11);
 assert.deepEqual(ten.points.filter(p=>p.kind==='resume').map(p=>p.minute),[30,60,90,120,150,180,210,240,270,300]);
});
test('each cycle resets the cap, while expired-cache penalties and unknown prices remain explicit',async()=>{
 const {cacheMaintenanceCycles}=await import('../src/lib/context-cost.mjs');
 const capped=cacheMaintenanceCycles({tokens:150000,minutes:30,cap:3,cycles:5},rates);
 assert.equal(capped.refreshCount,15);assert.equal(capped.warm,false);
 assert.equal(capped.resume,3.75);assert.ok(capped.difference<0);
 const missing=cacheMaintenanceCycles({tokens:150000,minutes:30,cycles:5},{...rates,cacheRead:null});
 assert.equal(missing.total,null);assert.equal(missing.difference,null);
 assert.equal(missing.without,3.75);
 for(const cycles of [0,-1,1.5,101,Infinity])assert.throws(()=>cacheMaintenanceCycles({tokens:150000,minutes:30,cycles},rates));
});
