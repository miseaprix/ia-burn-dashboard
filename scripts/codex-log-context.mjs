const maxBlocks = 1000;
const namePattern = /^[\w.:-]{1,256}$/;
const size = value => Buffer.byteLength(value);
const outputSize = value => {
  if (typeof value === 'string') return size(value);
  if (Array.isArray(value) && value.length && value.every(block => typeof block?.text === 'string'))
    return value.reduce((total, block) => total + size(block.text), 0);
  return null;
};

function* catalog(text) {
  const tagged = text.match(/^<skills_instructions>\r?\n([\s\S]*?)^<\/skills_instructions>[ \t]*$/m)?.[1];
  // Native Codex catalogs also use a separate "## Skills" context block.
  const source = tagged ?? (/^## Skills\r?\n/.test(text) ? text : null);
  if (!source) return;
  const list = source.match(/^### Available skills[ \t]*\r?\n([\s\S]*)/m)?.[1];
  if (!list) return;
  const roots = new Map([...source.matchAll(/^- `(r\d+)` = `([^\r\n`]+)`$/gm)].map(([, alias, root]) => [alias, root]));
  for (const line of list.split(/\r?\n/)) {
    if (/^#{1,6}\s|^<\//.test(line)) break;
    const match = line.match(/^- (.+?)(?: \(file: ([^\r\n]+)\))?$/);
    if (!match) continue;
    const entry = match[1].match(/^([\w.:-]{1,256}?)(?:: (.+))?$/);
    if (!entry) continue;
    const [, name, description] = entry;
    if (description && (description.length > 2000 || /[\x00-\x1f\x7f]/.test(description))) continue;
    const [, alias, relative] = match[2]?.match(/^(r\d+)\/(.+)$/) ?? [];
    const file = roots.has(alias) ? `${roots.get(alias)}/${relative}` : match[2];
    yield { file, block: { kind: 'skill', state: description ? 'description' : 'name', name, description, bytes: size(line) } };
  }
}

const callTypes = new Set(['function_call', 'custom_tool_call', 'tool_search_call']);
const resultTypes = new Set(['function_call_output', 'custom_tool_call_output', 'tool_search_output']);

export function codexLogContext({ readSkill } = {}) {
  const skills = new Map(), rules = new Map(), calls = new Map();
  let activity = [];
  const observe = block => { if (activity.length < maxBlocks) activity.push(block); };
  return {
    resetTurn() { activity = []; calls.clear(); },
    clear() { skills.clear(); rules.clear(); this.resetTurn(); },
    async add(item) {
      if (item.type === 'message' && ['developer', 'user'].includes(item.role)) {
        for (const block of item.content ?? []) {
          const body = block.text;
          if (block.type !== 'input_text' || typeof body !== 'string') continue;
          if (item.role === 'developer') {
            for (const skill of catalog(body)) {
              const { name } = skill.block;
              if (skills.size < maxBlocks || skills.has(name)) skills.set(name, skill);
            }
          }
          if (body.startsWith('# AGENTS.md instructions for ') && body.includes('<INSTRUCTIONS>')) {
            if (rules.size < maxBlocks) rules.set(body, { kind: 'rule', state: 'body', name: 'AGENTS.md', bytes: size(body) });
          }
        }
      }
      if (callTypes.has(item.type) && typeof item.call_id === 'string') {
        const name = item.type === 'tool_search_call' ? 'tool_search' : item.name;
        if (typeof name !== 'string' || !namePattern.test(name)) return;
        const kind = name.startsWith('mcp__') || item.namespace?.startsWith('mcp__') ? 'mcp' : 'tool';
        const qualified = kind === 'mcp' && !name.startsWith('mcp__') && typeof item.namespace === 'string'
          ? `${item.namespace}__${name}` : name;
        if (!namePattern.test(qualified)) return;
        const entry = { kind, name: qualified };
        if (calls.size < maxBlocks) calls.set(item.call_id, entry);
        observe({ ...entry, state: 'called', bytes: outputSize(item.arguments ?? item.input) });
      }
      if (resultTypes.has(item.type) && calls.has(item.call_id)) {
        observe({ ...calls.get(item.call_id), state: 'result', bytes: outputSize(item.output) });
        calls.delete(item.call_id);
        const texts = typeof item.output === 'string' ? [item.output] : Array.isArray(item.output)
          ? item.output.map(block => block?.text) : [];
        if (readSkill) for (const text of texts) {
          const skillName = typeof text === 'string' && text.match(/^---\r?\nname: ([\w.:-]+)\r?\n/)?.[1];
          const file = skills.get(skillName)?.file;
          if (!file) continue;
          const source = await readSkill(file);
          if (source && source.trimEnd() === text.trimEnd())
            observe({ kind: 'skill', state: 'full', name: skillName, bytes: size(text) });
        }
      }
    },
    addMcpEvent(item) {
      if (item?.type !== 'McpToolCall' || !namePattern.test(item.server ?? '') || !namePattern.test(item.tool ?? '')) return;
      const name = `mcp__${item.server}__${item.tool}`;
      if (!namePattern.test(name)) return;
      const kind = 'mcp';
      if (!activity.some(block => block.name === name && block.state === 'called'))
        observe({ kind, name, state: 'called' });
      if (item.status === 'failed') observe({ kind, name, state: 'failed' });
      else if (item.status === 'completed' && item.result != null &&
          !activity.some(block => block.name === name && block.state === 'result'))
        observe({ kind, name, state: 'result', bytes: outputSize(item.result.content) });
    },
    snapshot() {
      const blocks = [...activity, ...rules.values(), ...[...skills.values()].map(skill => skill.block)].slice(0, maxBlocks);
      activity = [];
      return blocks.length ? blocks : null;
    },
  };
}
