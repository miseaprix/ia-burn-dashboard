import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stateStore, closeStateStores} from '../src/storage/state-store.js';
import {corporateDataset} from '../src/config/datasets.js';
import {getDashboard} from '../src/services/corporate-dashboard.js';

test('corporate historical daily model spend survives dashboard contract without losing unallocated spend', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(),'burn-model-chart-'));
  const old = process.env.STATE_DIR;
  process.env.STATE_DIR = root;
  try {
    const store = stateStore(), dataset = await corporateDataset();
    store.saveDaily(dataset,[{period:'2025-01-03',agent:'enterprise',tokens:100,requests:2,cost:10,
      models:new Map([['openai/test',{tokens:60,cost:6}],['anthropic/test',{tokens:30,cost:3}]])}]);
    const dashboard = await getDashboard({range:'custom',from:'2025-01-01',to:'2025-01-31'});
    assert.deepEqual(dashboard.daily[0].byModel,{'openai/test':6,'anthropic/test':3});
    assert.equal(dashboard.daily[0].spend,10);
    assert.equal(dashboard.harnesses.enterprise.daily[0].byModel['openai/test'],6);
  } finally {
    closeStateStores();
    if (old === undefined) delete process.env.STATE_DIR; else process.env.STATE_DIR = old;
    await rm(root,{recursive:true,force:true});
  }
});
