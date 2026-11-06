import test from 'node:test';
import assert from 'node:assert/strict';
import {dashboard,integrations,monitoring,requests} from '../src/demo/data.mjs';
import {apiFetch} from '../src/demo/transport.js';
const now=new Date('2026-10-12T12:00:00Z');
test('synthetic budget and daily/model totals agree, with simple amounts',()=>{
  const d=dashboard(new URLSearchParams('source=enterprise&range=mtd'),{now});
  assert.equal(d.totals.spend,120);assert.equal(d.budget.limit,300);assert.equal(d.budget.remaining,180);
  assert.equal(d.models.reduce((n,m)=>n+m.spend,0),120);
  assert.equal(d.budgetBurndown.remainingPct,60);
  assert.equal(d.budget.monthStart,'2026-10-01');
  assert.ok(d.daily.every(row=>row.spend%10===0));
});
test('period selection and harness totals remain consistent',()=>{
  const d=dashboard(new URLSearchParams('source=enterprise-local&range=week'),{now});
  assert.equal(d.daily.length,7);
  assert.equal(d.groups.reduce((n,g)=>n+g.spend,0),d.totals.spend);
  assert.equal(Object.values(d.harnesses).reduce((n,h)=>n+h.totals.spend,0),d.totals.spend);
  const custom=dashboard(new URLSearchParams('source=local&range=custom&from=2026-10-10&to=2026-10-11'),{now});
  assert.deepEqual(custom.daily.map(d=>d.date),['2026-10-10','2026-10-11']);
  for(const h of Object.values(d.harnesses))assert.equal(h.models.reduce((n,m)=>n+m.spend,0),h.totals.spend);
});
test('lower levels show activation rather than fictitious collected metrics',()=>{
  assert.deepEqual(dashboard(new URLSearchParams('source=local'),{now,level:1}).harnesses,{});
  assert.equal(integrations(1).personal.observed.codex,false);
  assert.equal(monitoring(2).summary.events,0);
  assert.equal(requests(2).requests.length,0);
  assert.equal(monitoring(3).summary.sessions,3);
});
test('demo transport never calls fetch, rejects unknown endpoints, keeps changes only in memory',async()=>{
  globalThis.window={location:{search:'?level=3'}};
  const original=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('Network access forbidden');};
  try {
    const r=await apiFetch('/api/dashboard?source=enterprise&range=mtd');assert.equal(r.status,200);
    const saved=await (await apiFetch('/api/admin/settings',{method:'PUT',body:JSON.stringify({budget:500,apiKey:'DO-NOT-STORE'})})).json();
    assert.equal(saved.budget,500);assert.equal(saved.hasApiKey,false);assert.ok(!JSON.stringify(saved).includes('DO-NOT-STORE'));
    assert.equal((await apiFetch('https://example.invalid/unknown')).status,404);
    const controller=new AbortController();controller.abort();await assert.rejects(apiFetch('/api/dashboard',{signal:controller.signal}),{name:'AbortError'});
  } finally {globalThis.fetch=original;delete globalThis.window;}
});
test('Pages exposes the dated published reference without network or simulated paid measurements',async()=>{
 globalThis.window={location:{search:'?page=context'}};
 const original=globalThis.fetch;globalThis.fetch=()=>{throw new Error('No network');};
 try{
  const catalog=await (await apiFetch('/api/context/models')).json();
  assert.equal(catalog.reference,true);assert.equal(catalog.models.length,4);
  assert.ok(catalog.updatedAt.startsWith('2026-01-15'));
  assert.ok(catalog.models.some(m=>m.id===catalog.defaultModel));
  const matrix=await (await apiFetch('/api/admin/calibration/matrix')).json();
  const cells=matrix.models.flatMap(m=>m.cells).filter(c=>c.status==='observed');
  assert.equal(cells.length,8);assert.ok(cells.every(c=>c.provenance==='reference'));
  assert.ok(cells.some(c=>c.measuredCost===0));
  assert.ok(cells.every(c=>!c.billingBefore && !c.runId && !c.responseId));
  const before=JSON.stringify(matrix);
  assert.equal((await apiFetch('/api/admin/calibration',{method:'POST',body:'{}'})).status,403);
  assert.equal((await apiFetch('/api/admin/calibration/reconcile',{method:'POST',body:'{}'})).status,403);
  assert.equal(JSON.stringify(await (await apiFetch('/api/admin/calibration/matrix')).json()),before);
 }finally{globalThis.fetch=original;delete globalThis.window;}
});
test('demo enterprise source shows the fictional Acme AI example',async()=>{
  globalThis.window={location:{search:''}};
  try {
    const config=await (await apiFetch('/api/config')).json();
    assert.deepEqual(config.enterprise,{label:'Acme AI',enabled:true});
  } finally {delete globalThis.window;}
  const d=dashboard(new URLSearchParams('source=enterprise&range=mtd'),{now});
  assert.deepEqual(d.models.map(m=>m.model),['example-large','example-medium']);
  assert.equal(d.groups[0].label,'Acme AI gateway');
});
