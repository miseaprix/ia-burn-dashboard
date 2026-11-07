import { normalizeModelRequest } from '../domain/model-request.js';
import { claudeCostFromTokens, codexModelCost } from '../domain/pricing.js';

function mergeClaudeEvidence(capture, report) {
  if (capture.harness !== 'claude' || capture.captureSource !== 'claude-capture' ||
      report.harness !== 'claude' || report.captureSource !== 'provider-report' ||
      capture.granularity !== report.granularity ||
      Math.abs(Date.parse(capture.timestamp) - Date.parse(report.timestamp)) > 120_000) return null;
  const merge = (left, right, keys) => Object.fromEntries(keys.map(key => {
    if (left[key] != null && right[key] != null && left[key] !== right[key]) throw new Error('Conflicting request');
    return [key, left[key] ?? right[key]];
  }));
  return { ...capture,
    ...merge(capture, report, ['provider', 'model', 'gateway', 'orchestrator', 'taskId', 'runId', 'turnId', 'billing', 'durationMs']),
    cost: capture.cost ?? report.cost,
    usage: merge(capture.usage, report.usage, Object.keys(capture.usage)),
  };
}

export function ingestModelRequest(db, body) {
  const request = normalizeModelRequest(body);
  const source = JSON.stringify([request.harness, request.dataset, request.machine]);
  const payload = JSON.stringify(request);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`INSERT INTO monitor_model_requests
      (source,session_id,id,timestamp,task_id,payload) VALUES (?,?,?,?,?,?)
      ON CONFLICT(source,session_id,id) DO NOTHING`).run(source, request.sessionId, request.id, request.timestamp, request.taskId, payload);
    let enriched = false;
    if (result.changes === 0) {
      const old = db.prepare('SELECT payload FROM monitor_model_requests WHERE source=? AND session_id=? AND id=?')
        .get(source, request.sessionId, request.id);
      if (old.payload !== payload) {
        const previous = JSON.parse(old.payload);
        const merged = mergeClaudeEvidence(request, previous) ?? mergeClaudeEvidence(previous, request);
        const codexEnrichment = request.captureSource === 'codex-log' && request.context?.length && previous.context === null &&
          JSON.stringify({ ...request, context: null }) === old.payload;
        if (!merged && !codexEnrichment) throw new Error('Conflicting request');
        const next = merged ?? request;
        const nextPayload = JSON.stringify(next);
        if (nextPayload !== old.payload) {
          db.prepare('UPDATE monitor_model_requests SET payload=?,timestamp=?,task_id=? WHERE source=? AND session_id=? AND id=?')
            .run(nextPayload, next.timestamp, next.taskId, source, request.sessionId, request.id);
          enriched = true;
        }
      }
    }
    const session = {
      source, id: request.sessionId, harness: request.harness, dataset: request.dataset,
      machine: request.machine, startedAt: request.timestamp, ticket: request.taskId,
      eventCount: 0, usage: null, tokens: null, tools: [], agents: [],
    };
    db.prepare(`INSERT INTO monitor_sessions (source,id,started_at,ticket,machine,payload) VALUES (?,?,?,?,?,?)
      ON CONFLICT(source,id) DO NOTHING`)
      .run(source, session.id, session.startedAt, session.ticket, session.machine, JSON.stringify(session));
    db.exec('COMMIT');
    return { duplicate: result.changes === 0 && !enriched, ...(enriched && { enriched }) };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function modelRequests(db, source, sessionId, offset, limit) {
  const rows = db.prepare(`SELECT payload FROM monitor_model_requests WHERE source=? AND session_id=?
    ORDER BY timestamp,id LIMIT ? OFFSET ?`).all(source, sessionId, limit, offset);
  const { total, measuredRequests } = db.prepare(`SELECT COUNT(*) AS total,
    COUNT(CASE WHEN json_array_length(payload,'$.context') > 0 THEN 1 END) AS measuredRequests
    FROM monitor_model_requests WHERE source=? AND session_id=?`).get(source, sessionId);
  const groups = measuredRequests ? db.prepare(`WITH blocks AS (
    SELECT json_extract(block.value,'$.kind') AS kind,
      json_extract(block.value,'$.name') AS name,
      json_extract(block.value,'$.bytes') AS bytes,
      json_extract(block.value,'$.estimatedTokens') AS estimatedTokens
    FROM monitor_model_requests AS request, json_each(request.payload,'$.context') AS block
    WHERE request.source=? AND request.session_id=?
  ), named AS (
    SELECT kind, bytes, estimatedTokens,
      CASE WHEN kind='mcp' AND substr(name,1,5)='mcp__' THEN substr(name,6) END AS qualified
    FROM blocks
  ) SELECT kind,
    CASE WHEN instr(qualified,'__') > 1 THEN substr(qualified,1,instr(qualified,'__')-1) END AS server,
    SUM(bytes) AS bytes, SUM(estimatedTokens) AS estimatedTokens
    FROM named WHERE kind IS NOT NULL GROUP BY kind, server ORDER BY kind, server`).all(source, sessionId) : [];
  return { requests: rows.map(row => JSON.parse(row.payload)), total, offset, limit,
    contextSummary: { measuredRequests, groups } };
}

