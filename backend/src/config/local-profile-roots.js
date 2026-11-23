import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { enterpriseDirs } from './enterprise.js';

export function localLogRoots(harness, dataset, env = process.env) {
  const primary = dataset === 'enterprise' ? enterpriseDirs(env)[harness]
    : harness === 'claude' ? env.CLAUDE_CONFIG_DIR || '/data/claude' : env.CODEX_HOME || '/data/codex';
  let extra;
  try {
    extra = JSON.parse(env.IA_BURN_EXTRA_PROFILE_ROOTS || '{}')?.[`${dataset}:${harness}`];
  } catch { /* Preserve the configured primary roots if an override is malformed. */ }
  const roots = primary.split(',').map(root => root.trim()).filter(Boolean);
  const prefix = `/data/extra-profiles/${dataset}/${harness}/`;
  if (Array.isArray(extra)) {
    for (const root of extra)
      if (typeof root === 'string' && root.startsWith(prefix) && /^[a-f0-9]{16}$/.test(root.slice(prefix.length)))
        roots.push(root);
  }
  return [...new Set(roots)];
}

// Host path and optional name of a container root. IA_BURN_PROFILE_LABELS maps
// container path → host path, or → { path, label } for a named collector.json entry.
export function profileLabel(root, env = process.env) {
  let labels = {};
  try { labels = JSON.parse(env.IA_BURN_PROFILE_LABELS || '{}') || {}; } catch { /* fall back to the container path */ }
  const entry = labels[root];
  const host = typeof entry === 'string' && entry ? entry : typeof entry?.path === 'string' ? entry.path : root;
  return { path: host.replace(/^\/(Users|home)\/[^/]+(?=\/|$)/, '~'),
    name: typeof entry?.label === 'string' ? entry.label : null };
}

async function hasJsonl(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return false; }
  if (entries.some(e => e.isFile() && e.name.endsWith('.jsonl'))) return true;
  for (const e of entries) if (e.isDirectory() && await hasJsonl(path.join(dir, e.name))) return true;
  return false;
}

// Roots actually read per dataset and harness, with real existence / log-file status.
export async function logRootsStatus(env = process.env) {
  const logDirs = { claude: ['projects'], codex: ['sessions', 'archived_sessions'] };
  const out = {};
  for (const dataset of ['personal', 'enterprise']) {
    out[dataset] = {};
    for (const harness of ['claude', 'codex']) {
      out[dataset][harness] = await Promise.all(localLogRoots(harness, dataset, env).map(async root => {
        const exists = await stat(root).then(s => s.isDirectory(), () => false);
        let hasLogs = false;
        for (const sub of logDirs[harness]) if (!hasLogs && exists) hasLogs = await hasJsonl(path.join(root, sub));
        const { path: label, name } = profileLabel(root, env);
        return { root, label, name, logDirs: logDirs[harness], exists, hasLogs };
      }));
    }
  }
  return out;
}
