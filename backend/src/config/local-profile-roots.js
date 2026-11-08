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
