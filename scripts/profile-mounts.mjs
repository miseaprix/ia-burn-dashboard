import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const groups = [
  ['claude', 'personal', 'CLAUDE_DATA_DIR'],
  ['codex', 'personal', 'CODEX_DATA_DIR'],
  ['claude', 'enterprise', 'ENTERPRISE_CLAUDE_DATA_DIR'],
  ['codex', 'enterprise', 'ENTERPRISE_CODEX_DATA_DIR'],
];

function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f\x7f]/.test(value))
    throw new Error('Expected an absolute profile directory');
  const actual = realpathSync(value);
  if (!statSync(actual).isDirectory()) throw new Error('Profile path must be a directory');
  return actual;
}

export function profileMounts(config, env) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Expected a collector configuration');
  const byGroup = new Map();
  const datasets = new Map();
  const volumes = [];
  const extraRoots = {};
  const labels = {};
  const names = new Map();
  // Container path → host path, or { path, label } when the entry names itself.
  const describe = source => names.get(source) ? { path: source, label: names.get(source) } : source;
  function record(harness, dataset, source) {
    const key = `${harness}:${source}`;
    const previous = datasets.get(key);
    if (previous && previous !== dataset) throw new Error('A profile directory cannot belong to both datasets');
    datasets.set(key, dataset);
  }
  function bind(source, target) {
    volumes.push({
      type: 'bind', source: source.replaceAll('$', '$$'), target, read_only: true,
      bind: { create_host_path: false },
    });
  }
  for (const harness of ['claude', 'codex']) {
    const sources = config[`${harness}Logs`] ?? [];
    if (!Array.isArray(sources)) throw new Error('Profile sources must be arrays');
    for (const entry of sources) {
      const dataset = entry?.dataset ?? 'personal';
      if (!entry || !['personal', 'enterprise'].includes(dataset)) throw new Error('Invalid profile dataset');
      if (entry.label != null && (typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 64))
        throw new Error('Profile label must be a short string');
      const source = directory(entry.directory);
      if (entry.label) names.set(source, entry.label.trim());
      record(harness, dataset, source);
      const key = `${dataset}:${harness}`;
      if (!byGroup.has(key)) byGroup.set(key, new Set());
      byGroup.get(key).add(source);
    }
  }
  for (const [harness, dataset, legacy] of groups) {
    const key = `${dataset}:${harness}`;
    const roots = [...(byGroup.get(key) ?? [])];
    const current = env[legacy] ? directory(env[legacy]) : null;
    const base = `/data/${harness}${dataset === 'enterprise' ? '-enterprise' : ''}`;
    if (!roots.length) {
      if (current) { record(harness, dataset, current); labels[base] = describe(current); }
      continue;
    }
    const primary = roots.includes(current) ? current : roots[0];
    labels[base] = describe(primary);
    bind(primary, base);
    for (const source of roots.filter(root => root !== primary)) {
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 16);
      const target = `/data/extra-profiles/${dataset}/${harness}/${hash}`;
      bind(source, target);
      (extraRoots[key] ??= []).push(target);
      labels[target] = describe(source);
    }
  }
  if (config.openCodeDb != null) {
    const db = config.openCodeDb;
    if (typeof db !== 'string' || path.basename(db) !== 'opencode.db')
      throw new Error('Shared OpenCode configuration requires a database named opencode.db');
    const source = directory(path.dirname(db));
    if (!path.isAbsolute(db) || !statSync(path.join(source, 'opencode.db')).isFile())
      throw new Error('Expected an absolute OpenCode database path');
    bind(source, '/data/opencode');
  }
  if (!volumes.length) throw new Error('No dashboard profiles in collector configuration');
  return { services: { 'ia-burn': {
    volumes,
    environment: { IA_BURN_EXTRA_PROFILE_ROOTS: JSON.stringify(extraRoots), IA_BURN_PROFILE_LABELS: JSON.stringify(labels).replaceAll("$", "$$$$") },
  } } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    process.stdout.write(JSON.stringify(profileMounts(config, process.env)));
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Invalid collector JSON' : error.message;
    console.error(`IA Burn profiles: ${message}`);
    process.exitCode = 1;
  }
}
