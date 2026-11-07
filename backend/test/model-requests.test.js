import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { closeStateStores } from '../src/storage/state-store.js';
import { anthropicUsage, claudeContext } from '../../scripts/claude-request-context.mjs';
import { codexLogContext } from '../../scripts/codex-log-context.mjs';

test('Codex separates the catalog, a verified skill read and a failed MCP call', async () => {
  const full = '---\nname: sample\ndescription: Test\n---\nA full instruction.\n';
  const context = codexLogContext({ readSkill: async file => file === '/chosen/SKILL.md' ? full : null });
  const catalog = '<skills_instructions>\n- `r0` = `/chosen`\n### Available skills\n- sample: Test (file: r0/SKILL.md)\n</skills_instructions>';
  const message = (role, text) => ({ type: 'message', role, content: [{ type: 'input_text', text }] });
  await context.add(message('user', catalog.replaceAll('sample', 'pretend')));
  await context.add(message('developer', catalog));
  const catalogOnly = context.snapshot();
  assert.deepEqual(catalogOnly.map(x => [x.name, x.state, x.description]), [['sample', 'description', 'Test']]);
  assert.doesNotMatch(JSON.stringify(catalogOnly), /chosen|SKILL.md/);
  await context.add({ type: 'custom_tool_call', call_id: 'x', name: 'exec', input: 'private args' });
  await context.add({ type: 'custom_tool_call_output', call_id: 'x', output: [{ type: 'input_text', text: full }] });
  context.addMcpEvent({ type: 'McpToolCall', server: 'fixture', tool: 'probe', status: 'failed', error: { message: 'private error' } });
  const activity = context.snapshot();
  assert.deepEqual(activity.map(x => [x.kind, x.state]), [
    ['tool', 'called'], ['tool', 'result'], ['skill', 'full'], ['mcp', 'called'], ['mcp', 'failed'], ['skill', 'description'],
  ]);
  assert.doesNotMatch(JSON.stringify(activity), /private|A full instruction/);
  assert.deepEqual(context.snapshot(), catalogOnly);
  context.clear();
  assert.equal(context.snapshot(), null);
});

test('distinguishes a description, an invocation, and the body received in the next request', async () => {
  const response = { content: [{ type: 'tool_use', id: 'call-1', name: 'Skill', input: { skill: 'example' } }] };
  const initial = { messages: [{ role: 'system', content:
    'The following skills are available for use with the Skill tool:\n- example: Example description\n- name-only' }] };
  const first = await claudeContext(initial, response, {});
  assert.deepEqual(first.blocks.filter(block => block.kind === 'skill').map(block => block.state), ['description', 'name', 'called']);
  const next = { messages: [
    ...initial.messages,
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'call-1', content: 'Launching skill: example' },
      { type: 'text', text: 'Base directory for this skill: /approved/example\n\nTwo lines.\nSecond line.' },
    ] },
  ] };
  const followUp = await claudeContext(next, {}, {
    previous: first.fingerprints, seen: first.fingerprints, knownCalls: first.calls,
    readSkill: async () => 'Two lines.\nSecond line.',
  });
  const skill = followUp.blocks.filter(block => block.name === 'example');
  assert.deepEqual(skill.map(block => [block.state, block.repeated, block.firstSeen]), [
    ['description', true, false], ['full', false, true],
  ]);
  assert.ok((await claudeContext(next, {}, { knownCalls: first.calls })).blocks.some(block => block.state === 'body' && block.kind === 'skill'));
  assert.equal(anthropicUsage({ input_tokens: 7, cache_creation_input_tokens: 3, cache_read_input_tokens: 11 }).input, 21);
});

