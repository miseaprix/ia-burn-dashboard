const harnesses = ['claude', 'codex', 'opencode'];
const datasets = ['personal', 'enterprise', 'unclassified'];
const billingModes = ['subscription', 'api', 'local'];
const captureSources = ['claude-capture', 'codex-log', 'opencode-message', 'provider-report'];
const states = {
  skill: ['name', 'description', 'excerpt', 'full', 'body', 'called'],
  mcp: ['name', 'instructions', 'schema', 'called', 'result', 'failed'],
  tool: ['name', 'schema', 'called', 'result'],
  rule: ['body'], memory: ['body'], system: ['body'], message: ['body'],
};

function label(value, max = 256) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value))
    throw new Error('Invalid metadata');
  return value;
}
function counter(value) {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid counter');
  return value;
}

export function normalizeModelRequest(body) {
  if (body?.schemaVersion !== 1 || !harnesses.includes(body.harness) ||
      !datasets.includes(body.dataset) || !captureSources.includes(body.captureSource))
    throw new Error('Invalid source');
  const machine = label(body.machine), sessionId = label(body.sessionId), id = label(body.id);
  const timestamp = label(body.timestamp), time = Date.parse(timestamp);
  if (!machine || !sessionId || !id || !Number.isFinite(time) || !/(Z|[+-]\d\d:\d\d)$/.test(timestamp))
    throw new Error('Invalid identity');
  if (body.context != null && (!Array.isArray(body.context) || body.context.length > 1000))
    throw new Error('Invalid context');
  const context = body.context?.map(block => {
    if (!Object.hasOwn(states, block?.kind) || !states[block.kind].includes(block.state)) throw new Error('Invalid context block');
    const bytes = counter(block.bytes);
    return {
      kind: block.kind, state: block.state, name: label(block.name),
      description: block.kind === 'skill' && block.state === 'description' ? label(block.description, 2000) : null,
      bytes, estimatedTokens: bytes == null ? null : Math.ceil(bytes / 4),
      repeated: typeof block.repeated === 'boolean' ? block.repeated : null,
      firstSeen: typeof block.firstSeen === 'boolean' ? block.firstSeen : null,
    };
  }) ?? null;
  const usage = Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'].map(key => [key, counter(body.usage?.[key])]));
  const billing = body.billing == null ? null : label(body.billing);
  if (billing && !billingModes.includes(billing)) throw new Error('Invalid billing mode');
  const granularity = body.granularity ?? 'request';
  if (!['request', 'message', 'turn'].includes(granularity)) throw new Error('Invalid measurement granularity');
  const amount = body.cost?.usd;
  const cost = amount == null ? null : { usd: amount, basis: body.cost.basis };
  if (cost && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 ||
      !['billed', 'estimated'].includes(cost.basis))) throw new Error('Invalid cost');
  return {
    schemaVersion: 1, id, machine, sessionId, timestamp: new Date(time).toISOString(),
    harness: body.harness, dataset: body.dataset, captureSource: body.captureSource, granularity,
    provider: label(body.provider), model: label(body.model), gateway: label(body.gateway), orchestrator: label(body.orchestrator),
    taskId: label(body.taskId), runId: label(body.runId), turnId: label(body.turnId),
    billing, cost, durationMs: counter(body.durationMs), requestBytes: counter(body.requestBytes), usage, context,
  };
}
