import test from 'node:test';
import assert from 'node:assert/strict';
import {modelTier,filterModels,sortMatrixRows} from '../src/lib/model-catalog.mjs';
test('editorial tiers keep unknown families and non-text modalities unranked',()=>{
 assert.equal(modelTier({id:'claude-haiku-*',kind:'text'}),'economy');
 assert.equal(modelTier({id:'gpt-5.4-mini',kind:'text'}),'economy');
 assert.equal(modelTier({id:'claude-sonnet-5-5',kind:'text'}),'balanced');
 assert.equal(modelTier({id:'claude-opus-5-5',kind:'text'}),'advanced');
 assert.equal(modelTier({id:'new-model',kind:'text'}),'unknown');
 assert.equal(modelTier({id:'gemini-flash-image',kind:'image'}),'unknown');
});
test('filters combine name, tier and capability; empty modality gives an empty view',()=>{
 const models=[{id:'gpt-5.4-mini',kind:'text'},{id:'claude-opus-5',kind:'text'},{id:'image-test',kind:'image'}];
 assert.deepEqual(filterModels(models,{search:' GPT ',tier:'economy',capability:'text'}),[models[0]]);
 assert.deepEqual(filterModels(models,{capability:'video'}),[]);
 assert.equal(filterModels(models,{}).length,3);
});
test('numeric sorting preserves zero and puts unknown or unvalidated costs last in both directions',()=>{
 const row=(id,cost,status='observed')=>({model:{id,kind:'text'},cell:{effort:'default',status,measuredCost:cost}});
 const rows=[row('unknown',null),row('ten',10),row('two',2),row('zero',0),row('unconfirmed',0,'unconfirmed')];
 assert.deepEqual(sortMatrixRows(rows,'cost','asc').map(r=>r.model.id),['zero','two','ten','unknown','unconfirmed']);
 assert.deepEqual(sortMatrixRows(rows,'cost','desc').map(r=>r.model.id),['ten','two','zero','unknown','unconfirmed']);
 assert.equal(rows[0].model.id,'unknown');
});
test('effort sorts in logical order and input/output/date columns sort independently',()=>{
 const model={id:'test',kind:'text'};
 const rows=[{model,cell:{effort:'high',usage:{prompt_tokens:2,completion_tokens:100},testedAt:'2026-10-12T10:00:00Z'}},{model,cell:{effort:'low',usage:{prompt_tokens:10,completion_tokens:20},testedAt:'2026-10-13T10:00:00Z'}}];
 assert.equal(sortMatrixRows(rows,'effort')[0].cell.effort,'low');
 assert.equal(sortMatrixRows(rows,'input')[0].cell.effort,'high');
 assert.equal(sortMatrixRows(rows,'output')[0].cell.effort,'low');
 assert.equal(sortMatrixRows(rows,'date','desc')[0].cell.effort,'low');
});
