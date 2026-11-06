import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrationPlan} from '../../scripts/lib/calibration-plan.mjs';
test('matrix resume excludes unsettled generations even with force; only proven zero-cost refusals can retry',()=>{
 const cells=[{effort:'default',status:'observed'},{effort:'low',status:'unconfirmed'},{effort:'medium',status:'api_error',retrySafe:true},{effort:'high',status:'untested'},{effort:'x',status:'pending'},{effort:'y',status:'contaminated'},{effort:'z',status:'api_error',retrySafe:false}];
 const matrix={models:[{id:'test',kind:'text',limitParameter:'max_tokens',rates:{input:.000001,output:.000002},cells}]};
 assert.deepEqual(calibrationPlan(matrix,{maxTokens:5120}).cases.map(c=>c.effort),['medium','high']);
 const forced=calibrationPlan(matrix,{maxTokens:5120,force:true});
 assert.deepEqual(forced.cases.map(c=>c.effort),['default','medium','high']);
 assert.deepEqual(forced.blocked.map(c=>c.effort),['low','x','y','z']);
});

test('404 model is excluded from automatic resume even with zero-cost evidence and force',()=>{
 const model={id:'mistral',kind:'text',limitParameter:'max_tokens',rates:{input:.000001,output:.000002},cells:[{effort:'default',status:'api_error',httpStatus:404,retrySafe:true},{effort:'low',status:'untested'}]};
 const plan=calibrationPlan({models:[model,{...model,id:'available',cells:[{effort:'default',status:'untested'}]}]},{maxTokens:5120,force:true});
 assert.deepEqual(plan.cases.map(c=>c.model),['available']);
 assert.equal(plan.blocked.length,2);
 assert.ok(plan.blocked.every(c=>c.reason==='gateway_not_found'));
});
