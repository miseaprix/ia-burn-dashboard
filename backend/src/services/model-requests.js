import { normalizeModelRequest } from '../domain/model-request.js';

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
        if (request.captureSource !== 'codex-log' || !request.context?.length || previous.context !== null ||
            JSON.stringify({ ...request, context: null }) !== old.payload) throw new Error('Conflicting request');
        db.prepare('UPDATE monitor_model_requests SET payload=? WHERE source=? AND session_id=? AND id=?')
          .run(payload, source, request.sessionId, request.id);
        enriched = true;
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
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM monitor_model_requests WHERE source=? AND session_id=?').get(source, sessionId);
  return { requests: rows.map(row => JSON.parse(row.payload)), total, offset, limit };
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
