#!/usr/bin/env node
import {prepareMonitorPayload,sendMonitorPayload,monitorEndpoint} from './monitor-client.mjs';
// Common opt-in transport. Never print raw input or hook decisions.
try {
  const url=monitorEndpoint(process.env.BURN_MONITOR_URL).href;
  let input='';
  for await(const chunk of process.stdin) {
    input+=chunk;if(Buffer.byteLength(input)>1048576)throw new Error('Input too large');
  }
  const payload=await prepareMonitorPayload(JSON.parse(input),{harness:process.env.BURN_MONITOR_HARNESS,
    dataset:process.env.BURN_MONITOR_DATASET,machine:process.env.BURN_MONITOR_MACHINE,
    context:process.env.BURN_MONITOR_CONTEXT==='1'});
  const accepted=await sendMonitorPayload(payload,url);
  if(!accepted && process.env.BURN_MONITOR_DEBUG==='1')console.error('Burn monitor: event not accepted.');
} catch {
  if(process.env.BURN_MONITOR_DEBUG==='1')console.error('Burn monitor: invalid event or configuration.');
}
process.exitCode=0;
