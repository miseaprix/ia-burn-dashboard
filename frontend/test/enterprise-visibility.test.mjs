import test from 'node:test';
import assert from 'node:assert/strict';
import {availableSources,isEnterpriseEnabled,resolveSource} from '../src/lib/enterprise.js';
test('enterprise sources are hidden when /api/config reports enabled=false',()=>{
  const config={enterprise:{label:'Acme',enabled:false}};
  assert.equal(isEnterpriseEnabled(config),false);
  assert.deepEqual(availableSources(isEnterpriseEnabled(config)),['local']);
  assert.equal(resolveSource('enterprise',false),'local');
  assert.equal(resolveSource('enterprise-local',false),'local');
});
test('enterprise sources stay visible when enabled or when the config is missing',()=>{
  assert.equal(isEnterpriseEnabled({enterprise:{label:'Acme',enabled:true}}),true);
  assert.equal(isEnterpriseEnabled(null),true);
  assert.deepEqual(availableSources(true),['local','enterprise-local','enterprise']);
  assert.equal(resolveSource('enterprise',true),'enterprise');
  assert.equal(resolveSource('bogus',true),'local');
});
