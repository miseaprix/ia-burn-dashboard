import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { profileMounts } from '../../scripts/profile-mounts.mjs';
import { historyDataset } from '../src/config/datasets.js';
import { localLogRoots, logRootsStatus, profileLabel } from '../src/config/local-profile-roots.js';

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

test('sources status lists the roots actually read, with host labels and real log status', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'burn-roots-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const claude = path.join(root, 'claude-accor');
  mkdirSync(path.join(claude, 'projects', 'p'), { recursive: true });
  writeFileSync(path.join(claude, 'projects', 'p', 's.jsonl'), '{}\n');
  const codex = path.join(root, 'codex-accor');
  mkdirSync(codex);
  const status = await logRootsStatus({
    ENTERPRISE_CLAUDE_DIR: claude, ENTERPRISE_CODEX_DIR: codex, CLAUDE_CONFIG_DIR: path.join(root, 'missing'),
    IA_BURN_PROFILE_LABELS: JSON.stringify({ [claude]: '/Users/me/.claude-accor' }),
  });
  assert.deepEqual(status.enterprise.claude.map(r => [r.label, r.exists, r.hasLogs]), [['~/.claude-accor', true, true]]);
  assert.deepEqual(status.enterprise.codex.map(r => [r.label, r.exists, r.hasLogs]), [[codex, true, false]]);
  assert.equal(status.personal.claude[0].exists, false);
});

test('collector entries default to the personal dataset and carry their label to the dashboard', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'burn-labels-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const main = mkdirSync(path.join(root, 'main'), { recursive: true });
  const other = mkdirSync(path.join(root, 'other'), { recursive: true });
  const { environment } = profileMounts({
    claudeLogs: [{ directory: main }, { directory: other, label: 'Autre' }],
  }, { CLAUDE_DATA_DIR: main }).services['ia-burn'];
  const env = { ...environment, IA_BURN_PROFILE_LABELS: environment.IA_BURN_PROFILE_LABELS.replaceAll('$$', '$') };
  const [first, second] = localLogRoots('claude', 'personal', env);
  assert.equal(first, '/data/claude');
  assert.equal(profileLabel(second, env).name, 'Autre');
  assert.equal(profileLabel(first, env).name, null);
});
