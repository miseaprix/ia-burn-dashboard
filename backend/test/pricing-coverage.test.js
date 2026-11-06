import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDashboard, getYearlyHistory } from '../src/services/local-dashboard.js';
import { stateStore, closeStateStores, StateStore } from '../src/storage/state-store.js';
import { DatabaseSync } from 'node:sqlite';
import { claudeCostFromTokens, codexModelCost } from '../src/domain/pricing.js';
import { usageEconomics } from '../src/domain/usage-economics.js';
import { fmtSpend, fmtUsd, bucketDaily } from '../../frontend/src/lib/format.js';

test('missing prices remain unknown across dashboard, yearly history and removed cached logs; reported zero is valid', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-pricing-'));
  process.env.STATE_DIR = path.join(root, 'state');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  process.env.CLAUDE_ACCOUNT_FILE = path.join(root, 'missing');
  const dir = path.join(root, 'claude', 'projects');
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(root, 'codex', 'sessions'), { recursive: true });
  const file = path.join(dir, 'usage.jsonl');
  const line = (id, model, costUSD) => ({ timestamp: '2024-12-31T12:00:00Z',
    message: { id, model, usage: { input_tokens: 100, output_tokens: 50 } },
    ...(costUSD === undefined ? {} : { costUSD }) });
  await writeFile(file, [line('a', 'future-unknown'), line('b', 'reported-free', 0),
    line('c', 'reported-paid', 2), line('d', 'future-unknown', 1)].map(JSON.stringify).join('\n'));
  // A prior cache contains no provenance and cannot distinguish absent prices
  // from explicitly reported zero. Existing logs must be reparsed once.
  const st = await stat(file);
  stateStore().cache(`claude-v1-${process.env.TZ || 'UTC'}`, file,
    `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`, [
      {date: '2024-12-31', input: 999, output: 0, cacheCreate: 0, cacheRead: 0,
        cost: 0, model: 'reported-free', messageId: 'legacy', requestId: null}]);
  const check = async () => {
    await (await import('../src/integrations/local.js')).collectLocal();
    const d = await getDashboard({ range: 'all' });
    assert.equal(d.error, undefined);
    assert.equal(d.totals.tokens, 600);
    assert.equal(d.totals.spend, 3);
    assert.equal(d.totals.costComplete, false);
    assert.equal(d.totals.unknownTokens, 150);
    assert.equal(d.totals.avgTokensPerDollar, null);
    assert.equal(d.models.find(m => m.model === 'future-unknown').spend, null);
    assert.equal(d.models.find(m => m.model === 'future-unknown').knownSpend, 1);
    assert.equal(d.models.find(m => m.model === 'future-unknown').unknownTokens, 150);
    assert.equal(d.models.find(m => m.model === 'reported-free').spend, 0);
    assert.equal(d.models.find(m => m.model === 'reported-free').costComplete, true);
    assert.ok(d.models.every(m => m.share === null));
    assert.equal(d.daily[0].costComplete, false);
    assert.equal(d.harnesses.claude.totals.costComplete, false);
    assert.ok(d.warnings.length);
    const y = getYearlyHistory().years[0];
    assert.equal(y.costComplete, false);
    assert.equal(y.unknownTokens, 150);
    assert.equal(y.spend, 3);
  };
  await check();
  await unlink(file);
  closeStateStores();
  await check();
  closeStateStores();
  assert.equal(claudeCostFromTokens('future-unknown', {}), null);
  assert.equal(codexModelCost('future-unknown', {}), null);
  assert.equal(fmtUsd(null), '—');
  assert.equal(fmtSpend({spend: 3, costComplete: false}), '$3.00 + unknown');
  assert.equal(fmtSpend({spend: 0, costComplete: false}), '—');
  assert.equal(fmtSpend({spend: 0, costComplete: true}), '$0.00');
  for (const mode of ['daily', 'weekly', 'monthly']) {
    const buckets = bucketDaily([{date: '2026-10-10', spend: 3, tokens: 600,
      costComplete: false, unknownTokens: 150}], mode);
    assert.equal(buckets[0].costComplete, false);
    assert.equal(buckets[0].unknownTokens, 150);
    assert.equal(fmtSpend(buckets[0]), '$3.00 + unknown');
  }
});

test('partial pricing disables financial ratios only inside affected windows', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const rows = [{period: '2026-10-10', cost: 2, unknownTokens: 150},
    {period: '2024-01-01', cost: 0, unknownTokens: 100}];
  const weekly = {start: '2026-10-09T00:00:00Z', usedPercent: 20,
    elapsedPercent: 30, windowMinutes: 10080};
  const e = usageEconomics(rows, {pricePerMonth: 20},
    {observedAt: new Date(now).toISOString(), weekly}, now);
  for (const key of ['apiEquivalent30d', 'valueMultiple', 'subsidy', 'discountPercent', 'fullQuotaValue', 'monthlyValue'])
    assert.equal(e[key], null);
  assert.equal(weekly.dollarsPerPercent, null);
  assert.equal(weekly.apiEquivalentSpent, null);
  assert.equal(usageEconomics(rows.slice(1), {pricePerMonth: 20}, null, now).apiEquivalent30d, 0);
});

test('schema v1 migration preserves old rows and caches, labeling unverified historical costs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-migration-'));
  const file = path.join(root, 'burn.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE parsed_files(namespace TEXT,file TEXT,stamp TEXT,payload TEXT,updated_at_ms INTEGER,PRIMARY KEY(namespace,file)) STRICT;
    CREATE TABLE daily_usage(dataset TEXT,day TEXT,harness TEXT,tokens REAL,spend REAL,input REAL,output REAL,cache_write REAL,cache_read REAL,requests REAL,PRIMARY KEY(dataset,day,harness)) STRICT;
    CREATE TABLE daily_models(dataset TEXT,day TEXT,harness TEXT,model TEXT,tokens REAL,spend REAL,PRIMARY KEY(dataset,day,harness,model)) STRICT;
    INSERT INTO daily_usage VALUES('A','2024-01-01','claude',100,2,100,0,0,0,NULL);
    INSERT INTO parsed_files VALUES('old','/logs/removed.jsonl','s','[]',1);
    PRAGMA user_version=1;`);
  old.close();
  let store = new StateStore(file);
  assert.equal(store.yearly('A')[0].spend, 2);
  assert.equal(store.yearly('A')[0].costComplete, false);
  assert.equal(store.yearly('A')[0].unknownTokens, null);
  assert.deepEqual(store.cached('old', '/logs/removed.jsonl').value, []);
  assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  store.close();
  store = new StateStore(file);
  assert.equal(store.yearly('A')[0].tokens, 100);
  store.close();
});