function estimateRequestCost(row, harness) {
  if (row.input == null || row.output == null || row.cacheRead == null || row.cacheRead > row.input) return null;
  if (harness === 'codex') return codexModelCost(row.model, { input: row.input, output: row.output, cached: row.cacheRead });
  if (harness !== 'claude' || row.cacheWrite == null || row.cacheRead + row.cacheWrite > row.input) return null;
  return claudeCostFromTokens(row.model, { input_tokens: row.input - row.cacheRead - row.cacheWrite,
    output_tokens: row.output, cache_read_input_tokens: row.cacheRead, cache_creation_input_tokens: row.cacheWrite });
}

export function summarizeModelSession(db, source, sessionId, harness) {
  const rows = db.prepare(`SELECT timestamp, json_extract(payload,'$.model') AS model,
    json_extract(payload,'$.turnId') AS turnId, json_extract(payload,'$.granularity') AS granularity,
    json_extract(payload,'$.usage.input') AS input, json_extract(payload,'$.usage.output') AS output,
    json_extract(payload,'$.usage.cacheRead') AS cacheRead, json_extract(payload,'$.usage.cacheWrite') AS cacheWrite,
    json_extract(payload,'$.cost.usd') AS usd, json_extract(payload,'$.cost.basis') AS basis
    FROM monitor_model_requests WHERE source=? AND session_id=? ORDER BY timestamp,id`).iterate(source, sessionId);
  const models = new Set(), turns = new Set();
  const usage = { input: null, output: null, cacheRead: null, cacheWrite: null };
  const costs = { billed: { usd: 0, count: 0 }, estimated: { usd: 0, count: 0 } };
  let measurements = 0, calls = 0, usageCount = 0, completeUsage = 0, lastMeasurementAt = null;
  for (const row of rows) {
    measurements++;
    if (row.granularity === 'request') calls++;
    if (row.model) models.add(row.model);
    if (row.turnId) turns.add(row.turnId);
    lastMeasurementAt = row.timestamp;
    if (row.input != null || row.output != null) usageCount++;
    if (row.input != null && row.output != null) completeUsage++;
    for (const key of Object.keys(usage)) if (row[key] != null) usage[key] = (usage[key] ?? 0) + row[key];
    const usd = row.usd ?? estimateRequestCost(row, harness);
    if (usd != null) {
      const cost = costs[row.basis === 'billed' ? 'billed' : 'estimated'];
      cost.count++;
      cost.usd += usd;
    }
  }
  return { measurements, calls, usageCount, completeUsage, turns: turns.size || null, models: [...models],
    usage, costs, lastMeasurementAt };
}

export function compareTaskRequests(db, source, sessionId) {
  const tasks = db.prepare(`SELECT DISTINCT task_id FROM monitor_model_requests
    WHERE source=? AND session_id=? AND task_id IS NOT NULL ORDER BY task_id LIMIT 2`).all(source, sessionId);
  if (tasks.length !== 1) return null;
  const taskId = tasks[0].task_id;
  const rows = db.prepare(`WITH calls AS (
    SELECT json_extract(payload,'$.orchestrator') AS orchestrator,
      json_extract(payload,'$.harness') AS harness, json_extract(payload,'$.provider') AS provider,
      json_extract(payload,'$.model') AS model, json_extract(payload,'$.billing') AS billing,
      json_extract(payload,'$.gateway') AS gateway, json_extract(payload,'$.captureSource') AS captureSource,
      json_extract(payload,'$.granularity') AS granularity,
      json_extract(payload,'$.runId') AS runId, json_extract(payload,'$.durationMs') AS durationMs,
      json_extract(payload,'$.usage.input') AS input, json_extract(payload,'$.usage.output') AS output,
      json_extract(payload,'$.usage.cacheRead') AS cacheRead, json_extract(payload,'$.usage.cacheWrite') AS cacheWrite,
      json_extract(payload,'$.cost.usd') AS usd, json_extract(payload,'$.cost.basis') AS costBasis
    FROM monitor_model_requests WHERE task_id=?
  ) SELECT orchestrator,harness,provider,model,gateway,billing,captureSource,granularity,COUNT(*) AS calls,
    CASE WHEN COUNT(runId)=COUNT(*) THEN COUNT(DISTINCT runId) END AS runs,
    CASE WHEN COUNT(durationMs)=COUNT(*) THEN SUM(durationMs) END AS durationMs,
    CASE WHEN COUNT(input)=COUNT(*) THEN SUM(input) END AS input,
    CASE WHEN COUNT(output)=COUNT(*) THEN SUM(output) END AS output,
    CASE WHEN COUNT(cacheRead)=COUNT(*) THEN SUM(cacheRead) END AS cacheRead,
    CASE WHEN COUNT(cacheWrite)=COUNT(*) THEN SUM(cacheWrite) END AS cacheWrite,
    CASE WHEN COUNT(usd)=COUNT(*) AND COUNT(DISTINCT costBasis)=1 THEN SUM(usd) END AS usd,
    CASE WHEN COUNT(usd)=COUNT(*) AND COUNT(DISTINCT costBasis)=1 THEN MIN(costBasis) END AS costBasis
    FROM calls GROUP BY orchestrator,harness,provider,model,gateway,billing,captureSource,granularity
    ORDER BY harness,provider,model,gateway,orchestrator,billing,captureSource,granularity`).all(taskId);
  return { taskId, rows };
}
