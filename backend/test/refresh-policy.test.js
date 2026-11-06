import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshDelay, refreshOnReturn } from '../../frontend/src/lib/refresh-policy.js';

test('live refresh respects visibility-return policy and server midnight; past custom dates stay fixed', () => {
  const now = Date.parse('2026-10-10T21:59:50Z');
  const relative = {includesToday:true,intervalMs:60000,relative:true,nextBoundary:'2026-10-10T22:00:00Z'};
  assert.equal(refreshDelay(relative, now), 10100);
  assert.equal(refreshOnReturn(relative, now), true);
  const past = {...relative, includesToday:false};
  assert.equal(refreshDelay(past, now), 10100);
  assert.equal(refreshOnReturn(past, now), false);
  assert.equal(refreshOnReturn(past, now+11000), true);
  const fixed = {...past, relative:false};
  assert.equal(refreshDelay(fixed, now), Infinity);
  assert.equal(refreshOnReturn(fixed, now+11000), false);
  assert.equal(refreshDelay({...fixed,includesToday:true}, now), 60000);
});
