import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/storage/state-store.js';
import { collectSurface, surfaceView, SURFACE_MAX_AGE } from '../src/integrations/codex-surface.js';

test('surface breakdown survives transient failure and restart, expires and isolates accounts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'burn-surface-'));
  const file = path.join(dir, 'state.sqlite');
  let store = new StateStore(file), calls = 0;
  const fetch = async () => {
    calls++;
    return { units: 'percent', data: [{ date: '2026-10-10',
      product_surface_usage_values: { cli: 12 }, models: [{ model: 'test', credits: 12 }] }] };
  };
  const success = await collectSurface('account-a', 'fixture', fetch, 100000, store);
  assert.equal(success.data.totalPercent, 12);
  await collectSurface('account-a', 'fixture', fetch, 110000, store);
  assert.equal(calls, 1);
  const failure = await collectSurface('account-a', 'fixture', async () => { throw new Error('offline'); }, 160000, store);
  assert.deepEqual(failure.data, success.data);
  assert.equal(failure.status.stale, true);
  assert.equal(failure.status.observedAt, success.status.observedAt);
  store.close();
  store = new StateStore(file);
  const restored = await collectSurface('account-a', null, fetch, 170000, store);
  assert.deepEqual(restored.data, success.data);
  const switched = await collectSurface('account-b', null, fetch, 170000, store);
  assert.equal(switched.data, null);
  assert.equal(switched.status.observedAt, null);
  const expired = surfaceView(store.collection('surface:account-a'), 100000 + SURFACE_MAX_AGE + 1);
  assert.equal(expired.data, null);
  assert.equal(expired.status.unavailable, true);
  store.close();
});

test('unsupported surface units retain the prior snapshot; valid empty/zero results clear prior activity', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'burn-surface-units-'));
  const store = new StateStore(path.join(dir, 'state.sqlite'));
  const fetch = value => async () => value;
  const body = { units: 'percent', data: [{ date: '2026-10-10', product_surface_usage_values: { cli: 10 } }] };
  await collectSurface('a', 'fixture', fetch(body), 100000, store);
  const invalid = await collectSurface('a', 'fixture', fetch({ ...body, units: 'tokens' }), 160000, store);
  assert.equal(invalid.data.totalPercent, 10);
  assert.equal(invalid.status.stale, true);
  const zero = await collectSurface('a', 'fixture', fetch({ units: 'percent', data: [
    { date: '2026-10-10', product_surface_usage_values: { cli: 0 } },
  ] }), 220000, store);
  assert.equal(zero.data.totalPercent, 0);
  assert.equal(zero.status.stale, false);
  const empty = await collectSurface('a', 'fixture', fetch({ units: 'percent', data: [] }), 280000, store);
  assert.equal(empty.data, null);
  assert.equal(empty.status.error, null);
  store.close();
});
