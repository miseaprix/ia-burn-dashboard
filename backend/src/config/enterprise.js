// Enterprise gateway source: a configurable label tied to an enterprise API key.
export const ENTERPRISE = 'enterprise';
export const ENTERPRISE_LOCAL = 'enterprise-local';

// Backward compatibility: names used by the former accorgpt-burn project.
// The ENTERPRISE_* name always wins; legacy names are read only as fallbacks.
export const LEGACY_ENV = {
  ENTERPRISE_BUDGET: ['ACCOR_GPT_BUDGET'],
  ENTERPRISE_ENV_FILE: ['ACCOR_GPT_ENV_FILE'],
  ENTERPRISE_INSECURE_TLS: ['ACCOR_GPT_INSECURE_TLS'],
  ENTERPRISE_CLAUDE_DIR: ['ACCOR_CLAUDE_DIR'],
  ENTERPRISE_CODEX_DIR: ['ACCOR_CODEX_DIR'],
  ENTERPRISE_OPENCODE_DB: ['ACCOR_OPENCODE_DB'],
};
// Legacy source ids, still accepted on input and migrated in the state store.
export const LEGACY_SOURCE = { accorgpt: ENTERPRISE, 'accorgpt-local': ENTERPRISE_LOCAL };
const LEGACY_OPENCODE_PROVIDERS = ['accorgpt', 'accorgpt-openai'];

export function enterpriseEnv(name, env = process.env) {
  for (const key of [name, ...(LEGACY_ENV[name] || [])])
    if (env[key] != null && env[key] !== '') return env[key];
  return undefined;
}

export function enterpriseLabel(env = process.env) {
  const label = (env.ENTERPRISE_LABEL || '').trim();
  return label && label.length <= 64 ? label : 'Enterprise';
}

export function enterpriseDirs(env = process.env) {
  return {
    claude: enterpriseEnv('ENTERPRISE_CLAUDE_DIR', env) || '/data/claude-enterprise',
    codex: enterpriseEnv('ENTERPRISE_CODEX_DIR', env) || '/data/codex-enterprise',
    opencodeDb: enterpriseEnv('ENTERPRISE_OPENCODE_DB', env) || '/data/opencode/opencode.db',
  };
}

// OpenCode stores all providers in one database: only listed provider ids count.
// Without ENTERPRISE_OPENCODE_PROVIDERS, a legacy deployment (ACCOR_OPENCODE_DB set)
// keeps its former provider ids; otherwise no OpenCode provider is selected.
export function enterpriseOpenCodeProviders(env = process.env) {
  if (env.ENTERPRISE_OPENCODE_PROVIDERS != null)
    return env.ENTERPRISE_OPENCODE_PROVIDERS.split(',').map(s => s.trim()).filter(Boolean);
  return LEGACY_ENV.ENTERPRISE_OPENCODE_DB.some(k => env[k]) ? [...LEGACY_OPENCODE_PROVIDERS] : [];
}

export function normalizeSource(value) {
  return LEGACY_SOURCE[value] || value;
}
