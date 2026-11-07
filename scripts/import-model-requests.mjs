import { createReadStream } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { normalizeModelRequest } from '../backend/src/domain/model-request.js';
import { anthropicUsage, claudeContext } from './claude-request-context.mjs';
import { codexLogContext } from './codex-log-context.mjs';

const maxBytes = 32 * 1024 * 1024;
function beneath(root, file) {
  const relative = path.relative(root, file);
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
}
export async function fileWithin(root, filename, limit = maxBytes) {
  if (typeof filename !== 'string') throw new Error('Missing capture file');
  const file = path.resolve(root, filename);
  if (!beneath(root, file)) throw new Error('File is outside the selected directory');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.size > limit || !beneath(root, await realpath(file))) throw new Error('Invalid input file');
  return file;
}
export async function* records(file) {
  const stream = createReadStream(file);
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); } catch { /* An active writer may have left a partial line. */ }
    }
  } finally {
    stream.destroy();
  }
}

async function* claudeRequests(options) {
  const root = await realpath(options['claude-dir']);
  const skillsRoot = options['skills-dir'] ? await realpath(options['skills-dir']) : null;
  const sessions = new Map();
  async function readSkill(directory) {
    if (!skillsRoot || !path.isAbsolute(directory)) return null;
    try {
      const source = await fileWithin(skillsRoot, path.join(directory, 'SKILL.md'));
      return (await readFile(source, 'utf8')).replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/, '');
    } catch { return null; }
  }
  for await (const row of records(await fileWithin(root, 'index.jsonl'))) {
    if (!row.session_id || !row.request_id || options.session && options.session !== row.session_id) continue;
    const files = await Promise.all([row.request_file, row.response_file].map(file => fileWithin(root, file)));
    const [requestBytes, responseBytes] = await Promise.all(files.map(file => readFile(file)));
    const request = JSON.parse(requestBytes), response = JSON.parse(responseBytes);
    const previous = sessions.get(row.session_id);
    const seen = previous?.seen ?? new Set();
    const detail = await claudeContext(request, response, {
      previous: previous?.fingerprints, knownCalls: previous?.calls, seen, readSkill,
    });
    for (const hash of detail.fingerprints) seen.add(hash);
    const calls = new Map([...(previous?.calls ?? []), ...detail.calls]);
    sessions.set(row.session_id, { fingerprints: detail.fingerprints, calls, seen });
    yield {
      harness: 'claude', captureSource: 'claude-capture', granularity: 'request',
      sessionId: row.session_id, id: row.request_id, timestamp: row.timestamp,
      model: response.model || request.model || row.model,
      requestBytes: requestBytes.length, usage: anthropicUsage(response.usage), context: detail.blocks,
    };
  }
}

export async function* codexRequests(options) {
  let session, turn, model, provider;
  const skillsRoot = options['skills-dir'] ? await realpath(options['skills-dir']) : null;
  const context = codexLogContext({ readSkill: skillsRoot ? async file => {
    if (!path.isAbsolute(file) || path.basename(file) !== 'SKILL.md') return null;
    try { return await readFile(await fileWithin(skillsRoot, file), 'utf8'); }
    catch { return null; }
  } : undefined });
  const seen = new Set();
  for await (const row of records(options['codex-log'])) {
    const data = row.payload ?? {};
    if (row.type === 'session_meta') {
      session = data.id;
      provider = data.model_provider;
      if (data.forked_from_id) throw new Error('Use an original Codex session log');
    }
    if (row.type === 'turn_context') {
      turn = data.turn_id;
      model = data.model;
    }
    if (row.type === 'compacted') context.clear();
    if (row.type === 'event_msg' && data.type === 'task_started') context.resetTurn();
    if (row.type === 'event_msg' && data.type === 'item_completed') context.addMcpEvent(data.item);
    if (row.type === 'response_item') await context.add(data);
    if (row.type !== 'event_msg' || data.type !== 'token_count' || !session || !data.info?.last_token_usage) continue;
    if (options.session && options.session !== session) continue;
    const usage = data.info.last_token_usage;
    const total = data.info.total_token_usage?.total_tokens;
    if (!Number.isSafeInteger(total) || total <= 0 || seen.has(total)) continue;
    const expected = new Date(row.timestamp);
    if (!Number.isFinite(+expected)) continue;
    seen.add(total);
    yield {
      harness: 'codex', captureSource: 'codex-log', granularity: 'request',
      sessionId: session, id: `codex-total-${total}`, timestamp: expected.toISOString(),
      turnId: turn, model, provider, context: context.snapshot(), usage: {
        input: usage.input_tokens, output: usage.output_tokens, cacheRead: usage.cached_input_tokens,
        cacheWrite: usage.cache_write_input_tokens, reasoning: usage.reasoning_output_tokens,
      },
    };
  }
}

