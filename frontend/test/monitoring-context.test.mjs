import test from 'node:test';
import assert from 'node:assert/strict';
import { groupContextBlocks } from '../src/lib/monitoring.js';

test('nests context by category and name and brings used items above the catalog', () => {
  const catalog = { kind: 'skill', name: 'catalog-only', state: 'description' };
  const announced = { kind: 'skill', name: 'review', state: 'name' };
  const loaded = { kind: 'skill', name: 'review', state: 'full', estimatedTokens: 120 };
  const called = { kind: 'skill', name: 'review', state: 'called', estimatedTokens: null };
  const groups = groupContextBlocks([
    { kind: 'tool', name: 'review', state: 'schema' },
    catalog, announced, loaded, called, { ...loaded, repeated: true },
  ]);

  assert.deepEqual(groups.map(group => group.kind), ['skill', 'tool']);
  assert.deepEqual(groups[0].items.map(item => item.name), ['review', 'catalog-only']);
  assert.deepEqual(groups[0].items[0].states, ['called', 'full', 'name']);
  assert.equal(groups[0].items[0].blocks.length, 4);
  assert.deepEqual(groups[0].stateCounts, { name: 1, full: 1, called: 1, description: 1 });
  assert.equal(groups[0].items[0].blocks.find(block => block.state === 'called').estimatedTokens, null);
});

test('leaves unavailable context empty', () => {
  assert.deepEqual(groupContextBlocks(null), []);
});

test('groups MCP tools under the captured server name and sums measured blocks', () => {
  const [group] = groupContextBlocks([
    { kind: 'mcp', name: 'mcp__remote-devices__Claude_Browser__', state: 'schema', bytes: 5, estimatedTokens: 2 },
    { kind: 'mcp', name: 'mcp__remote-devices__computer_', state: 'name', bytes: 1, estimatedTokens: 1 },
    { kind: 'mcp', name: 'mcp__remote-devices__computer_', state: 'called', bytes: null, estimatedTokens: null },
    { kind: 'mcp', name: 'Instructions des serveurs MCP', state: 'instructions', bytes: null, estimatedTokens: null },
  ]);
  assert.deepEqual(group.totals, { bytes: 6, estimatedTokens: 3 });
  assert.deepEqual(group.servers.map(server => [server.name, server.items.length, server.totals]), [
    ['remote-devices', 2, { bytes: 6, estimatedTokens: 3 }],
    [null, 1, { bytes: null, estimatedTokens: null }],
  ]);
});
