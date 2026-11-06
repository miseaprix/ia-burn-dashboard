import { createHash } from 'node:crypto';
import { ENTERPRISE, ENTERPRISE_LOCAL, LEGACY_SOURCE } from '../config/enterprise.js';
import { historyDataset } from '../config/datasets.js';

const [LEGACY, LEGACY_LOCAL] = Object.keys(LEGACY_SOURCE);

// Dataset id the former project computed for its workstation source.
export function legacyLocalDataset(env = process.env) {
  return LEGACY_LOCAL + '-' + createHash('sha256').update(JSON.stringify([
    env.USAGE_HISTORY_DATASET || 'default',
    env.ACCOR_CLAUDE_DIR || '/data/claude-accor',
    env.ACCOR_CODEX_DIR || '/data/codex-accor',
    env.TZ || 'UTC',
    env.ACCOR_OPENCODE_DB || '/data/opencode/opencode.db',
  ])).digest('hex');
}

// Renames persisted legacy source ids to the enterprise ids. Idempotent: every
// statement only matches rows still carrying a legacy id. Conflicting rows
// (already written under the new id) keep the new value.
export function migrateEnterpriseIds(db, env = process.env) {
  const like = (v) => v.replace(/[%_\\]/g, '\\$&');
  const renameDataset = (table, from, to) =>
    db.prepare(`UPDATE OR IGNORE ${table} SET dataset=? WHERE dataset=?`).run(to, from);
  const renamePrefix = (table, column, from, to) =>
    db.prepare(`UPDATE OR IGNORE ${table} SET ${column}=? || substr(${column},?) WHERE ${column} LIKE ? ESCAPE '\\'`)
      .run(to, from.length + 1, like(from) + '%');
  const harness = (table) =>
    db.prepare(`UPDATE OR IGNORE ${table} SET harness=? WHERE harness=?`).run(ENTERPRISE, LEGACY);
  const monitorSource = (table) =>
    db.prepare(`UPDATE OR IGNORE ${table} SET source=replace(source,?,?),payload=replace(replace(payload,?,?),?,?) WHERE source LIKE ? ESCAPE '\\'`)
      .run(`,"${LEGACY}",`, `,"${ENTERPRISE}",`, `"dataset":"${LEGACY}"`, `"dataset":"${ENTERPRISE}"`,
        `\\"${LEGACY}\\"`, `\\"${ENTERPRISE}\\"`, `%,"${like(LEGACY)}",%`);
  db.exec('BEGIN IMMEDIATE');
  try {
    const oldLocal = legacyLocalDataset(env), newLocal = historyDataset(ENTERPRISE_LOCAL, env);
    for (const table of ['daily_usage', 'daily_models']) {
      renameDataset(table, oldLocal, newLocal);
      renamePrefix(table, 'dataset', LEGACY_LOCAL + '-', ENTERPRISE_LOCAL + '-');
      renamePrefix(table, 'dataset', LEGACY + '-', ENTERPRISE + '-');
      harness(table);
    }
    for (const [from, to] of Object.entries(LEGACY_SOURCE))
      db.prepare('UPDATE OR IGNORE collection_state SET source=? WHERE source=?').run(to, from);
    for (const table of ['monitor_sessions', 'monitor_events', 'monitor_usage']) monitorSource(table);
    db.prepare('UPDATE monitor_requests SET payload=replace(payload,?,?) WHERE payload LIKE ?')
      .run(`"dataset":"${LEGACY}"`, `"dataset":"${ENTERPRISE}"`, `%"dataset":"${LEGACY}"%`);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
