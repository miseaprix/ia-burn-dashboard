import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { profileMounts } from '../../scripts/profile-mounts.mjs';
import { historyDataset } from '../src/config/datasets.js';
import { localLogRoots } from '../src/config/local-profile-roots.js';

test('shared profiles preserve the primary mount and history key while exposing extra journals', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'burn-profiles-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const current = mkdirSync(path.join(root, 'current'), { recursive: true });
  const extra = mkdirSync(path.join(root, 'extra profile'), { recursive: true });
  const { volumes, environment } = profileMounts({
    codexLogs: [extra, current, extra].map(directory => ({ directory, dataset: 'personal' })),
  }, { CODEX_DATA_DIR: current }).services['ia-burn'];

  assert.equal(volumes.length, 2);
  assert.equal(volumes[0].target, '/data/codex');
  assert.equal(path.basename(volumes[0].source), 'current');
  assert.ok(volumes.every(volume => volume.read_only && volume.bind.create_host_path === false));
  assert.deepEqual(localLogRoots('codex', 'personal', environment), ['/data/codex', volumes[1].target]);
  assert.deepEqual(localLogRoots('codex', 'enterprise', environment), ['/data/codex-enterprise']);
  assert.equal(historyDataset('local', environment), historyDataset('local', {}));
});

test('shared profiles reject a journal assigned to both datasets before deployment', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'burn-profile-conflict-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.throws(() => profileMounts({
    claudeLogs: [{ directory, dataset: 'enterprise' }],
  }, { CLAUDE_DATA_DIR: directory }), /both datasets/);
});