export function* openCodeRequests(options) {
  if (!options.session && !options.since) throw new Error('Use --session for an OpenCode import');
  const db = new DatabaseSync(options['opencode-db'], { readOnly: true });
  try {
    const rows = options.session
      ? db.prepare("SELECT id,session_id,data FROM session_message WHERE session_id=? AND type='assistant' ORDER BY seq").iterate(options.session)
      : db.prepare("SELECT id,session_id,data FROM session_message WHERE type='assistant' AND json_extract(data,'$.time.completed')>=? ORDER BY seq").iterate(options.since);
    for (const row of rows) {
      const message = JSON.parse(row.data);
      if (!message.time?.completed || !message.tokens) continue;
      const created = new Date(message.time.created);
      const duration = message.time.completed - message.time.created;
      const { input, output, reasoning, cache } = message.tokens;
      const inputParts = [input, cache?.read, cache?.write];
      yield {
        harness: 'opencode', captureSource: 'opencode-message', granularity: 'message',
        sessionId: row.session_id, id: row.id, timestamp: created.toISOString(),
        provider: message.model?.providerID, model: message.model?.id, durationMs: Number.isSafeInteger(duration) && duration >= 0 ? duration : null,
        usage: {
          input: inputParts.every(Number.isSafeInteger) ? inputParts.reduce((a,b)=>a+b,0) : null,
          output: Number.isSafeInteger(output) && Number.isSafeInteger(reasoning) ? output + reasoning : null,
          cacheRead: cache?.read, cacheWrite: cache?.write, reasoning,
        },
      };
    }
  } finally {
    db.close();
  }
}

async function main() {
  const { values: options } = parseArgs({ options: Object.fromEntries([
    'claude-dir','codex-log','opencode-db','session','skills-dir','dataset','machine','provider','gateway','billing','task','run','orchestrator','url',
  ].map(key => [key, { type: 'string' }])) });
  const modes = [['claude-dir', claudeRequests], ['codex-log', codexRequests], ['opencode-db', openCodeRequests]]
    .filter(([key]) => options[key]);
  if (modes.length !== 1 || !['personal','enterprise','unclassified'].includes(options.dataset))
    throw new Error('Choose one import source and --dataset');
  if (options['claude-dir'] && (options.task || options.run) && !options.session)
    throw new Error('Choose the Claude session when attributing a task or run');
  const url = new URL(options.url || 'http://localhost:4095/api/monitor/model-requests');
  if (url.protocol !== 'http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== '/api/monitor/model-requests')
    throw new Error('Use the local model request receiver');
  const seen = new Set();
  let imported = 0, duplicates = 0, enriched = 0;
  for await (const row of modes[0][1](options)) {
    const key = JSON.stringify([row.sessionId,row.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const payload = {
      schemaVersion: 1, ...row, dataset: options.dataset, machine: options.machine || hostname(),
      provider: options.provider || row.provider, gateway: options.gateway, billing: options.billing, taskId: options.task,
      runId: options.run, orchestrator: options.orchestrator,
    };
    normalizeModelRequest(payload);
    const response = await fetch(url, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Receiver returned HTTP ${response.status}`);
    const status = await response.json();
    if (status.enriched) enriched++;
    else if (status.duplicate) duplicates++;
    else imported++;
  }
  console.log(JSON.stringify({ imported, duplicates, enriched }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  if (/^Receiver returned HTTP \d+$/.test(error.message)) console.error(error.message);
  else console.error('Import failed. Check the source, metadata and local receiver.');
  process.exitCode = 1;
});