test('imports a request idempotently and compares the same task across harnesses without storing raw payloads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'burn-model-test-'));
  const oldDir = process.env.STATE_DIR, oldEnabled = process.env.MONITOR_INGEST_ENABLED;
  process.env.STATE_DIR = dir;
  process.env.MONITOR_INGEST_ENABLED = '1';
  const app = await buildApp({ collector: { start() {}, async stop() {}, status() { return {}; }, intervals: {} } });
  const url = '/api/monitor/model-requests';
  const headers = { host: 'localhost' };
  const send = (payload, requestHeaders = headers) => app.inject({ method: 'POST', url, headers: requestHeaders, payload });
  try {
    const request = {
      schemaVersion: 1, id: 'req-1', dataset: 'personal', machine: 'test', sessionId: 'session',
      harness: 'claude', captureSource: 'claude-capture', provider: 'anthropic', model: 'claude',
      timestamp: '2026-11-07T15:00:00Z', taskId: 'paperclip:test-task', runId: 'run-1',
      usage: { input: 123, output: 9 }, raw: 'DO_NOT_STORE',
      context: [{ kind: 'skill', state: 'full', name: 'example', bytes: 41, description: 'DO_NOT_STORE' }],
    };
    assert.equal((await send(request, { host: 'elsewhere.example' })).statusCode, 403);
    assert.equal((await send(request)).json().duplicate, false);
    assert.equal((await send(request)).json().duplicate, true);
    assert.equal((await send({ ...request, usage: { input: 200 } })).statusCode, 400);
    const codex = { ...request, harness: 'codex', provider: 'openai', model: 'gpt', captureSource: 'codex-log',
      runId: 'run-2', usage: { input: 80, output: 4, cacheRead: 3 }, context: null };
    assert.equal((await send(codex)).statusCode, 200);
    const enriched = { ...codex, context: [{ kind: 'skill', state: 'description', name: 'fixture', bytes: 40 }] };
    assert.equal((await send({ ...enriched, usage: { input: 90 } })).statusCode, 400);
    assert.equal((await send(enriched)).json().enriched, true);
    assert.equal((await send(enriched)).json().duplicate, true);
    assert.equal((await send(codex)).statusCode, 400);
    const query = new URLSearchParams({ source: JSON.stringify(['claude','personal','test']), id: 'session' });
    const result = await app.inject({ url: `${url}?${query}`, headers });
    assert.equal(result.statusCode, 200);
    assert.equal(result.json().total, 1);
    assert.equal(result.json().requests[0].context[0].estimatedTokens, 11);
    assert.deepEqual(result.json().comparison.rows.map(row => [row.harness, row.input, row.cacheRead]), [
      ['claude', 123, null], ['codex', 80, 3],
    ]);
    assert.ok(!result.body.includes('DO_NOT_STORE'));
    assert.equal((await app.inject({ url: `/api/monitor/session?${query}`, headers })).json().totalEvents, 0);
    const history = await app.inject({ method: 'POST', url: '/api/monitor/events', headers, payload: {
      schema_version: 1, event_id: 'history-start', session_id: 'history', type: 'SessionStart',
      harness: 'claude', dataset: 'personal', machine_id: 'test', timestamp: request.timestamp,
    } });
    assert.equal(history.statusCode, 200);
    const all = await app.inject({ url: '/api/monitor', headers });
    assert.equal(all.json().summary.sessions, 3);
    assert.equal(all.json().sessions.find(session => session.id === 'history').modelRequestCount, 0);
    const measured = await app.inject({ url: '/api/monitor?modelOnly=1', headers });
    assert.equal(measured.json().summary.sessions, 2);
    assert.deepEqual(measured.json().sessions.map(session => session.modelRequestCount), [1, 1]);
  } finally {
    await app.close();
    closeStateStores();
    rmSync(dir, { recursive: true, force: true });
    if (oldDir === undefined) delete process.env.STATE_DIR; else process.env.STATE_DIR = oldDir;
    if (oldEnabled === undefined) delete process.env.MONITOR_INGEST_ENABLED; else process.env.MONITOR_INGEST_ENABLED = oldEnabled;
  }
});
