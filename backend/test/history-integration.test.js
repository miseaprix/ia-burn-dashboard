import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDashboard, getYearlyHistory } from '../src/services/local-dashboard.js';
import { closeStateStores } from '../src/storage/state-store.js';

test('annual history and dashboard retain extracted consumption after source-log removal and database reopen', async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), 'burn-history-integration-'),
  );
  process.env.STATE_DIR = path.join(root, 'state');
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  process.env.CLAUDE_ACCOUNT_FILE = path.join(root, 'missing');
  const dir = path.join(root, 'claude', 'projects');
  await mkdir(dir, { recursive: true });
  await mkdir(path.join(root, 'codex', 'sessions'), { recursive: true });
  const file = path.join(dir, 'past.jsonl');
  await writeFile(
    file,
    JSON.stringify({
      timestamp: '2024-12-31T12:00:00Z',
      message: {
        id: 'id',
        model: 'claude-test',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 0,
        },
      },
      costUSD: 2,
    }) + '\n',
  );
  await (await import('../src/integrations/local.js')).collectLocal();
  const before = await getDashboard({ range: 'all' });
  assert.ok(!before.error, JSON.stringify(before.error));
  assert.equal(before.totals.tokens, 150);
  assert.equal(getYearlyHistory().years[0].year, '2024');
  assert.equal(getYearlyHistory().years[0].spend, 2);
  await unlink(file);
  closeStateStores();
  await (await import('../src/integrations/local.js')).collectLocal();
  const after = await getDashboard({ range: 'all' });
  assert.equal(after.totals.tokens, 150);
  assert.equal(getYearlyHistory().years[0].tokens, 150);
  closeStateStores();
});
