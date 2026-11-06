import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  writeFile,
  rename,
  unlink,
  readFile,
  readdir,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stateStore, closeStateStores } from '../src/storage/state-store.js';
import { ParsedFileCache } from '../src/storage/file-cache.js';
import { nativeQuotaHistory } from '../src/integrations/native-history.js';
import { consistentQuotaSamples } from '../src/domain/quota-history.js';
import {
  drawnQuotaSamples,
  interpolate,
  quotaReading,
  quotaDeltaPoints,
} from '../../frontend/src/lib/quota-chart.js';

test('unchanged logs reuse memory and disk; edits, atomic replacements and removal invalidate the cache', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'burn-cache-'));
  const oldState = process.env.STATE_DIR;
  process.env.STATE_DIR = dir;
  try {
    const file = path.join(dir, 'session.jsonl');
    let loads = 0;
    const loader = async (f) => {
      loads++;
      const x = JSON.parse(await readFile(f, 'utf8'));
      return { tokens: x.tokens };
    };
    await writeFile(
      file,
      JSON.stringify({
        tokens: 2,
        message: 'PRIVATE PROMPT',
        access_token: 'SECRET',
      }),
    );
    const cache = new ParsedFileCache('test');
    const both = await Promise.all([
      cache.get(file, loader),
      cache.get(file, loader),
    ]);
    assert.deepEqual(both, [{ tokens: 2 }, { tokens: 2 }]);
    assert.equal(loads, 1);
    assert.deepEqual(await cache.get(file, loader), { tokens: 2 });
    assert.equal(loads, 1);
    assert.deepEqual(await new ParsedFileCache('test').get(file, loader), {
      tokens: 2,
    });
    assert.equal(loads, 1);
    closeStateStores();
    assert.deepEqual(await new ParsedFileCache('test').get(file, loader), {
      tokens: 2,
    });
    assert.equal(loads, 1);
    const saved = JSON.stringify(stateStore().cached('test', file));
    assert.ok(!/PRIVATE|SECRET|access_token|message/.test(saved));
    await writeFile(file, '{"tokens":100}');
    assert.deepEqual(await cache.get(file, loader), { tokens: 100 });
    assert.equal(loads, 2);
    await writeFile(path.join(dir, 'replacement'), '{"tokens":101}');
    await rename(path.join(dir, 'replacement'), file);
    assert.deepEqual(await cache.get(file, loader), { tokens: 101 });
    assert.equal(loads, 3);
    await unlink(file);
    assert.equal(await cache.get(file, loader), null);
    assert.equal(await cache.get(dir, loader), null);
  } finally {
    closeStateStores();
    if (oldState == null) delete process.env.STATE_DIR;
    else process.env.STATE_DIR = oldState;
  }
});

const now = Date.parse('2026-10-10T12:00:00Z');
const reading = (offset, used, minutes = 10080) => ({
  observedAt: now + offset * 60000,
  window: {
    windowMinutes: minutes,
    usedPercent: used,
    elapsedPercent: 50 + (offset / minutes) * 100,
  },
});
test('native archive selects one source and imports plausible weekly/session readings', () => {
  const a = {
    version: 1,
    readings: {
      host: {
        claude: [reading(-20, 10), reading(-10, 12), reading(-5, 99)],
        'claude-session': [reading(-5, 50, 300)],
        codex: [reading(1, 20)],
      },
    },
  };
  const result = nativeQuotaHistory(a, null, now);
  assert.equal(result.source, 'host');
  assert.equal(result.claude.length, 3);
  assert.equal(
    result.claude.filter((r) => r.reading.weekly).at(-1).reading.weekly
      .usedPercent,
    12,
  );
  assert.equal(result.codex.length, 0);
  a.readings.other = {};
  assert.equal(nativeQuotaHistory(a, null, now).source, null);
  assert.equal(nativeQuotaHistory(a, 'host', now).claude.length, 3);
  assert.equal(
    nativeQuotaHistory({ ...a, version: 2 }, 'host', now).claude.length,
    0,
  );
});
test('quota corrections reject superseded-cycle replays and earlier provider overcounts', () => {
  const start = now - 86400000;
  const row = (t, used, cycle = 0) => ({
    t: new Date(t).toISOString(),
    remaining: 100 - used,
    windowMinutes: 300,
    resetsAt: new Date(start + cycle * 18000000 + 18000000).toISOString(),
  });
  const rows = [
    row(start, 10),
    row(start + 1000, 80),
    row(start + 2000, 12),
    row(start + 18000000, 1, 1),
    row(start + 18001000, 90),
  ];
  assert.deepEqual(
    consistentQuotaSamples(rows).map((x) => x.remaining),
    [90, 88, 99],
  );
});
test('native chart holds plateaus, steps short gaps, interpolates missing periods and forecasts to reset', () => {
  const at = (m) => new Date(now + m * 60000).toISOString();
  const w = {
    start: at(0),
    resetsAt: at(600),
    samples: [
      { t: at(10), remaining: 90 },
      { t: at(20), remaining: 90 },
      { t: at(30), remaining: 80 },
      { t: at(210), remaining: 60 },
    ],
    forecast: { projectedEnd: at(600), projectedRemaining: 20 },
  };
  const points = drawnQuotaSamples(w);
  assert.equal(points[0].remaining, 100);
  assert.equal(interpolate(points, now + 25 * 60000), 90);
  assert.equal(interpolate(points, now + 30 * 60000), 80);
  assert.equal(interpolate(points, now + 120 * 60000), 70);
  const future = quotaReading(w, points, now + 405 * 60000);
  assert.equal(future.projected, true);
  assert.equal(future.value, 40);
  const crossing = quotaDeltaPoints(w, [
    { t: at(0), remaining: 90 },
    { t: at(600), remaining: 10 },
  ]);
  assert.equal(crossing.length, 3);
  assert.equal(crossing[1].delta, 0);
  assert.equal(crossing[1].t, at(300));
});
