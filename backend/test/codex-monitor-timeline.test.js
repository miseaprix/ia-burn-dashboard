import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codexMonitorTimeline } from '../src/integrations/codex-monitor-timeline.js';

test('reads dated Codex activity, pages it and omits sensitive transcript fields', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'burn-codex-events-'));
  try {
    const id = '12345678-1234-1234-1234-123456789abc';
    const session = { id, harness: 'codex', dataset: 'personal' };
    const write = async () => {
      const rows = [
        ['session_meta', { id, cwd: '/private/project' }],
        ['event_msg', { type: 'task_started', turn_id: 'first' }],
        ['event_msg', { type: 'item_completed', item: { type: 'UserMessage', id: 'prompt', content: 'private prompt' } }],
        ['event_msg', { type: 'item_completed', item: { type: 'McpToolCall', id: 'mcp', server: 'example', tool: 'query', arguments: 'private arguments', status: 'completed' } }],
        ['event_msg', { type: 'item_completed', item: { type: 'CommandExecution', id: 'shell', command: 'echo private output', status: 'failed' } }],
        ['event_msg', { type: 'task_complete', turn_id: 'first', last_agent_message: 'private answer' }],
        ['event_msg', { type: 'task_started', turn_id: 'second' }],
      ];
      await mkdir(path.join(root, 'sessions'));
      await writeFile(path.join(root, 'sessions', 'rollout-2026-' + id + '.jsonl'), rows.map(([type, payload], i) =>
        JSON.stringify({ type, payload, timestamp: new Date(Date.UTC(2026, 10, 7, 15, 0, i)).toISOString() })).join('\n'));
    };
    await write();
    const data = await codexMonitorTimeline(session, 1, 2, { CODEX_HOME: root });
    assert.equal(data.project, 'project');
    assert.equal(data.turns, 2);
    assert.equal(data.totalEvents, 4);
    assert.deepEqual(data.events.map(event => [event.type, event.tool]), [['PostToolUse', 'example / query'], ['PostToolUseFailure', 'Terminal']]);
    assert.equal(data.events[0].timestamp, '2026-11-07T15:00:03.000Z');
    assert.doesNotMatch(JSON.stringify(data), /private/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
