import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadOpenCodeRows } from '../src/integrations/opencode.js';
import { collectLocal } from '../src/integrations/local.js';
import { getDashboard } from '../src/services/local-dashboard.js';
import { closeStateStores } from '../src/storage/state-store.js';

function fixture(file, v2) {
  const db = new DatabaseSync(file);
  db.exec(v2 ? 'CREATE TABLE session_message(id TEXT,type TEXT,data TEXT)' : 'CREATE TABLE message(id TEXT,data TEXT)');
  const insert = db.prepare(v2 ? 'INSERT INTO session_message VALUES(?,?,?)' : 'INSERT INTO message VALUES(?,?)');
  for (const [id, provider, completed] of [['corporate','enterprise',true], ['personal','opencode',true], ['pending','enterprise',false]]) {
    const data = JSON.stringify({role:'assistant', modelID:'claude-sonnet-4-20250514', providerID:provider,
      ...(v2 ? {model:{id:'claude-sonnet-4-20250514',providerID:provider}} : {}),
      time:{created:Date.parse('2026-10-07T12:00:00Z'), ...(completed ? {completed:Date.parse('2026-10-07T12:01:00Z')} : {})},
      cost:0, tokens:{input:100,output:20,cache:{read:30,write:10}}});
    insert.run(...(v2 ? [id,'assistant',data] : [id,data]));
  }
  db.close();
}

test('OpenCode legacy and v2 select completed corporate usage and estimate gateway zero costs', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'burn-opencode-'));
  try {
    for (const v2 of [false,true]) {
      const file = path.join(root,`${v2}.db`); fixture(file,v2);
      const rows = await loadOpenCodeRows(file, ['enterprise']);
      assert.equal(rows.length,1);
      assert.equal(rows[0].agent,'opencode');
      assert.equal(rows[0].tokens,160);
      assert.ok(rows[0].cost > 0);
      assert.equal(rows[0].unknownTokens,0);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('corporate local datasets isolate personal usage and include every harness without subscriptions', async () => {
  const root = await mkdtemp(path.join(tmpdir(),'burn-enterprise-local-'));
  const keys = ['STATE_DIR','CLAUDE_CONFIG_DIR','CODEX_HOME','ENTERPRISE_CLAUDE_DIR','ENTERPRISE_CODEX_DIR','ENTERPRISE_OPENCODE_DB','ENTERPRISE_OPENCODE_PROVIDERS'];
  const old = Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try {
    process.env.STATE_DIR = path.join(root,'state');
    process.env.CLAUDE_CONFIG_DIR = path.join(root,'personal');
    process.env.CODEX_HOME = path.join(root,'codex-personal');
    process.env.ENTERPRISE_CLAUDE_DIR = path.join(root,'corporate');
    process.env.ENTERPRISE_CODEX_DIR = path.join(root,'codex-corporate');
    process.env.ENTERPRISE_OPENCODE_DB = path.join(root,'opencode.db');
    process.env.ENTERPRISE_OPENCODE_PROVIDERS = 'enterprise';
    fixture(process.env.ENTERPRISE_OPENCODE_DB,true);
    for (const [dir,tokens] of [[process.env.CLAUDE_CONFIG_DIR,42],[process.env.ENTERPRISE_CLAUDE_DIR,100]]) {
      await mkdir(path.join(dir,'projects'),{recursive:true});
      await writeFile(path.join(dir,'projects','usage.jsonl'),JSON.stringify({timestamp:'2026-10-07T12:00:00Z',
        message:{id:'same-id-across-roots', model:'claude-sonnet-4-20250514',usage:{input_tokens:tokens,output_tokens:0}},costUSD:1})+'\n');
    }
    await collectLocal(); await collectLocal('enterprise-local');
    const personal = await getDashboard({range:'all'});
    const corporate = await getDashboard({range:'all',source:'enterprise-local'});
    assert.equal(personal.totals.tokens,42);
    assert.equal(corporate.totals.tokens,260);
    assert.deepEqual(Object.keys(corporate.harnesses),['claude','codex','opencode']);
    assert.equal(corporate.harnesses.opencode.totals.tokens,160);
    assert.equal(corporate.subscriptions.length,0);
    assert.equal(corporate.capabilities.burndown,false);
    assert.match(corporate.footnote,/not the corporate invoice/);
    assert.equal(corporate.byHarness.length,2);
    closeStateStores();
    const reopened = await getDashboard({range:'all',source:'enterprise-local'});
    assert.equal(reopened.totals.tokens,260);
  } finally {
    closeStateStores();
    for (const k of keys) { if(old[k] == null) delete process.env[k]; else process.env[k]=old[k]; }
    await rm(root,{recursive:true,force:true});
  }
});
