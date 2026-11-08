import { createReadStream } from 'node:fs';
import { glob, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { localLogRoots } from '../config/local-profile-roots.js';

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const name = value => typeof value === 'string' && /^[\w.:-]{1,256}$/.test(value) ? value : null;

function itemEvent(item) {
  if (item?.type === 'UserMessage') return { type: 'UserPromptSubmit' };
  const type = item?.status === 'failed' || item?.exit_code > 0 ? 'PostToolUseFailure' : 'PostToolUse';
  if (item?.type === 'McpToolCall') {
    const tool = [name(item.server), name(item.tool)].filter(Boolean).join(' / ');
    return { type, tool: tool || 'MCP' };
  }
  if (item?.type === 'CommandExecution') {
    const command = typeof item.command === 'string' ? name(item.command.trim().split(/\s+/, 1)[0]) : null;
    return { type, tool: 'Terminal', command };
  }
  if (item?.type === 'FileChange') return { type, tool: 'Modification de fichiers' };
  return null;
}

export async function codexMonitorTimeline(session, offset, limit, env = process.env) {
  if (session.harness !== 'codex' || !uuid.test(session.id) ||
      !['personal', 'enterprise'].includes(session.dataset)) return null;
  for (const directory of localLogRoots('codex', session.dataset, env)) {
    for await (const relative of glob(`{sessions,archived_sessions}/**/*-${session.id}.jsonl`, { cwd: directory })) {
      const file = path.join(directory, relative);
      try {
        if (!(await lstat(file)).isFile()) continue;
        const data = await readTimeline(file, session.id, offset, limit);
        if (data) return data;
      } catch { /* Rotated or temporarily unavailable journals do not block session details. */ }
    }
  }
  return null;
}

async function readTimeline(file, id, offset, limit) {
  const events = [], turns = new Set(), seen = new Set();
  let project = null, startedAt = null, lastEventAt = null, totalEvents = 0, confirmed = false;
  const stream = createReadStream(file);
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      const data = row?.payload;
      if (row?.type === 'session_meta') {
        if (data?.id !== id || data.forked_from_id) return null;
        confirmed = true;
        project = typeof data.cwd === 'string' ? path.basename(data.cwd) || null : null;
        if (Number.isFinite(Date.parse(data.timestamp))) startedAt = new Date(data.timestamp).toISOString();
      }
      if (!confirmed || !Number.isFinite(Date.parse(row.timestamp))) continue;
      const timestamp = new Date(row.timestamp).toISOString();
      if (row.type === 'event_msg' && data?.type === 'task_started') {
        if (name(data.turn_id)) turns.add(data.turn_id);
        startedAt ??= timestamp;
      }
      const item = row.type === 'event_msg' && data?.type === 'item_completed' ? data.item : null;
      const observation = item ? itemEvent(item)
        : row.type === 'event_msg' && data?.type === 'task_complete' ? { type: 'Stop' }
          : row.type === 'event_msg' && data?.type === 'turn_aborted' ? { type: 'Interrupt' }
            : row.type === 'compacted' ? { type: 'PostCompact' } : null;
      if (!observation) continue;
      const eventId = name(item?.id) ? `item:${item.id}` : `${observation.type}:${timestamp}:${name(data?.turn_id) ?? ''}`;
      if (seen.has(eventId)) continue;
      seen.add(eventId);
      lastEventAt = timestamp;
      if (totalEvents >= offset && events.length < limit) events.push({ id: eventId, timestamp, ...observation });
      totalEvents++;
    }
  } finally {
    stream.destroy();
  }
  return confirmed ? { events, totalEvents, project, startedAt, lastEventAt, turns: turns.size || null } : null;
}
