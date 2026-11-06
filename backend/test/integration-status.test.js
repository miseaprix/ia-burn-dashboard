import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {buildApp} from '../src/app.js';
import {stateStore} from '../src/storage/state-store.js';
import {historyDataset} from '../src/config/datasets.js';
test('integration discovery uses all persisted history, isolates sources and does not expose credentials',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'burn-levels-'));
  const keys=['STATE_DIR','CLAUDE_CONFIG_DIR','CODEX_HOME','CLAUDE_ACCOUNT_FILE','MONITOR_INGEST_ENABLED'];
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.STATE_DIR=dir;process.env.CLAUDE_CONFIG_DIR=path.join(dir,'no-claude');process.env.CODEX_HOME=path.join(dir,'no-codex');process.env.CLAUDE_ACCOUNT_FILE=path.join(dir,'no-account');process.env.MONITOR_INGEST_ENABLED='0';
  const app=await buildApp();
  try {
    const read=()=>app.inject({url:'/api/integrations',headers:{host:'localhost'}});
    const missing=(await read()).json();assert.deepEqual(missing.personal.observed,{});assert.equal(missing.personal.configured.codex,false);assert.equal(missing.monitoring.configured,false);
    stateStore().saveDaily(historyDataset('local'),[{period:'2020-01-01',agent:'codex',tokens:1,cost:0}]);
    const history=(await read()).json();assert.equal(history.personal.observed.codex,true);assert.deepEqual(history.corporateLocal.observed,{});
    assert.equal(history.monitoring.events,0);assert.equal(history.monitoring.requests,0);assert.equal('token' in history.corporate,false);
    assert.equal((await app.inject({url:'/api/integrations',headers:{host:'remote.example'}})).statusCode,403);
  } finally {await app.close();for(const k of keys)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];rmSync(dir,{recursive:true,force:true});}
});
