import { createHash } from 'node:crypto';

const skillName = '[a-zA-Z0-9_@.\\/-]+(?::[a-zA-Z0-9_@.\\/-]+)*';
const catalogEntry = new RegExp('^[-*] (' + skillName + ')(?::\\s+(.+))?$');
const activation = new RegExp('^Launching skill: (' + skillName + ')\\s*$');
const mcpName = /\bmcp__[a-zA-Z0-9_.-]+__[a-zA-Z0-9_.-]+\b/g;
const bodyMarker = /^Base directory for this skill: ([^\r\n]+)\r?\n\r?\n/;
const fileMarker = /^Contents of (.+?\.md)(?:\s+\(|:)/gm;
const asBlocks = value => typeof value === 'string' ? [{ type: 'text', text: value }] : Array.isArray(value) ? value : [];
const size = value => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value ?? null));
const normalizeText = value => value.replace(/\r\n/g, '\n').trim();
const leafName = file => file.split(/[\\/]/).at(-1);

export function anthropicUsage(usage) {
  const { input_tokens: base, output_tokens: output, cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite } = usage ?? {};
  // Anthropic reports uncached input separately. Absent cache counters are not inferred.
  const parts = [base, cacheRead, cacheWrite];
  const input = parts.every(Number.isSafeInteger) ? parts.reduce((sum, value) => sum + value, 0) : null;
  return { input, output, cacheRead, cacheWrite };
}

export async function claudeContext(request, response, { previous, seen, knownCalls, readSkill }) {
  const blocks = [];
  const fingerprints = new Set();
  const calls = new Map(knownCalls);
  function add(kind, state, name, content, description) {
    if (state === 'called') {
      if (blocks.length < 1000) blocks.push({ kind, state, name, bytes: null });
      return;
    }
    const hash = createHash('sha256').update(JSON.stringify([kind, state, name, content])).digest('hex');
    const repeated = previous == null ? null : previous.has(hash);
    fingerprints.add(hash);
    if (blocks.length < 1000) blocks.push({
      kind, state, name, bytes: content == null ? null : size(content), description, repeated,
      firstSeen: !seen?.has(hash),
    });
  }
  const messages = (request.messages ?? []).map(message => ({
    role: message.role, blocks: asBlocks(message.content),
  }));
  for (const message of messages) for (const block of message.blocks)
    if (block.type === 'tool_use' && block.id) calls.set(block.id, block.name);

  function addSchema(tool) {
    if (!tool || typeof tool.name !== 'string') return;
    const mcp = tool.name.startsWith('mcp__');
    add(mcp ? 'mcp' : 'tool', tool.defer_loading ? 'name' : 'schema', tool.name, tool.defer_loading ? tool.name : tool);
  }

  for (const tool of request.tools ?? []) {
    if (tool?.name === 'DeferredToolPlaceholder') continue;
    addSchema(tool);
  }
  for (const [index, block] of asBlocks(request.system).entries())
    if (typeof block.text === 'string') add('system', 'body', `system[${index}]`, block.text);

  let activeSkill;
  for (const { role, blocks: entries } of messages) {
    for (const block of entries) {
      if (block.type === 'tool_addition') {
        addSchema(block.tool?.definition);
        continue;
      }
      if (block.type === 'tool_result') {
        const name = calls.get(block.tool_use_id);
        if (name === 'Skill' && typeof block.content === 'string')
          activeSkill = activation.exec(block.content.trim())?.[1];
        add(name?.startsWith('mcp__') ? 'mcp' : 'tool', 'result', name || 'Outil non identifié', block.content);
        continue;
      }
      if (typeof block.text !== 'string') continue;
      const body = bodyMarker.exec(block.text);
      if (body) {
        const name = activeSkill || leafName(body[1]);
        const sent = block.text.slice(body[0].length);
        const original = await readSkill?.(body[1]);
        const comparable = original ? normalizeText(original) : '';
        const actual = normalizeText(sent);
        const state = comparable && comparable === actual ? 'full'
          : comparable && actual && comparable.includes(actual) ? 'excerpt' : 'body';
        add('skill', state, name, sent);
        activeSkill = undefined;
        continue;
      }
      const text = block.text;
      if (role === 'system') {
        const catalog = text.split(/The following skills are available[^\n]*:\s*\n/, 2)[1];
        if (catalog) {
          const entries = catalog.split('\n');
          for (const line of entries) {
            if (/^\s*(?:<|#{1,6} )/.test(line)) break;
            const match = catalogEntry.exec(line.trim());
            if (!match) continue;
            const [, name, description] = match;
            add('skill', description ? 'description' : 'name', name, description || name, description?.slice(0, 2000));
          }
        }
        for (const name of new Set(text.match(mcpName) ?? [])) add('mcp', 'name', name, name);
        const instructions = text.split(/^#+ MCP Server Instructions\s*$/m, 2)[1];
        if (instructions) {
          const section = instructions.split(/^#{1,2} |The following skills are available|<available-deferred-tools>/m, 1)[0].trim();
          if (section) add('mcp', 'instructions', 'Instructions des serveurs MCP', section);
        }
        add('system', 'body', 'Message système', text);
        continue;
      }
      const files = [...text.matchAll(fileMarker)];
      for (const [index, marker] of files.entries()) {
        const file = marker[1];
        const end = files[index + 1]?.index ?? text.indexOf('</system-reminder>', marker.index);
        const start = text.indexOf('\n', marker.index);
        if (start < 0) continue;
        const contents = text.slice(start + 1, end < 0 ? undefined : end).trim();
        add(/(?:\/memory\/|MEMORY\.md$)/i.test(file) ? 'memory' : 'rule', 'body', leafName(file), contents);
      }
      add('message', 'body', role, text);
    }
  }
  const responseCalls = [];
  for (const block of asBlocks(response.content)) {
    if (block.type !== 'tool_use' || !block.id || typeof block.name !== 'string') continue;
    responseCalls.push([block.id, block.name]);
    const name = block.name === 'Skill' && typeof block.input?.skill === 'string' ? block.input.skill : block.name;
    add(block.name === 'Skill' ? 'skill' : block.name.startsWith('mcp__') ? 'mcp' : 'tool', 'called', name, null);
  }
  return { blocks, fingerprints, calls: responseCalls };
}
