import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { migrateEnterpriseIds } from './enterprise-migration.js';

const stores = new Map();
// Shared SQLite foundation. Cache is disposable; daily metrics have no age limit.
export function stateStore() {
  const file = path.resolve(
    process.env.STATE_DIR || '/data/state',
    'burn.sqlite',
  );
  if (!stores.has(file)) stores.set(file, new StateStore(file));
  return stores.get(file);
}
export function closeStateStores() {
  for (const s of stores.values()) s.close();
  stores.clear();
}
export class StateStore {
  constructor(file) {
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;',
    );
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    if (version > 7) {
      this.db.close();
      throw new Error('Database schema is newer than this application');
    }
    if (version === 0)
      this.db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE parsed_files(namespace TEXT NOT NULL,file TEXT NOT NULL,stamp TEXT NOT NULL,payload TEXT NOT NULL,updated_at_ms INTEGER NOT NULL,PRIMARY KEY(namespace,file)) STRICT;
   CREATE TABLE daily_usage(dataset TEXT NOT NULL,day TEXT NOT NULL,harness TEXT NOT NULL,tokens REAL,spend REAL NOT NULL,input REAL,output REAL,cache_write REAL,cache_read REAL,requests REAL,PRIMARY KEY(dataset,day,harness)) STRICT;
   CREATE TABLE daily_models(dataset TEXT NOT NULL,day TEXT NOT NULL,harness TEXT NOT NULL,model TEXT NOT NULL,tokens REAL NOT NULL,spend REAL NOT NULL,PRIMARY KEY(dataset,day,harness,model)) STRICT;
   CREATE INDEX daily_usage_by_harness ON daily_usage(dataset,harness,day);
   CREATE INDEX daily_models_by_model ON daily_models(dataset,model,day);
   PRAGMA user_version=1;
   COMMIT;`);
    if (version < 2)
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE daily_usage ADD COLUMN cost_complete INTEGER;
        ALTER TABLE daily_usage ADD COLUMN unknown_tokens REAL;
        ALTER TABLE daily_models ADD COLUMN cost_complete INTEGER;
        PRAGMA user_version=2;
        COMMIT;`);
    if (version < 3)
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE collection_state(source TEXT PRIMARY KEY,payload TEXT,last_success_ms INTEGER,last_attempt_ms INTEGER,next_attempt_ms INTEGER,error TEXT) STRICT;
        PRAGMA user_version=3;
        COMMIT;`);
    if (version < 4)
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE daily_models ADD COLUMN unknown_tokens REAL;
        PRAGMA user_version=4;
        COMMIT;`);
    if (version < 5)
      this.db.exec(`BEGIN IMMEDIATE;
        ALTER TABLE daily_usage ADD COLUMN token_costs TEXT;
        ALTER TABLE daily_usage ADD COLUMN image_count INTEGER;
        PRAGMA user_version=5;
        COMMIT;`);
    if (version < 6)
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE monitor_sessions(source TEXT NOT NULL,id TEXT NOT NULL,started_at TEXT NOT NULL,project TEXT,ticket TEXT,machine TEXT,payload TEXT NOT NULL,PRIMARY KEY(source,id)) STRICT;
        CREATE INDEX monitor_sessions_filters ON monitor_sessions(started_at,project,ticket,machine);
        CREATE TABLE monitor_events(source TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT,timestamp TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source,id)) STRICT;
        CREATE INDEX monitor_events_session ON monitor_events(source,session_id,timestamp);
        CREATE TABLE monitor_usage(source TEXT NOT NULL,session_id TEXT NOT NULL,is_final INTEGER NOT NULL,measured_at TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(source,session_id,is_final)) STRICT;
        PRAGMA user_version=6;
        COMMIT;`);
    if (version < 7)
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE monitor_requests(machine TEXT NOT NULL,id TEXT NOT NULL,timestamp TEXT NOT NULL,harness TEXT,session_id TEXT,project TEXT,ticket TEXT,payload TEXT NOT NULL,PRIMARY KEY(machine,id)) STRICT;
        CREATE INDEX monitor_requests_filters ON monitor_requests(timestamp,harness,project,ticket);
        PRAGMA user_version=7;
        COMMIT;`);
    migrateEnterpriseIds(this.db);
    this.cacheRead = this.db.prepare(
      'SELECT stamp,payload FROM parsed_files WHERE namespace=? AND file=?',
    );
    this.cacheWrite = this.db.prepare(
      'INSERT INTO parsed_files VALUES(?,?,?,?,?) ON CONFLICT(namespace,file) DO UPDATE SET stamp=excluded.stamp,payload=excluded.payload,updated_at_ms=excluded.updated_at_ms',
    );
    this.cacheFiles = this.db.prepare(
      'SELECT file FROM parsed_files WHERE namespace=?',
    );
    this.usageWrite = this.db.prepare(
      'INSERT INTO daily_usage VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dataset,day,harness) DO UPDATE SET tokens=excluded.tokens,spend=excluded.spend,input=excluded.input,output=excluded.output,cache_write=excluded.cache_write,cache_read=excluded.cache_read,requests=excluded.requests,cost_complete=excluded.cost_complete,unknown_tokens=excluded.unknown_tokens,token_costs=excluded.token_costs,image_count=excluded.image_count',
    );
    this.modelWrite = this.db.prepare(
      'INSERT INTO daily_models VALUES(?,?,?,?,?,?,?,?)',
    );
    this.modelsDelete = this.db.prepare(
      'DELETE FROM daily_models WHERE dataset=? AND day=? AND harness=?',
    );
    this.usageYears = this.db
      .prepare(`SELECT substr(day,1,4) AS year,harness,SUM(tokens) AS tokens,SUM(spend) AS spend,
      SUM(requests) AS requests,SUM(input) AS input,SUM(output) AS output,SUM(cache_write) AS cacheWrite,SUM(cache_read) AS cacheRead,
      SUM(CASE WHEN cost_complete IS NOT 1 THEN 1 ELSE 0 END) AS incompleteDays,
      SUM(unknown_tokens) AS unknownTokens,
      COUNT(DISTINCT day) AS recordedDays,MIN(day) AS firstDay,MAX(day) AS lastDay
      FROM daily_usage WHERE dataset=? GROUP BY year,harness ORDER BY year,harness`);
    this.modelYears = this.db.prepare(
      'SELECT substr(day,1,4) AS year,harness,COUNT(DISTINCT model) AS models FROM daily_models WHERE dataset=? GROUP BY year,harness',
    );
  }
  cached(namespace, file) {
    const row = this.cacheRead.get(namespace, file);
    return row ? { stamp: row.stamp, value: JSON.parse(row.payload) } : null;
  }
  cache(namespace, file, stamp, value) {
    this.cacheWrite.run(
      namespace,
      file,
      stamp,
      JSON.stringify(value),
      Date.now(),
    );
  }
  files(namespace, roots) {
    return this.cacheFiles
      .all(namespace)
      .map((r) => r.file)
      .filter((file) =>
        roots.some((root) => file.startsWith(path.resolve(root) + path.sep)),
      );
  }
  saveDaily(dataset, rows) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const r of rows) {
        const b = r.breakdown || {};
        this.usageWrite.run(
          dataset,
          r.period,
          r.agent,
          r.tokens,
          r.cost,
          b.input ?? null,
          b.output ?? null,
          b.cacheWrite ?? null,
          b.cacheRead ?? null,
          r.requests ?? null,
          r.unknownTokens > 0 ? 0 : 1,
          r.unknownTokens || 0,
          r.tokenCosts ? JSON.stringify(r.tokenCosts) : null,
          r.imageCount ?? null,
        );
        this.modelsDelete.run(dataset, r.period, r.agent);
        for (const [model, m] of r.models || [])
          this.modelWrite.run(
            dataset,
            r.period,
            r.agent,
            model,
            m.tokens,
            m.cost,
            m.unknownTokens > 0 ? 0 : 1,
            m.unknownTokens || 0,
          );
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  yearly(dataset) {
    const models = new Map(
      this.modelYears
        .all(dataset)
        .map((r) => [r.year + '|' + r.harness, r.models]),
    );
    return this.usageYears
      .all(dataset)
      .map((r) => ({
        ...r,
        costComplete: r.incompleteDays === 0,
        models:
          r.harness === 'enterprise'
            ? null
            : models.get(r.year + '|' + r.harness) || 0,
      }));
  }

  dailyRows(dataset, from = '0000-01-01', to = '9999-12-31') {
    const rows = this.db.prepare('SELECT * FROM daily_usage WHERE dataset=? AND day>=? AND day<=? ORDER BY day,harness').all(dataset, from, to);
    const models = this.db.prepare('SELECT * FROM daily_models WHERE dataset=? AND day>=? AND day<=?').all(dataset, from, to);
    const grouped = new Map();
    for (const m of models) {
      const key = m.day + '|' + m.harness;
      if (!grouped.has(key)) grouped.set(key, new Map());
      grouped.get(key).set(m.model, { tokens: m.tokens, cost: m.spend,
        unknownTokens: m.unknown_tokens ?? (m.cost_complete === 1 ? 0 : m.tokens) });
    }
    return rows.map(r => ({ period: r.day, agent: r.harness, tokens: r.tokens,
      cost: r.spend, requests: r.requests,
      tokenCosts: r.token_costs ? JSON.parse(r.token_costs) : null, imageCount: r.image_count,
      unknownTokens: r.unknown_tokens ?? (r.cost_complete === 1 ? 0 : r.tokens || 0),
      breakdown: { input: r.input, output: r.output, cacheWrite: r.cache_write, cacheRead: r.cache_read },
      models: grouped.get(r.day + '|' + r.harness) || new Map() }));
  }
  collection(source) {
    const row = this.db.prepare('SELECT * FROM collection_state WHERE source=?').get(source);
    return row ? { value: row.payload ? JSON.parse(row.payload) : null,
      lastSuccess: row.last_success_ms, lastAttempt: row.last_attempt_ms,
      nextAttempt: row.next_attempt_ms, error: row.error } : null;
  }
  saveCollection(source, changes) {
    const old = this.collection(source) || {};
    const state = { ...old, ...changes };
    this.db.prepare(`INSERT INTO collection_state VALUES(?,?,?,?,?,?)
      ON CONFLICT(source) DO UPDATE SET payload=excluded.payload,last_success_ms=excluded.last_success_ms,
      last_attempt_ms=excluded.last_attempt_ms,next_attempt_ms=excluded.next_attempt_ms,error=excluded.error`).run(
      source, state.value == null ? null : JSON.stringify(state.value), state.lastSuccess ?? null,
      state.lastAttempt ?? null, state.nextAttempt ?? null, state.error ?? null);
  }

  close() {
    this.db.close();
  }
}
