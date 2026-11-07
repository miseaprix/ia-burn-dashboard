import { glob, lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { normalizeModelRequest } from '../backend/src/domain/model-request.js';
import { anthropicUsage, claudeContext } from './claude-request-context.mjs';
import { codexRequests, fileWithin, openCodeRequests, records } from './import-model-requests.mjs';

const oneMinute = 60_000;
const local = new Set(['localhost', '127.0.0.1', '[::1]']);
const missing = error => error.code === 'ENOENT';

async function removeCaptureFiles(root, filenames = []) {
  for (const filename of filenames) {
    try {
      await unlink(await fileWithin(root, filename));
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
}

export async function collectClaudeCaptures(directory, state, send, save = async () => {}) {
  let root, index;
  try {
    root = await realpath(directory);
    index = await open(await fileWithin(root, 'index.jsonl', Infinity), 'r');
  } catch (error) {
    if (missing(error)) return;
    throw error;
  }
  try {
    await removeCaptureFiles(root, state.cleanup);
    state.cleanup = [];
    const stat = await index.stat();
    const identity = `${stat.dev}:${stat.ino}`;
    if (state.identity !== identity || state.offset > stat.size) state.offset = 0;
    state.identity = identity;

    // Bound each scan and never commit the offset of an unterminated line.
    const bytes = Buffer.alloc(Math.min(stat.size - state.offset, 1024 * 1024));
    const { bytesRead } = await index.read(bytes, 0, bytes.length, state.offset);
    let start = 0;
    while (start < bytesRead) {
      const end = bytes.indexOf(10, start);
      if (end === -1 || end >= bytesRead) break;
      let row;
      try { row = JSON.parse(bytes.subarray(start, end)); } catch {}
      const count = end + 1 - start;
      if (row?.session_id && row.request_id && row.timestamp &&
          typeof row.request_file === 'string' && row.request_file.endsWith('.request.json') &&
          typeof row.response_file === 'string' && row.response_file.endsWith('.response.json')) {
        try {
          const files = await Promise.all([row.request_file, row.response_file].map(file => fileWithin(root, file)));
          const [requestBytes, responseBytes] = await Promise.all(files.map(file => readFile(file)));
          const request = JSON.parse(requestBytes), response = JSON.parse(responseBytes);
          const detail = await claudeContext(request, response, {});
          await send({
            harness: 'claude', provider: 'anthropic', captureSource: 'claude-capture', granularity: 'request',
            id: row.request_id, sessionId: row.session_id, timestamp: row.timestamp,
            model: response.model || request.model || row.model,
            requestBytes: requestBytes.length, usage: anthropicUsage(response.usage),
            context: detail.blocks.map(block => ({ ...block, firstSeen: null })),
          });
          state.cleanup = files;
        } catch (error) {
          if (!(error instanceof SyntaxError) && error.status !== 400) throw error;
          // Retain rejected bodies locally, without blocking later captures.
          console.error('IA Burn: capture Claude rejetée. Les fichiers sont conservés localement.');
        }
      }
      state.offset += count;
      try {
        await save();
      } catch (error) {
        state.offset -= count;
        state.cleanup = [];
        throw error;
      }
      await removeCaptureFiles(root, state.cleanup);
      state.cleanup = [];
      start = end + 1;
    }
  } finally {
    await index.close();
  }
}

export async function* claudeTranscriptRequests(file) {
  const seen = new Set();
  for await (const row of records(file)) {
    const message = row.message;
    if (row.type !== 'assistant' || row.isApiErrorMessage || !row.sessionId || !row.requestId ||
        !message?.model || message.model === '<synthetic>' || !message.usage || !Number.isFinite(Date.parse(row.timestamp))) continue;
    const key = JSON.stringify([row.sessionId, row.requestId]);
    if (seen.has(key)) continue;
    seen.add(key);
    yield {
      harness: 'claude', provider: 'anthropic', captureSource: 'provider-report', granularity: 'request',
      id: row.requestId, sessionId: row.sessionId, timestamp: row.timestamp, model: message.model,
      usage: anthropicUsage(message.usage),
    };
  }
}

function loopback(url, pathname) {
  const endpoint = new URL(url);
  if (endpoint.protocol !== 'http:' || !local.has(endpoint.hostname) || endpoint.username || endpoint.password ||
      endpoint.search || endpoint.hash || endpoint.pathname !== pathname) throw new Error('Use a local endpoint');
  return endpoint.href;
}

async function fetchLocal(url, options) {
  const response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return response.json();
}

function paperclipLookup(url, datasets) {
  if (!url) return async () => null;
  const base = loopback(url, '/api/');
  let runs = [], loadedAt = 0;
  const finished = new Map();
  return async row => {
    if (Date.now() - loadedAt >= 15_000) {
      const companies = await fetchLocal(base + 'companies');
      const lists = await Promise.all(companies.map(company => fetchLocal(base + 'companies/' +
        encodeURIComponent(company.id) + '/heartbeat-runs?limit=100&summary=true')));
      runs = lists.flat();
      loadedAt = Date.now();
    }
    const time = Date.parse(row.timestamp);
    const candidates = runs.filter(run =>
      Date.parse(run.startedAt) <= time && (!run.finishedAt || time <= Date.parse(run.finishedAt) + 1000));
    const details = await Promise.all(candidates.map(async run => {
      if (finished.has(run.id)) return finished.get(run.id);
      const detail = await fetchLocal(base + 'heartbeat-runs/' + encodeURIComponent(run.id));
      if (detail.finishedAt) {
        if (finished.size >= 500) finished.delete(finished.keys().next().value);
        finished.set(run.id, { id: detail.id, issueId: detail.issueId, companyId: detail.companyId,
          sessionIdBefore: detail.sessionIdBefore, sessionIdAfter: detail.sessionIdAfter,
          usageJson: { billingType: detail.usageJson?.billingType } });
      }
      return detail;
    }));
    const matches = details.filter(run => run.sessionIdBefore === row.sessionId || run.sessionIdAfter === row.sessionId);
    if (matches.length !== 1) return null;
    const run = matches[0];
    const dataset = datasets?.[run.companyId];
    return { orchestrator: 'Paperclip', taskId: run.issueId, runId: run.id,
      ...(dataset ? { dataset, billing: dataset === 'personal' && run.usageJson?.billingType === 'subscription_included' ? 'subscription' : null } : {}) };
  };
}

export async function runCollector(config, stateFile) {
  const endpoint = loopback(config.receiver, '/api/monitor/model-requests');
  const since = Date.parse(config.since);
  if (!Number.isFinite(since)) throw new Error('Set an activation timestamp');
  const machine = config.machine || hostname();
  const lookup = paperclipLookup(config.paperclip, config.paperclipDatasets);
  const state = await readFile(stateFile, 'utf8').then(JSON.parse).catch(error => {
    if (missing(error)) return {};
    throw error;
  });
  const stamps = new Map();
  const reported = new Set();
  const save = async () => {
    const temporary = stateFile + '.tmp';
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, stateFile);
  };
  async function send(row, dataset, attributes = {}) {
    const body = normalizeModelRequest({
      schemaVersion: 1, machine, dataset, ...row, ...attributes,
    });
    await fetchLocal(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  async function classify(row, explicitPaperclip = false) {
    try {
      const attribution = await lookup(row);
      if (attribution) return attribution;
    } catch (error) {
      if (explicitPaperclip) throw error;
    }
    if (explicitPaperclip && Date.now() - Date.parse(row.timestamp) < 5 * oneMinute)
      throw new Error('waiting for Paperclip attribution');
    return explicitPaperclip ? { orchestrator: 'Paperclip' } : {};
  }
  async function changed(file, collect, wal) {
    const stat = await lstat(file);
    if (!stat.isFile() || Math.max(stat.mtimeMs, wal?.mtimeMs ?? 0) < since) return;
    const stamp = `${stat.mtimeMs}:${stat.size}:${wal?.mtimeMs ?? 0}:${wal?.size ?? 0}`;
    if (stamps.get(file) === stamp) return;
    if (await collect()) stamps.set(file, stamp);
  }
  async function fromLogs(source, pattern, read, grace = 0) {
    const root = source.directory;
    for await (const relative of glob(pattern, { cwd: root })) {
      const file = path.join(root, relative);
      await guarded(file, () => changed(file, async () => {
        let settled = true;
        for await (const row of read(file)) {
          const time = Date.parse(row.timestamp);
          if (time < since) continue;
          if (Date.now() - time < grace) { settled = false; continue; }
          const billing = source.billing ? { billing: source.billing } : {};
          try {
            await send(row, source.dataset, { ...billing, ...await classify(row) });
          } catch (error) {
            if (error.status !== 400) throw error;
            console.error('IA Burn: mesure de journal rejetée par le récepteur.');
          }
        }
        return settled;
      }));
    }
  }
  async function guarded(key, collect) {
    try {
      await collect();
      reported.delete(key);
    } catch (error) {
      if (!missing(error) && !reported.has(key)) {
        console.error(`IA Burn: source en attente (${error.code || (error.message === 'waiting for Paperclip attribution' ? 'Paperclip' : 'import')})`);
        reported.add(key);
      }
    }
  }

  for (;;) {
    for (const source of config.claudeCaptures ?? []) {
      const capture = state[source.directory] ??= {};
      await guarded(source.directory, () => collectClaudeCaptures(source.directory, capture, async row => {
        const attributes = await classify(row, source.paperclip);
        await send(row, source.dataset, { ...(source.billing ? { billing: source.billing } : {}), ...attributes });
      }, save));
    }
    for (const source of config.claudeLogs ?? [])
      await guarded(source.directory, () => fromLogs(source, 'projects/**/*.jsonl', claudeTranscriptRequests, oneMinute));
    for (const source of config.codexLogs ?? [])
      await guarded(source.directory, () => fromLogs(source, '{sessions,archived_sessions}/**/*.jsonl',
        file => codexRequests({ 'codex-log': file })));
    if (config.openCodeDb) await guarded(config.openCodeDb, async () => {
      const wal = await lstat(config.openCodeDb + '-wal').catch(error => {
        if (!missing(error)) throw error;
      });
      await changed(config.openCodeDb, async () => {
        for (const row of openCodeRequests({ 'opencode-db': config.openCodeDb, since })) {
          const dataset = config.openCodeProviders?.[row.provider];
          if (dataset) await send(row, dataset);
        }
        return true;
      }, wal);
    });
    if (config.openCodeCapture) await guarded(config.openCodeCapture, async () => {
      const root = await realpath(config.openCodeCapture);
      for await (const name of glob('*.json', { cwd: root })) await guarded(path.join(root, name), async () => {
        const file = await fileWithin(root, name);
        const row = JSON.parse(await readFile(file, 'utf8'));
        await send(row, row.dataset, await classify(row));
        await unlink(file);
      });
    });
    await delay(15_000);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configFile = process.argv[2] || path.join(homedir(), '.local/state/ia-burn/collector.json');
  const stateFile = path.join(path.dirname(configFile), 'collector-state.json');
  try {
    process.umask(0o077);
    await mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    await runCollector(JSON.parse(await readFile(configFile, 'utf8')), stateFile);
  } catch {
    console.error('IA Burn: configuration du collecteur indisponible.');
    process.exitCode = 1;
  }
}
