import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore } from '../src/storage/state-store.js';

test('SQLite retains years, isolates datasets, updates corrections without duplicates and reopens durably', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-years-')),
    file = path.join(root, 'burn.sqlite');
  let db = new StateStore(file);
  const row = (day, tokens, spend) => ({
    period: day,
    agent: 'claude',
    tokens,
    cost: spend,
    breakdown: { input: tokens },
    models: new Map([['claude-test', { tokens, cost: spend }]]),
  });
  const rows = [
    row('2024-01-03', 10, 1),
    row('2025-12-31', 20, 2),
    row('2026-01-01', 30, 3),
  ];
  db.saveDaily('A', rows);
  db.saveDaily('A', rows);
  db.saveDaily('B', [row('2024-01-03', 999, 99)]);
  assert.deepEqual(
    db.yearly('A').map((r) => [r.year, r.tokens, r.spend, r.models]),
    [
      ['2024', 10, 1, 1],
      ['2025', 20, 2, 1],
      ['2026', 30, 3, 1],
    ],
  );
  db.saveDaily('A', [row('2025-12-31', 25, 2.5)]);
  assert.equal(db.yearly('A')[1].tokens, 25);
  assert.equal(db.yearly('B')[0].tokens, 999);
  db.saveDaily('corporate', [
    { period: '2025-01-01', agent: 'enterprise', tokens: null, cost: 3 },
  ]);
  assert.equal(db.yearly('corporate')[0].tokens, null);
  assert.equal(db.yearly('corporate')[0].models, null);
  db.cache('claude', '/logs/past.jsonl', 'stamp', [{ tokens: 10 }]);
  db.close();
  db = new StateStore(file);
  assert.equal(db.yearly('A').length, 3);
  assert.deepEqual(db.cached('claude', '/logs/past.jsonl').value, [
    { tokens: 10 },
  ]);
  assert.deepEqual(db.files('claude', ['/logs']), ['/logs/past.jsonl']);
  assert.deepEqual(db.files('claude', ['/other']), []);
  assert.equal(db.db.prepare('PRAGMA user_version').get().user_version, 7);
  assert.equal(db.db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(
    db.db.prepare('PRAGMA integrity_check').get().integrity_check,
    'ok',
  );
  db.close();
});
