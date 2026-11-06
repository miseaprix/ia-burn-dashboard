import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claudeTokenCosts, claudeCostFromTokens, codexTokenCosts, codexModelCost } from '../src/domain/pricing.js';
import { usageDetails } from '../src/domain/usage-economics.js';
import { collectLocal } from '../src/integrations/local.js';
import { stateStore, closeStateStores } from '../src/storage/state-store.js';
import { historyDataset } from '../src/config/datasets.js';

test('token cost components reconcile with total including cache duration and fast pricing', () => {
  const claude = { input_tokens: 300000, output_tokens: 100,
    cache_creation: { ephemeral_5m_input_tokens: 20, ephemeral_1h_input_tokens: 30 },
    cache_read_input_tokens: 500, speed: 'fast' };
  const parts = claudeTokenCosts('claude-opus-4-6', claude);
  assert.ok(Math.abs(Object.values(parts).reduce((a, b) => a + b, 0) - claudeCostFromTokens('claude-opus-4-6', claude)) < 1e-10);
  const codex = { input: 100, cached: 70, output: 10 };
  assert.equal(Object.values(codexTokenCosts('gpt-5.2-codex', codex)).reduce((a, b) => a + b, 0), codexModelCost('gpt-5.2-codex', codex));
  assert.equal(claudeTokenCosts('unknown-test-model', claude).input, null);
});

test('detail windows exclude future/old rows and keep unavailable cost types and images unknown', () => {
  const now = new Date('2026-10-10T12:00:00').getTime();
  const row = { agent: 'codex', period: '2026-10-09', tokens: 100, cost: 2,
    breakdown: { input: 10, output: 20, cacheWrite: 0, cacheRead: 70 },
    tokenCosts: { input: 0.1, output: 0.4, cacheWrite: 0, cacheRead: 1.5 }, imageCount: 2 };
  const data = usageDetails([row, { ...row, period: '2026-01-01' }, { ...row, period: '2026-12-01' }], 'codex', now);
  assert.equal(data.daily30d.length, 1);
  assert.equal(data.spendMix.find(m => m.key === 'cacheRead').costPercent, 75);
  assert.equal(data.imageGenerations.count, 2);
  assert.equal(data.imageGenerations.estimatedCost, 0.3);
  const old = usageDetails([{ ...row, tokenCosts: null, imageCount: null }], 'codex', now);
  assert.equal(old.spendMix[0].cost, null);
  assert.equal(old.imageGenerations.count, null);
});

test('image calls deduplicate across files, image-only days persist, and token mix survives deleted logs/restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-image-details-'));
  process.env.STATE_DIR = path.join(root, 'state');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  const dir = path.join(root, 'codex', 'sessions');
  await mkdir(dir, { recursive: true });
  const image = { timestamp: '2026-10-09T12:00:00Z', type: 'response_item',
    payload: { type: 'image_generation_call', id: 'ig_fixture', result: 'must-not-be-retained' } };
  const usage = { timestamp: '2026-10-10T12:00:00Z', type: 'event_msg', payload: { type: 'token_count',
    model: 'gpt-5.2-codex', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 10 } } } };
  const a = path.join(dir, 'a.jsonl'), b = path.join(dir, 'b.jsonl');
  await writeFile(a, [image, image, usage].map(JSON.stringify).join('\n'));
  await writeFile(b, JSON.stringify(image));
  await collectLocal();
  const dataset = historyDataset();
  const before = stateStore().dailyRows(dataset);
  assert.equal(before.find(r => r.period === '2026-10-09').imageCount, 1);
  assert.equal(before.find(r => r.period === '2026-10-09').tokens, 0);
  const tokens = before.find(r => r.period === '2026-10-10');
  assert.equal(Object.values(tokens.tokenCosts).reduce((a, b) => a + b, 0), tokens.cost);
  assert.ok(!JSON.stringify(stateStore().cached('codex-v1', a)).includes('must-not-be-retained'));
  await unlink(a); await unlink(b); closeStateStores();
  await collectLocal();
  assert.deepEqual(stateStore().dailyRows(dataset), before);
  closeStateStores();
});
