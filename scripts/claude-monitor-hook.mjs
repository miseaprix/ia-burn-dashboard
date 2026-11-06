#!/usr/bin/env node
import {parseArgs} from 'node:util';
// Independent hook. Do not emit stdout, decisions, or failures to Claude.
try {
  const {values}=parseArgs({options:{dataset:{type:'string'},url:{type:'string'}},strict:true});
  if(!['personal','enterprise'].includes(values.dataset))throw new Error('Explicit dataset required');
  process.env.BURN_MONITOR_HARNESS='claude';
  process.env.BURN_MONITOR_DATASET=values.dataset;
  process.env.BURN_MONITOR_CONTEXT='1';
  if(values.url)process.env.BURN_MONITOR_URL=values.url;
  await import('./send-monitor-event.mjs');
} catch {
  if(process.env.BURN_MONITOR_DEBUG==='1')console.error('Burn monitor: invalid hook configuration.');
}
process.exitCode=0;
