#!/usr/bin/env node
import {parseArgs} from 'node:util';
try {
  const {values}=parseArgs({options:{dataset:{type:'string'},url:{type:'string'}}});
  if(!['personal','enterprise'].includes(values.dataset))throw new Error('Explicit dataset required');
  process.env.BURN_MONITOR_HARNESS='codex';
  process.env.BURN_MONITOR_DATASET=values.dataset;
  process.env.BURN_MONITOR_CONTEXT='1';
  if(values.url)process.env.BURN_MONITOR_URL=values.url;
  await import('./send-monitor-event.mjs');
} catch {
  if(process.env.BURN_MONITOR_DEBUG==='1')console.error('Burn monitor: invalid Codex hook configuration.');
}
process.exitCode=0;
