import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StateStore, stateStore, closeStateStores } from '../src/storage/state-store.js';
import { PricingCatalog } from '../src/integrations/pricing-catalog.js';
import { findPricing, parsePriceCatalog, setPriceCatalogs } from '../src/domain/pricing.js';
import { collectLocal } from '../src/integrations/local.js';
import { historyDataset } from '../src/config/datasets.js';

test('pricing validates units, overrides builtins and keeps unknown versions unknown', () => {
  const prices = parsePriceCatalog({
    sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0 },
    'gpt-5.2-codex': { input_cost_per_token: 3e-6, output_cost_per_token: 8e-6 },
    bad: { input_cost_per_token: -1, output_cost_per_token: 1 },
    missing: { input_cost_per_token: 1 },
    'claude-new-5': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6,
      input_cost_per_token_above_200k_tokens: 2e-6, provider_specific_entry: { fast: 3 } },
  }, 'litellm');
  assert.equal(Object.keys(prices).length, 2);
  setPriceCatalogs({ litellm: prices });
  assert.equal(findPricing('gpt-5.2-codex').input, 3e-6);
  assert.equal(findPricing('claude-new-5-20261010-fast').fastMultiplier, 3);
  assert.equal(findPricing('claude-new-5-1'), null);
  const models = parsePriceCatalog({ anthropic: { models: {
    x: { id: 'new-model', cost: { input: 2, output: 4, cache_read: 0.2 } },
  } } }, 'modelsdev');
  assert.equal(models['new-model'].input, 2e-6);
  assert.equal(models['new-model'].cacheRead, 0.2e-6);
  setPriceCatalogs();
});

test('catalog refresh persists independently, deduplicates, throttles and restores offline after restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-catalog-'));
  const file = path.join(root, 'state.sqlite');
  let store = new StateStore(file), now = 100000, calls = 0;
  const request = async url => {
    calls++;
    if (url.includes('models.dev')) throw new Error('offline');
    return { 'new-priced-model': { input_cost_per_token: 1e-6, output_cost_per_token: 2e-6 } };
  };
  let catalog = new PricingCatalog({ store: () => store, request, now: () => now });
  const first = catalog.refresh();
  assert.equal(first, catalog.refresh());
  await first;
  assert.equal(calls, 2);
  assert.equal(findPricing('new-priced-model').output, 2e-6);
  assert.equal(store.collection('pricing:modelsdev').lastSuccess, null);
  await catalog.refresh();
  assert.equal(calls, 2);
  store.close();
  store = new StateStore(file);
  setPriceCatalogs();
  now += 21600001;
  catalog = new PricingCatalog({ store: () => store, request: async () => ({}), now: () => now });
  await catalog.refresh();
  assert.equal(findPricing('new-priced-model').output, 2e-6);
  assert.equal(store.collection('pricing:litellm').lastSuccess, 100000);
  assert.match(store.collection('pricing:litellm').error, /retaining/);
  store.close();
  setPriceCatalogs();
});

test('new prices revalue unchanged and deleted Claude/Codex cached logs without changing reported costs or tokens', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-reprice-'));
  process.env.STATE_DIR = path.join(root, 'state');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  await mkdir(path.join(root, 'claude', 'projects'), { recursive: true });
  await mkdir(path.join(root, 'codex', 'sessions'), { recursive: true });
  const claude = path.join(root, 'claude', 'projects', 'usage.jsonl');
  const codex = path.join(root, 'codex', 'sessions', 'usage.jsonl');
  const entry = (id, costUSD) => ({ timestamp: '2026-10-01T12:00:00Z',
    message: { id, model: 'reprice-claude', usage: { input_tokens: 100, output_tokens: 50,
      cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 }, speed: 'fast' } },
    ...(costUSD === undefined ? {} : { costUSD }) });
  await writeFile(claude, [entry('a'), entry('b', 0)].map(JSON.stringify).join('\n'));
  await writeFile(codex, JSON.stringify({ type: 'event_msg', timestamp: '2026-10-01T12:00:00Z',
    payload: { type: 'token_count', model: 'reprice-codex', info: {
      last_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 50 } } } }));
  await collectLocal();
  const before = stateStore().dailyRows(historyDataset());
  assert.equal(before.find(r => r.agent === 'claude').unknownTokens, 180);
  const apply = input => setPriceCatalogs({ litellm: parsePriceCatalog({
    'reprice-claude': { input_cost_per_token: input, output_cost_per_token: 2,
      cache_creation_input_token_cost: 3, provider_specific_entry: { fast: 2 } },
    'reprice-codex': { input_cost_per_token: input, output_cost_per_token: 2,
      cache_read_input_token_cost: 0.5 },
  }, 'litellm') });
  apply(1);
  await collectLocal();
  let rows = stateStore().dailyRows(historyDataset());
  assert.equal(rows.find(r => r.agent === 'claude').cost, 540);
  assert.equal(rows.find(r => r.agent === 'codex').cost, 190);
  assert.equal(rows.reduce((sum, r) => sum + r.unknownTokens, 0), 0);
  assert.deepEqual(rows.map(r => r.tokens), before.map(r => r.tokens));
  await unlink(claude);
  await unlink(codex);
  apply(2);
  await collectLocal();
  rows = stateStore().dailyRows(historyDataset());
  assert.equal(rows.find(r => r.agent === 'claude').cost, 820);
  assert.equal(rows.find(r => r.agent === 'codex').cost, 270);
  closeStateStores();
  setPriceCatalogs();
});
