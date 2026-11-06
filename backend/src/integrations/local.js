import { loadOpenCodeRows } from './opencode.js';
import { historyDataset } from '../config/datasets.js';
import { stateStore } from '../storage/state-store.js';
// Local-disk provider.
// Reads the mounted Claude Code and Codex JSONL logs directly in Node and maps
// them to the UNIFIED shape, WITH token counts. No child process, no binary.
//
// The parsing and aggregation rules are a port of the agent-burn Rust sources
// (adapter/claude/{paths,daily,mod}.rs, adapter/codex/{paths,parser,aggregate,
// report}.rs, adapter/all/summary.rs):
//   - Claude: <CLAUDE_CONFIG_DIR>/projects/**/*.jsonl, usage blocks under
//     `message.usage`, de-duplicated by (message.id, requestId).
//   - Codex: <CODEX_HOME>/{sessions,archived_sessions}/**/*.jsonl, `token_count`
//     events, de-duplicated by (timestamp, model, token counts).
//   - Days are bucketed in the process' LOCAL timezone (TZ env), as agent-burn does.

import { readdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { ParsedFileCache } from '../storage/file-cache.js';
const claudeFileCache = new ParsedFileCache(
  `claude-v1-${process.env.TZ || 'UTC'}`,
);
const codexFileCache = new ParsedFileCache('codex-v1');
import path from 'node:path';
import { claudeCostFromTokens, codexModelCost, findPricing, claudeTokenCosts, codexTokenCosts } from '../domain/pricing.js';
import { ENTERPRISE_LOCAL, enterpriseDirs } from '../config/enterprise.js';

// ---------------------------------------------------------------- filesystem

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

// Recursively collect files with the given extension. Missing dirs yield [].
async function collectFiles(dir, ext, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(full, ext, out);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}

// Read a file as lines; unreadable files yield [].
async function readLines(file) {
  try {
    return (await readFile(file, 'utf8')).split('\n');
  } catch {
    return [];
  }
}

function splitList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------------- helpers

const isObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const isU64 = (v) => Number.isInteger(v) && v >= 0;
const nonEmptyString = (v) =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

function pad(n) {
  return String(n).padStart(2, '0');
}

// YYYY-MM-DD of a Date in the local timezone.
function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// agent-burn only accepts RFC 3339 timestamps of these shapes (parse_ts_timestamp).
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/;

function parseTimestamp(value) {
  if (typeof value !== 'string' || !RFC3339_RE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

const inRange = (date, start, end) => !start || (date >= start && date <= end);

// ------------------------------------------------------------------- Claude

// Fields agent-burn refuses when written as `"field":null` anywhere in the line.
const UNSUPPORTED_NULL_RE =
  /"(?:id|cwd|model|speed|costUSD|version|sessionId|requestId|isApiErrorMessage|cache_read_input_tokens|cache_creation_input_tokens)":null/;
const SEMVER_PREFIX_RE = /^\d+\.\d+\.\d/;

// Validate the `message` object (usage + optional model/id). Returns null when invalid.
function parseClaudeMessage(message) {
  if (!isObject(message) || !isObject(message.usage)) return null;
  const u = message.usage;
  if (!isU64(u.input_tokens) || !isU64(u.output_tokens)) return null;
  for (const f of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (u[f] !== undefined && !isU64(u[f])) return null;
  }
  if (u.speed !== undefined && u.speed !== 'standard' && u.speed !== 'fast')
    return null;
  if (u.cache_creation !== undefined && !isObject(u.cache_creation))
    return null;
  for (const f of ['model', 'id']) {
    if (message[f] !== undefined && typeof message[f] !== 'string') return null;
  }
  return message;
}

// Validate a direct log line ({timestamp, message, ...}). Returns null when invalid.
function parseClaudeDirect(obj) {
  if (!isObject(obj) || typeof obj.timestamp !== 'string') return null;
  const message = parseClaudeMessage(obj.message);
  if (!message) return null;
  if (obj.costUSD !== undefined && typeof obj.costUSD !== 'number') return null;
  return { raw: obj, message };
}

function cacheCreationCount(u) {
  if (isObject(u.cache_creation)) {
    return (
      (Number(u.cache_creation.ephemeral_5m_input_tokens) || 0) +
      (Number(u.cache_creation.ephemeral_1h_input_tokens) || 0)
    );
  }
  return Number(u.cache_creation_input_tokens) || 0;
}

const claudeTokenTotal = (e) =>
  e.input + e.output + e.cacheCreate + e.cacheRead;

// Turn one JSONL line into a normalized entry, or null when it must be skipped.
function parseClaudeLine(line) {
  if (!line.includes('"usage":{')) return null;
  if (UNSUPPORTED_NULL_RE.test(line)) return null;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  // Either a direct entry, or an agent-progress wrapper (data.message holds the entry).
  let parsed = parseClaudeDirect(obj);
  let version = obj?.version;
  let sessionId = obj?.sessionId;
  if (!parsed && isObject(obj?.data)) {
    parsed = parseClaudeDirect(obj.data.message);
    version = undefined;
    sessionId = undefined;
  }
  if (!parsed) return null;
  const { raw, message } = parsed;

  const ts = parseTimestamp(raw.timestamp);
  if (ts === null) return null;

  // Validity checks (is_valid_daily_usage_entry).
  if (typeof version === 'string' && !SEMVER_PREFIX_RE.test(version))
    return null;
  if (typeof sessionId === 'string' && sessionId === '') return null;
  if (typeof raw.requestId === 'string' && raw.requestId === '') return null;
  if (typeof message.id === 'string' && message.id === '') return null;
  if (typeof message.model === 'string' && message.model === '') return null;

  const u = message.usage;
  const cost =
    typeof raw.costUSD === 'number'
      ? raw.costUSD
      : claudeCostFromTokens(message.model, u);
  let model = null;
  if (typeof message.model === 'string' && message.model !== '<synthetic>') {
    model = u.speed === 'fast' ? `${message.model}-fast` : message.model;
  }
  return {
    date: localDate(new Date(ts)),
    input: u.input_tokens,
    output: u.output_tokens,
    cacheCreate: cacheCreationCount(u),
    cacheRead: u.cache_read_input_tokens || 0,
    cost,
    pricingUsage: { input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
      cache_read_input_tokens: u.cache_read_input_tokens || 0,
      ...(u.cache_creation ? { cache_creation: {
        ephemeral_5m_input_tokens: Number(u.cache_creation.ephemeral_5m_input_tokens) || 0,
        ephemeral_1h_input_tokens: Number(u.cache_creation.ephemeral_1h_input_tokens) || 0 } } : {}),
      ...(u.speed ? { speed: u.speed } : {}) },
    pricingModel: message.model || null,
    costSource: typeof raw.costUSD === 'number' ? 'reported' : 'estimated',
    model,
    speed: u.speed,
    messageId: typeof message.id === 'string' ? message.id : null,
    requestId: typeof raw.requestId === 'string' ? raw.requestId : null,
    sidechain: raw.isSidechain === true,
  };
}

// Should `candidate` replace the already-kept `existing` duplicate?
function shouldReplace(candidate, existing) {
  if (candidate.sidechain !== existing.sidechain) return existing.sidechain;
  const a = claudeTokenTotal(candidate);
  const b = claudeTokenTotal(existing);
  if (a !== b) return a > b;
  if (candidate.cost !== existing.cost) return candidate.cost > existing.cost;
  return candidate.speed !== undefined && existing.speed === undefined;
}

async function loadClaudeRows(claudeDir) {
  const roots = [];
  for (const raw of splitList(claudeDir)) {
    let dir = raw;
    if (path.basename(dir) === 'projects' && (await isDir(dir)))
      dir = path.dirname(dir);
    if ((await isDir(path.join(dir, 'projects'))) && !roots.includes(dir))
      roots.push(dir);
  }
  const files = [];
  for (const root of roots)
    await collectFiles(path.join(root, 'projects'), '.jsonl', files);
  files.push(...claudeFileCache.files(roots).filter((f) => !files.includes(f)));
  files.sort();

  const kept = [];
  const byExact = new Map(); // `${id}\0${requestId|''}` -> index
  const byId = new Map(); // id -> index[]
  for (const file of files) {
    const entries = await claudeFileCache.get(file, async (f) =>
      (await readLines(f)).map(parseClaudeLine).filter(Boolean),
      (entries) => entries.every((e) => e.costSource && e.pricingUsage),
    );
    for (const saved of entries ?? claudeFileCache.archived(file) ?? []) {
      // Prior cache versions used zero for missing prices. Preserve reported
      // zero costs and positive costs; reclassify ambiguous legacy zeros.
      let entry = !saved.costSource && saved.cost === 0 &&
        claudeTokenTotal(saved) > 0 && !findPricing(saved.model)
        ? { ...saved, cost: null } : saved;
      // Reprice normalized counters, including removed logs, without reparsing
      // unchanged files or altering costs explicitly reported by the source.
      if (saved.costSource === 'estimated' && saved.pricingUsage)
        entry = { ...saved, cost: claudeCostFromTokens(saved.pricingModel, saved.pricingUsage) };
      if (entry.messageId === null) {
        kept.push(entry);
        continue;
      }
      const exactKey = `${entry.messageId}\0${entry.requestId ?? ''}`;
      let idx = byExact.get(exactKey);
      if (idx === undefined) {
        // /btw sidechain logs can replay parent messages with new request IDs.
        idx = (byId.get(entry.messageId) || []).find(
          (i) => entry.sidechain || kept[i].sidechain,
        );
      }
      if (idx !== undefined) {
        if (shouldReplace(entry, kept[idx])) kept[idx] = entry;
        continue;
      }
      kept.push(entry);
      const i = kept.length - 1;
      byExact.set(exactKey, i);
      if (!byId.has(entry.messageId)) byId.set(entry.messageId, []);
      byId.get(entry.messageId).push(i);
    }
  }

  // One row per day; model breakdown only for non-synthetic models.
  const days = new Map();
  for (const e of kept) {
    let day = days.get(e.date);
    if (!day) {
      day = {
        period: e.date,
        agent: 'claude',
        tokens: 0,
        cost: 0,
        unknownTokens: 0,
        tokenCosts: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
        models: new Map(),
        breakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
      };
      days.set(e.date, day);
    }
    const tokens = claudeTokenTotal(e);
    day.tokens += tokens;
    day.breakdown.input += e.input;
    day.breakdown.output += e.output;
    day.breakdown.cacheWrite += e.cacheCreate;
    day.breakdown.cacheRead += e.cacheRead;
    const parts = e.costSource === 'estimated' && e.pricingUsage
      ? claudeTokenCosts(e.pricingModel, e.pricingUsage) : {};
    const counts = { input: e.input, output: e.output, cacheWrite: e.cacheCreate, cacheRead: e.cacheRead };
    for (const key of Object.keys(counts)) if (counts[key] > 0)
      day.tokenCosts[key] = day.tokenCosts[key] == null || parts[key] == null
        ? null : day.tokenCosts[key] + parts[key];
    day.cost += e.cost ?? 0;
    if (e.cost == null) day.unknownTokens += tokens;
    if (e.model !== null) {
      const m = day.models.get(e.model) || { cost: 0, tokens: 0, unknownTokens: 0 };
      m.cost += e.cost ?? 0;
      if (e.cost == null) m.unknownTokens += tokens;
      m.tokens += tokens;
      day.models.set(e.model, m);
    }
  }
  return [...days.values()];
}

// -------------------------------------------------------------------- Codex

let autoReviewFallbacks = null;
function loadAutoReviewFallbacks() {
  if (autoReviewFallbacks) return autoReviewFallbacks;
  try {
    autoReviewFallbacks = JSON.parse(
      readFileSync(
        new URL('../data/codex-auto-review-fallbacks.json', import.meta.url),
        'utf8',
      ),
    );
  } catch {
    autoReviewFallbacks = [];
  }
  return autoReviewFallbacks;
}

// Raw Codex usage object -> normalized counters (CodexRawUsage deserializer).
function codexRawUsage(obj) {
  if (!isObject(obj)) return null;
  const num = (...keys) => {
    for (const k of keys) if (isU64(obj[k])) return obj[k];
    return undefined;
  };
  const input = num('input_tokens', 'prompt_tokens', 'input') ?? 0;
  const output = num('output_tokens', 'completion_tokens', 'output') ?? 0;
  const reasoning = num('reasoning_output_tokens', 'reasoning_tokens') ?? 0;
  const cached =
    num('cached_input_tokens', 'cache_read_input_tokens', 'cached_tokens') ?? 0;
  const declared = num('total_tokens');
  const sum = input + output + reasoning;
  const total =
    declared !== undefined && (declared > 0 || sum === 0) ? declared : sum;
  return { input, cached, output, reasoning, total };
}

function subtractUsage(cur, prev) {
  const d = (a, b) => Math.max(0, a - (b || 0));
  return {
    input: d(cur.input, prev?.input),
    cached: d(cur.cached, prev?.cached),
    output: d(cur.output, prev?.output),
    reasoning: d(cur.reasoning, prev?.reasoning),
    total: d(cur.total, prev?.total),
  };
}

// model | model_name | metadata.model of an object.
function modelFromParts(obj) {
  if (!isObject(obj)) return null;
  return (
    nonEmptyString(obj.model) ||
    nonEmptyString(obj.model_name) ||
    nonEmptyString(isObject(obj.metadata) ? obj.metadata.model : null)
  );
}

// Codex event timestamp -> RFC 3339 string with millis, or null.
function codexTimestamp(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    return text || null;
  }
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

// `codex-auto-review` is replaced by the flagship model released at that date.
function autoReviewModel(timestamp) {
  const date = /^\d{4}-\d{2}-\d{2}/.test(timestamp)
    ? timestamp.slice(0, 10)
    : null;
  if (!date) return 'gpt-5';
  const hit = loadAutoReviewFallbacks().find((f) => date >= f.releasedOn);
  return hit ? hit.model : 'gpt-5';
}

// Parse one Codex session file into token-usage events.
async function readCodexSessionFile(file) {
  const lines = await readLines(file);
  const events = [];

  // Sub-agent sessions replay the parent's token_count events within one second.
  let replaySecond = null;
  if (
    lines
      .slice(0, 200)
      .join('\n')
      .slice(0, 16 * 1024)
      .includes('thread_spawn')
  ) {
    let first = null;
    for (const line of lines) {
      if (!line.includes('token_count')) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (obj?.type !== 'event_msg' || obj?.payload?.type !== 'token_count')
        continue;
      const info = obj.payload.info;
      if (
        !isObject(info) ||
        (!isObject(info.last_token_usage) && !isObject(info.total_token_usage))
      )
        continue;
      const ts = codexTimestamp(obj.timestamp);
      if (!ts) continue;
      const second = ts.slice(0, 19);
      if (first === null) first = second;
      else {
        if (first === second) replaySecond = second;
        break;
      }
    }
  }
  let skipReplay = replaySecond !== null;

  let previousTotals = null;
  let currentModel = null;
  for (const line of lines) {
    if (line.includes('image_generation_call')) {
      try {
        const image = JSON.parse(line);
        if (image.payload?.type === 'image_generation_call' && /^ig_/.test(image.payload.id)) {
          events.push({ kind: 'image', id: image.payload.id, timestamp: codexTimestamp(image.timestamp) });
          continue;
        }
      } catch {}
    }
    if (!line.includes('turn_context') && !line.includes('token_count'))
      continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isObject(obj)) continue;
    const payload = isObject(obj.payload) ? obj.payload : null;

    if (obj.type === 'turn_context') {
      const model = modelFromParts(payload);
      if (model) currentModel = model;
      continue;
    }
    if (obj.type !== 'event_msg' || !payload || payload.type !== 'token_count')
      continue;

    const timestamp = codexTimestamp(obj.timestamp);
    if (!timestamp) continue;
    const info = isObject(payload.info) ? payload.info : null;
    const total = info ? codexRawUsage(info.total_token_usage) : null;

    if (skipReplay && timestamp.slice(0, 19) === replaySecond) {
      if (total) previousTotals = total;
      continue;
    }
    skipReplay = false;

    const last = info ? codexRawUsage(info.last_token_usage) : null;
    const raw = last || (total ? subtractUsage(total, previousTotals) : null);
    if (total) previousTotals = total;
    if (!raw) continue;
    if (
      raw.input === 0 &&
      raw.cached === 0 &&
      raw.output === 0 &&
      raw.reasoning === 0
    )
      continue;

    const parsedModel = modelFromParts(payload) || modelFromParts(info);
    if (parsedModel) currentModel = parsedModel;
    let model = parsedModel || currentModel;
    if (!model) {
      model = 'gpt-5'; // fallback model when the log never names one
      currentModel = model;
    }
    if (model === 'codex-auto-review') model = autoReviewModel(timestamp);

    events.push({
      timestamp,
      model,
      input: raw.input,
      cached: Math.min(raw.cached, raw.input),
      output: raw.output,
      reasoning: raw.reasoning,
      total: raw.total,
    });
  }
  return { version: 2, events };
}

async function loadCodexRows(codexHome) {
  // Sources: sessions/ and archived_sessions/ of each home; the home itself as a fallback.
  const sources = [];
  for (const home of splitList(codexHome)) {
    const sessions = path.join(home, 'sessions');
    const archived = path.join(home, 'archived_sessions');
    const hasSessions = await isDir(sessions);
    const hasArchived = await isDir(archived);
    if (hasSessions) sources.push({ dir: sessions, scope: home });
    if (hasArchived) sources.push({ dir: archived, scope: home });
    if (!hasSessions && !hasArchived && (await isDir(home)))
      sources.push({ dir: home, scope: home });
  }

  // A file seen in sessions/ shadows the same relative path in archived_sessions/.
  const seenFiles = new Set();
  const files = [];
  const seenDirs = new Set();
  for (const source of sources) {
    if (seenDirs.has(source.dir)) continue;
    seenDirs.add(source.dir);
    const found = (await collectFiles(source.dir, '.jsonl')).sort();
    for (const file of found) {
      const key = `${source.scope}\0${path.relative(source.dir, file)}`;
      if (seenFiles.has(key)) continue;
      seenFiles.add(key);
      files.push(file);
    }
  }

  files.push(
    ...codexFileCache
      .files(splitList(codexHome))
      .filter((f) => !files.includes(f)),
  );
  const seenEvents = new Set();
  const seenImages = new Set();
  let imageCoverage = true;
  const days = new Map();
  for (const file of files) {
    const cached = (await codexFileCache.get(file, readCodexSessionFile, value => value?.version === 2))
      ?? codexFileCache.archived(file) ?? { version: 2, events: [] };
    if (Array.isArray(cached)) imageCoverage = false;
    for (const ev of Array.isArray(cached) ? cached : cached.events) {
      const ts = parseTimestamp(ev.timestamp);
      if (ts === null) continue;
      if (ev.kind === 'image') {
        if (seenImages.has(ev.id)) continue;
        seenImages.add(ev.id);
        const date = localDate(new Date(ts));
        if (!days.has(date)) days.set(date, { period: date, agent: 'codex', total: 0,
          models: new Map(), imageCount: 0,
          breakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } });
        days.get(date).imageCount = (days.get(date).imageCount || 0) + 1;
        continue;
      }
      const key = [
        ts,
        ev.model,
        ev.input,
        ev.cached,
        ev.output,
        ev.reasoning,
        ev.total,
      ].join('\0');
      if (seenEvents.has(key)) continue;
      seenEvents.add(key);

      const date = localDate(new Date(ts));
      let day = days.get(date);
      if (!day) {
        day = {
          period: date,
          agent: 'codex',
          total: 0,
          models: new Map(),
          breakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
        };
        days.set(date, day);
      }
      day.total += ev.total;
      day.breakdown.input += Math.max(0, ev.input - ev.cached);
      day.breakdown.output += ev.output;
      day.breakdown.cacheRead += ev.cached;
      const m = day.models.get(ev.model) || { input: 0, cached: 0, output: 0 };
      m.input += ev.input;
      m.cached += ev.cached;
      m.output += ev.output;
      day.models.set(ev.model, m);
    }
  }

  // Per-model cost and tokens (non-cached input + cached + output), as in codex_group_row.
  return [...days.values()].map((day) => {
    const models = new Map();
    let cost = 0, unknownTokens = 0;
    const tokenCosts = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
    for (const [name, u] of day.models) {
      const c = codexModelCost(name, u);
      const parts = codexTokenCosts(name, u);
      const counts = { input: Math.max(0, u.input - u.cached), output: u.output, cacheRead: u.cached };
      for (const key of Object.keys(counts)) if (counts[key] > 0)
        tokenCosts[key] = tokenCosts[key] == null || parts[key] == null ? null : tokenCosts[key] + parts[key];
      const tokens = Math.max(0, u.input - u.cached) + u.cached + u.output;
      cost += c ?? 0;
      if (c == null) unknownTokens += tokens;
      models.set(name, {
        cost: c ?? 0,
        unknownTokens: c == null ? tokens : 0,
        tokens,
      });
    }
    return {
      period: day.period,
      agent: 'codex',
      tokens: day.total,
      cost,
      unknownTokens,
      tokenCosts,
      imageCount: imageCoverage ? day.imageCount || 0 : null,
      models,
      breakdown: day.breakdown,
    };
  });
}

export async function collectLocal(source = 'local') {
  const [claude, codex] = await Promise.all([
    loadClaudeRows(source === ENTERPRISE_LOCAL ? enterpriseDirs().claude : (process.env.CLAUDE_CONFIG_DIR || '/data/claude')),
    loadCodexRows(source === ENTERPRISE_LOCAL ? enterpriseDirs().codex : (process.env.CODEX_HOME || '/data/codex')),
  ]);
  const opencode = source === ENTERPRISE_LOCAL ? await loadOpenCodeRows() : [];
  stateStore().saveDaily(historyDataset(source), [...claude, ...codex, ...opencode]);
  return { filesImported: true };
}
