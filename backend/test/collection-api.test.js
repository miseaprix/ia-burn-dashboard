import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Collector } from '../src/services/collector.js';
import { stateStore, closeStateStores } from '../src/storage/state-store.js';
import { historyDataset } from '../src/config/datasets.js';
import { buildApp } from '../src/app.js';
import { periodRequest } from '../src/domain/period.js';
import { rangeToDates } from '../src/domain/providers.js';

async function temporaryState() {
  process.env.STATE_DIR = await mkdtemp(path.join(os.tmpdir(), 'burn-collection-'));
}
test('collector serializes overlapping runs, schedules independently and retains last success after failure/restart', async () => {
  await temporaryState();
  let now = 10000, count = 0, release, fail = false;
  const job = new Collector({now: () => now, intervals: {local: 1000}, tasks: {
    local: async () => {count++; if (fail) throw new Error('sensitive vendor response');
      return await new Promise(resolve => {release = () => resolve({count});});},
  }});
  const a = job.run('local'), b = job.run('local');
  assert.equal(a, b);
  release(); await a;
  assert.equal(count, 1);
  await job.run('local'); assert.equal(count, 1);
  now += 1000; fail = true; await job.run('local');
  assert.equal(job.status('local').lastSuccess, 10000);
  assert.equal(stateStore().collection('local').value.count, 1);
  assert.ok(!job.status('local').error.includes('sensitive'));
  closeStateStores();
  assert.equal(stateStore().collection('local').value.count, 1);
  assert.equal(stateStore().collection('local').lastSuccess, 10000);
  await job.stop(); closeStateStores();
});

test('dashboard requests only read stored metrics; custom past dates disable live refresh and retain cost coverage', async () => {
  await temporaryState();
  let calls = 0;
  const collector = new Collector({tasks: {local: async () => {calls++;}}});
  const today = rangeToDates('today').end;
  stateStore().saveDaily(historyDataset(), [{period: today, agent: 'claude', tokens: 100,
    cost: 2, unknownTokens: 20, models: new Map([['unpriced', {tokens:100,cost:2,unknownTokens:20}]])},
    {period: '2024-12-31', agent:'claude', tokens:50,cost:1,models:new Map()}]);
  stateStore().saveCollection('local', {lastSuccess:Date.now(),lastAttempt:Date.now()});
  const app = await buildApp({collector});
  const current = (await app.inject('/api/dashboard?range=week')).json();
  assert.equal(current.error, undefined, JSON.stringify(current));
  assert.equal(current.refresh.includesToday, true);
  assert.equal(current.refresh.intervalMs, 60000);
  assert.equal(current.totals.unknownTokens, 20);
  assert.equal(current.collection.usage.running, false);
  const history = (await app.inject('/api/dashboard?range=custom&from=2024-12-31&to=2024-12-31')).json();
  assert.equal(history.totals.tokens, 50);
  assert.equal(history.refresh.relative, false);
  assert.equal(history.refresh.includesToday, false);
  assert.equal(history.refresh.intervalMs, null);
  assert.equal(history.harnesses.claude.burndown, null);
  assert.equal(calls, 0);
  assert.equal((await app.inject('/api/dashboard?range=custom&from=2024-02-30&to=2024-03-01')).statusCode, 400);
  assert.equal((await app.inject('/api/dashboard?range=custom&from=2024-12-31&to=2024-01-01')).statusCode, 400);
  await app.close();
});

test('relative seven-day bounds move across midnight while custom bounds remain fixed', () => {
  assert.deepEqual(rangeToDates('week', new Date('2026-10-10T12:00:00')), {start:'2026-10-04',end:'2026-10-10'});
  assert.deepEqual(rangeToDates('week', new Date('2026-10-11T00:00:00')), {start:'2026-10-05',end:'2026-10-11'});
  const fixed = {range:'custom',from:'2026-10-04',to:'2026-10-10'};
  assert.deepEqual(periodRequest(fixed, new Date('2026-10-11T12:00:00')), fixed);
});

test('starting the scheduler ingests without dashboard traffic and stop waits for ongoing work', async () => {
  await temporaryState();
  let finish, calls = 0;
  const collector = new Collector({intervals:{local:60000},tasks:{local:async () => {
    calls++; return await new Promise(resolve => {finish = resolve;});
  }}});
  collector.start(); collector.start();
  assert.equal(calls, 1);
  let stopped = false;
  const closing = collector.stop().then(() => {stopped = true;});
  assert.equal(stopped, false);
  finish({collected:true}); await closing;
  assert.equal(stateStore().collection('local').value.collected, true);
  assert.equal(collector.timers.size, 0);
  closeStateStores();
});
