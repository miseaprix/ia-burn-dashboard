import { randomUUID } from 'node:crypto';
import { lstat, rename, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';
import { normalizeModelRequest } from '../backend/src/domain/model-request.js';
import { claudeContext } from './claude-request-context.mjs';

const maxBytes = 32 * 1024 * 1024;

function textBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return [];
  return content.map(part => ['input_text', 'output_text'].includes(part?.type)
    ? { type: 'text', text: part.text } : part);
}

export async function summarizeOpenCodeRequest(body) {
  const rawMessages = Array.isArray(body.messages) ? body.messages
    : typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input;
  const messages = [];
  for (const item of Array.isArray(rawMessages) ? rawMessages : []) {
    if (item?.type === 'function_call' || item?.type === 'custom_tool_call') {
      messages.push({ role: 'assistant', content: [{ type: 'tool_use', id: item.call_id, name: item.name }] });
    } else if (item?.type === 'function_call_output' || item?.type === 'custom_tool_call_output' || item?.role === 'tool') {
      messages.push({ role: 'user', content: [{
        type: 'tool_result', tool_use_id: item.call_id ?? item.tool_call_id, content: item.output ?? item.content,
      }] });
    } else if (['system', 'developer', 'user', 'assistant'].includes(item?.role)) {
      messages.push({ role: item.role === 'developer' ? 'system' : item.role, content: textBlocks(item.content) });
      if (Array.isArray(item.tool_calls)) messages.push({ role: 'assistant', content: item.tool_calls.map(call => ({
        type: 'tool_use', id: call.id, name: call.function?.name,
      })) });
    }
  }
  const tools = Array.isArray(body.tools) ? body.tools.map(tool => tool?.function ?? tool) : [];
  const detail = await claudeContext({ messages, tools, system: body.instructions ?? body.system }, {}, {});
  return detail.blocks.map(block => ({ ...block, firstSeen: null }));
}

async function httpBody(request) {
  const reader = request.clone().body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    // The original body remains owned by the provider transport.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks, size);
  const encoding = request.headers.get('content-encoding');
  if (encoding === 'gzip') return gunzipSync(bytes, { maxOutputLength: maxBytes }).toString('utf8');
  if (encoding === 'zstd') return zstdDecompressSync(bytes, { maxOutputLength: maxBytes }).toString('utf8');
  return !encoding || encoding === 'identity' ? bytes.toString('utf8') : null;
}

export async function registerOpenCodeCapture(ctx, directory, datasetFor, machine = hostname()) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.mode & 0o077) throw new Error('Use a private OpenCode capture directory');
  async function capture(event, read) {
    try {
      const provider = event.model?.providerID;
      const dataset = datasetFor(provider);
      if (!dataset) return;
      const text = await read();
      if (!text || Buffer.byteLength(text) > maxBytes) return;
      const body = JSON.parse(text);
      if (body.type && body.type !== 'response.create' && body.type !== 'message') return;
      const request = body.response ?? body;
      if (!request.messages && !request.input && !request.instructions && !request.system && !request.tools) return;
      const id = randomUUID();
      const payload = normalizeModelRequest({
        schemaVersion: 1, harness: 'opencode', dataset, machine, provider, model: request.model || event.model.id,
        captureSource: 'opencode-request', granularity: 'request',
        id, sessionId: event.sessionID, timestamp: new Date().toISOString(),
        requestBytes: Buffer.byteLength(text), context: await summarizeOpenCodeRequest(request),
      });
      const target = path.join(directory, id + '.json');
      await writeFile(target + '.tmp', JSON.stringify(payload), { flag: 'wx', mode: 0o600 });
      await rename(target + '.tmp', target);
    } catch {
      // Capture never changes or rejects a provider request.
    }
  }
  const callbacks = [
    ['http.request', event => capture(event, () => httpBody(event.request))],
    ['experimental.ws.send', event => capture(event, () => event.frame)],
  ];
  const results = await Promise.allSettled(callbacks.map(async ([name, callback]) => ctx.session.hook(name, callback)));
  return results.filter(result => result.status === 'fulfilled').map(result => result.value);
}
