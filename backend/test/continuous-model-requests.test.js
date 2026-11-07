import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { collectClaudeCaptures, claudeTranscriptRequests } from '../../scripts/collect-model-requests.mjs';
import { summarizeOpenCodeRequest } from '../../scripts/opencode-request-capture.mjs';

test('summarizes a DeepSeek wire request without retaining messages or tool schemas', async () => {
  const body = {
    model: 'deepseek-flash', messages: [{ role: 'system', content: 'PRIVATE RULE' },
      { role: 'user', content: 'PRIVATE PROMPT' }],
    tools: [{ type: 'function', function: { name: 'example', description: 'PRIVATE SCHEMA' } }],
  };
  const context = await summarizeOpenCodeRequest(body);
  assert.deepEqual(context.map(block => [block.kind, block.state, block.name]), [
    ['tool', 'schema', 'example'], ['system', 'body', 'Message système'], ['message', 'body', 'user'],
  ]);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE/);
});

test('keeps a capture on receiver failure and advances only after acknowledgment', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'burn-capture-')));
  try {
    const row = {
      session_id: 'session', request_id: 'request', timestamp: '2026-11-07T12:00:00Z',
      request_file: path.join(root, 'fixture.request.json'), response_file: path.join(root, 'fixture.response.json'),
    };
    const index = path.join(root, 'index.jsonl');
    const request = { model: 'claude', system: 'private instructions' };
    await writeFile(row.request_file, JSON.stringify(request));
    await writeFile(row.response_file, JSON.stringify({ usage: { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 } }));
    await writeFile(index, JSON.stringify(row) + '\n{"incomplete":');
    const state = {};
    let attempts = 0;
    const send = async payload => {
      attempts++;
      assert.equal(payload.id, 'request');
      assert.equal(payload.usage.input, 10);
      assert.equal(payload.context[0].kind, 'system');
      assert.doesNotMatch(JSON.stringify(payload), /private instructions/);
      if (attempts === 1) throw new Error('receiver unavailable');
    };
    await assert.rejects(collectClaudeCaptures(root, state, send), /receiver unavailable/);
    assert.equal(await readFile(row.request_file, 'utf8'), JSON.stringify(request));
    await collectClaudeCaptures(root, state, send);
    await assert.rejects(readFile(row.request_file), { code: 'ENOENT' });
    await appendFile(index, 'true}\n');
    await collectClaudeCaptures(root, state, send);
    assert.equal(attempts, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uses one measurement per Claude request and ignores synthetic errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'burn-transcript-'));
  try {
    const row = { type: 'assistant', sessionId: 'session', requestId: 'request', timestamp: '2026-11-07T12:00:00Z',
      message: { model: 'claude', usage: { input_tokens: 3, output_tokens: 1, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 } } };
    const file = path.join(root, 'session.jsonl');
    await writeFile(file, [row, row, { ...row, requestId: 'error', message: { ...row.message, model: '<synthetic>' } }].map(x => JSON.stringify(x)).join('\n'));
    const rows = await Array.fromAsync(claudeTranscriptRequests(file));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'request');
    assert.equal(rows[0].usage.input, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
