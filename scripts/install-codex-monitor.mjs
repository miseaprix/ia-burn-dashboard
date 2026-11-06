#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {installClaudeMonitor} from './install-claude-monitor.mjs';
try {
  const {values}=parseArgs({options:{dataset:{type:'string'},settings:{type:'string'},url:{type:'string'},apply:{type:'boolean'},remove:{type:'boolean'},replace:{type:'boolean'}}});
  const result=installClaudeMonitor({harness:'codex',dataset:values.dataset,settingsFile:values.settings,url:values.url,apply:values.apply,remove:values.remove,replace:values.replace});
  console.log(JSON.stringify(result,null,2));
  if(result.applied && !values.remove)console.log('Codex: review and trust these hooks in /hooks before collection. Keep features.hooks enabled.');
} catch{console.error('Burn Codex installer: invalid or unavailable configuration.');process.exitCode=1;}
