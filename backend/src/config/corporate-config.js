import { readSettings, storedApiKey } from './admin-settings.js';
import { readFile } from 'node:fs/promises';
import { enterpriseEnv, LEGACY_ENV } from './enterprise.js';

// The workstation file uses shell `export KEY="value"` assignments. Read only
// whitelisted literals; never source it, expand variables or execute commands.
export function parseCorporateEnv(text) {
  const allowed = new Set([
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ENTERPRISE_BASE_URL',
    'ENTERPRISE_BUDGET',
    ...LEGACY_ENV.ENTERPRISE_BUDGET,
  ]);
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (!match || !allowed.has(match[1])) continue;
    let value = match[2];
    if (value.startsWith('"') || value.startsWith("'")) {
      if (value.at(-1) !== value[0]) continue;
      value = value.slice(1, -1);
    }
    if (!value || !/^[A-Za-z0-9_.:\/=?&%+@,-]+$/.test(value)) continue;
    values[match[1]] = value;
  }
  return values;
}

export async function corporateConfig(env = process.env) {
  let file = {};
  const envFile = enterpriseEnv('ENTERPRISE_ENV_FILE', env);
  if (envFile) {
    try {
      file = parseCorporateEnv(await readFile(envFile, 'utf8'));
    } catch {}
  }
  const settings = readSettings();
  return {
    historyScope: settings.corporateScope || null,
    token: storedApiKey(settings) || env.ANTHROPIC_AUTH_TOKEN || file.ANTHROPIC_AUTH_TOKEN || null,
    // No default gateway: without a base URL the enterprise source is disabled.
    baseUrl:
      env.ENTERPRISE_BASE_URL ||
      env.ANTHROPIC_BASE_URL ||
      file.ENTERPRISE_BASE_URL ||
      file.ANTHROPIC_BASE_URL ||
      null,
    budget: settings.budget ?? (enterpriseEnv('ENTERPRISE_BUDGET', env) || enterpriseEnv('ENTERPRISE_BUDGET', file) || '300'),
  };
}
