import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { enterpriseEnv, enterpriseLabel, enterpriseDirs, enterpriseOpenCodeProviders, normalizeSource } from '../src/config/enterprise.js';
import { corporateConfig } from '../src/config/corporate-config.js';
import { historyDataset } from '../src/config/datasets.js';
import { legacyLocalDataset } from '../src/storage/enterprise-migration.js';
import { StateStore } from '../src/storage/state-store.js';
import { normalizeMonitorEvent } from '../src/domain/monitor-event.js';

test('enterprise env names win and legacy names remain fallbacks', () => {
  assert.equal(enterpriseEnv('ENTERPRISE_BUDGET', {ACCOR_GPT_BUDGET: '10'}), '10');
  assert.equal(enterpriseEnv('ENTERPRISE_BUDGET', {ACCOR_GPT_BUDGET: '10', ENTERPRISE_BUDGET: '20'}), '20');
  assert.equal(enterpriseEnv('ENTERPRISE_BUDGET', {ENTERPRISE_BUDGET: ''}), undefined);
  assert.deepEqual(enterpriseDirs({}), {claude: '/data/claude-enterprise', codex: '/data/codex-enterprise', opencodeDb: '/data/opencode/opencode.db'});
  assert.equal(enterpriseDirs({ACCOR_CLAUDE_DIR: '/legacy'}).claude, '/legacy');
  assert.equal(enterpriseLabel({}), 'Enterprise');
  assert.equal(enterpriseLabel({ENTERPRISE_LABEL: ' Acme GPT '}), 'Acme GPT');
  assert.equal(normalizeSource('accorgpt-local'), 'enterprise-local');
  assert.equal(normalizeSource('local'), 'local');
});

test('OpenCode enterprise providers are configurable, empty by default', () => {
  assert.deepEqual(enterpriseOpenCodeProviders({}), []);
  assert.deepEqual(enterpriseOpenCodeProviders({ENTERPRISE_OPENCODE_PROVIDERS: 'a, b,,'}), ['a', 'b']);
  assert.deepEqual(enterpriseOpenCodeProviders({ACCOR_OPENCODE_DB: '/x.db'}), ['accorgpt', 'accorgpt-openai']);
  assert.deepEqual(enterpriseOpenCodeProviders({ACCOR_OPENCODE_DB: '/x.db', ENTERPRISE_OPENCODE_PROVIDERS: ''}), []);
});

test('missing base URL disables the enterprise source; legacy env file still read', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-enterprise-env-'));
  const old = process.env.STATE_DIR;
  process.env.STATE_DIR = root;
  try {
    assert.equal((await corporateConfig({ANTHROPIC_AUTH_TOKEN: 't'})).baseUrl, null);
    assert.equal((await corporateConfig({ENTERPRISE_BASE_URL: 'https://e.example'})).baseUrl, 'https://e.example');
    const file = path.join(root, 'legacy.env');
    await writeFile(file, 'export ANTHROPIC_BASE_URL="https://legacy.example"\nexport ACCOR_GPT_BUDGET=450\n');
    const config = await corporateConfig({ACCOR_GPT_ENV_FILE: file});
    assert.equal(config.baseUrl, 'https://legacy.example');
    assert.equal(config.budget, '450');
  } finally {
    if (old == null) delete process.env.STATE_DIR; else process.env.STATE_DIR = old;
    await rm(root, {recursive: true, force: true});
  }
});

test('legacy monitoring dataset id is accepted and normalized', () => {
  const {event, source} = normalizeMonitorEvent({schema_version: 1, harness: 'claude', dataset: 'accorgpt',
    session_id: 's', machine_id: 'm', hook_event_name: 'Stop', event_id: 'e'});
  assert.equal(event.dataset, 'enterprise');
  assert.equal(source, JSON.stringify(['claude', 'enterprise', 'm']));
});

test('startup migration renames persisted legacy ids idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-migrate-')), file = path.join(root, 'burn.sqlite');
  const keys = ['ACCOR_CLAUDE_DIR', 'ENTERPRISE_CLAUDE_DIR', 'ACCOR_CODEX_DIR', 'ENTERPRISE_CODEX_DIR', 'ACCOR_OPENCODE_DB', 'ENTERPRISE_OPENCODE_DB'];
  const old = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  try {
    let store = new StateStore(file);
    const legacyLocal = legacyLocalDataset(), legacyCorporate = 'accorgpt-' + 'f'.repeat(64);
    const day = (period, agent) => ({period, agent, tokens: 5, cost: 1, models: new Map([['m', {tokens: 5, cost: 1}]])});
    store.saveDaily(legacyLocal, [day('2026-01-01', 'claude')]);
    store.saveDaily(legacyCorporate, [day('2026-01-01', 'accorgpt')]);
    store.saveCollection('accorgpt', {value: {ok: 1}, lastSuccess: 1});
    store.saveCollection('accorgpt-local', {lastSuccess: 2});
    const src = JSON.stringify(['claude', 'accorgpt', 'm']);
    store.db.prepare('INSERT INTO monitor_sessions VALUES(?,?,?,?,?,?,?)').run(src, 's', '2026-01-01T00:00:00Z', null, null, 'm',
      JSON.stringify({id: 's', source: src, dataset: 'accorgpt'}));
    store.db.prepare('INSERT INTO monitor_events VALUES(?,?,?,?,?)').run(src, 'e', 's', '2026-01-01T00:00:00Z', JSON.stringify({dataset: 'accorgpt'}));
    store.db.prepare('INSERT INTO monitor_requests VALUES(?,?,?,?,?,?,?,?)').run('m', 'r', '2026-01-01T00:00:00Z', null, null, null, null,
      JSON.stringify({dataset: 'accorgpt'}));
    store.close();

    for (let i = 0; i < 2; i++) { store = new StateStore(file); store.close(); }
    const db = new DatabaseSync(file);
    const datasets = db.prepare('SELECT DISTINCT dataset FROM daily_usage ORDER BY dataset').all().map(r => r.dataset);
    assert.deepEqual(datasets, ['enterprise-' + 'f'.repeat(64), historyDataset('enterprise-local')]);
    assert.deepEqual(db.prepare('SELECT DISTINCT harness FROM daily_models ORDER BY harness').all().map(r => r.harness), ['claude', 'enterprise']);
    assert.deepEqual(db.prepare('SELECT source FROM collection_state ORDER BY source').all().map(r => r.source), ['enterprise', 'enterprise-local']);
    const session = db.prepare('SELECT source,payload FROM monitor_sessions').get();
    assert.equal(session.source, JSON.stringify(['claude', 'enterprise', 'm']));
    assert.deepEqual(JSON.parse(session.payload), {id: 's', source: session.source, dataset: 'enterprise'});
    assert.equal(JSON.parse(db.prepare('SELECT payload FROM monitor_events').get().payload).dataset, 'enterprise');
    assert.equal(JSON.parse(db.prepare('SELECT payload FROM monitor_requests').get().payload).dataset, 'enterprise');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM daily_usage WHERE dataset LIKE 'accorgpt%' OR harness='accorgpt'").get().n, 0);
    db.close();
  } finally {
    for (const k of keys) { if (old[k] == null) delete process.env[k]; else process.env[k] = old[k]; }
    await rm(root, {recursive: true, force: true});
  }
});
