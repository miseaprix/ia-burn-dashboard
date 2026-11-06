import { createHash } from 'node:crypto';
import { corporateConfig } from './corporate-config.js';
import { ENTERPRISE, ENTERPRISE_LOCAL, enterpriseDirs } from './enterprise.js';
export function historyDataset(source = 'local', env = process.env) {
  const dirs = enterpriseDirs(env), enterprise = source === ENTERPRISE_LOCAL;
  return (
    source + '-' +
    createHash('sha256')
      .update(
        JSON.stringify([
          env.USAGE_HISTORY_DATASET || 'default',
          enterprise ? dirs.claude : (env.CLAUDE_CONFIG_DIR || '/data/claude'),
          enterprise ? dirs.codex : (env.CODEX_HOME || '/data/codex'),
          env.TZ || 'UTC',
          ...(enterprise ? [dirs.opencodeDb] : []),
        ]),
      )
      .digest('hex')
  );
}
export async function corporateDataset() {
  const config = await corporateConfig();
  return ENTERPRISE + '-' + createHash('sha256').update((config.baseUrl || '') + '|' +
    (process.env.USAGE_HISTORY_DATASET || 'default') + (config.historyScope ? '|' + config.historyScope : '')).digest('hex');
}
