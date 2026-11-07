export const datasetLabels = { personal: 'Perso', enterprise: 'Enterprise', unclassified: 'Non classé' };
export const hourMs = 60 * 60 * 1000;

const contextKinds = ['skill', 'mcp', 'tool', 'rule', 'memory', 'system', 'message'];
const contextStates = ['failed', 'called', 'result', 'full', 'excerpt', 'body', 'instructions', 'schema', 'description', 'name'];
const stateRank = state => contextStates.indexOf(state);

export function contextTotals(entries) {
  let bytes = null, estimatedTokens = null;
  for (const entry of entries) {
    if (entry.bytes != null) bytes = (bytes ?? 0) + entry.bytes;
    if (entry.estimatedTokens != null) estimatedTokens = (estimatedTokens ?? 0) + entry.estimatedTokens;
  }
  return { bytes, estimatedTokens };
}

function groupMcpServers(items) {
  const servers = new Map();
  for (const item of items) {
    const separator = item.name?.startsWith('mcp__') ? item.name.indexOf('__', 5) : -1;
    const server = separator > 5 ? item.name.slice(5, separator) : null;
    if (!servers.has(server)) servers.set(server, []);
    servers.get(server).push(item);
  }
  return [...servers].map(([name, tools]) => ({ name, items: tools, totals: contextTotals(tools.map(item => item.totals)) }));
}

export function groupContextBlocks(blocks) {
  const categories = new Map();
  for (const block of blocks ?? []) {
    if (!categories.has(block.kind)) categories.set(block.kind, new Map());
    const items = categories.get(block.kind);
    if (!items.has(block.name)) items.set(block.name, { name: block.name, blocks: [], states: new Set() });
    const item = items.get(block.name);
    item.blocks.push(block);
    item.states.add(block.state);
  }
  return contextKinds.filter(kind => categories.has(kind)).map(kind => {
    const stateCounts = {};
    const items = [...categories.get(kind).values()].map(item => {
      for (const state of item.states) stateCounts[state] = (stateCounts[state] ?? 0) + 1;
      return { ...item, totals: contextTotals(item.blocks), states: [...item.states].sort((a, b) => stateRank(a) - stateRank(b)) };
    });
    items.sort((a, b) => stateRank(a.states[0]) - stateRank(b.states[0]));
    return { kind, items, stateCounts, totals: contextTotals(items.map(item => item.totals)),
      ...(kind === 'mcp' ? { servers: groupMcpServers(items) } : {}) };
  });
}

export function rankSessionContext(groups) {
  return contextKinds.flatMap(kind => {
    const entries = groups.filter(group => group.kind === kind);
    return entries.length ? [{ kind, ...contextTotals(entries), servers: kind === 'mcp' ? entries : [] }] : [];
  }).sort((a, b) => (b.estimatedTokens ?? -1) - (a.estimatedTokens ?? -1));
}

export function monitoringOffset(params, key) {
  const value = Number(params.get(key) ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function monitoringUrl(page, changes = {}) {
  const params = new URLSearchParams(window.location.search);
  params.set('page', page);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === 0) params.delete(key);
    else params.set(key, value);
  }
  return `?${params}`;
}

export function monitoringListUrl(changes = {}) {
  return monitoringUrl('monitoring', {
    monitorSource: null, session: null, eventsOffset: null, modelOffset: null, ...changes,
  });
}

export function measuredSessionsUrl() {
  return monitoringListUrl({
    modelOnly: 1, monitorWindow: 'all', monitorFrom: null, monitorTo: null,
    sessionsOffset: null, requestsOffset: null,
  }) + '#monitor-sessions';
}
