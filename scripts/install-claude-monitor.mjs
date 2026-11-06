#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync,copyFileSync,constants,statSync,chmodSync,lstatSync,unlinkSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';

const eventTypes={claude:['SessionStart','SessionEnd','PreToolUse','PostToolUse','PostToolUseFailure','Stop','Notification','UserPromptSubmit','SubagentStart','SubagentStop'],
  codex:['SessionStart','SessionEnd','PreToolUse','PostToolUse','Stop','UserPromptSubmit','SubagentStart','SubagentStop','Interrupt','PreCompact','PostCompact']};
const quote=v=>"'"+v.replaceAll("'","'\\''")+"'";
// Package managers (Homebrew, nvm…) put node in a versioned directory that the next
// upgrade deletes: prefer a PATH link that resolves to the same binary.
export function stableNodePath(execPath=process.execPath,pathEnv=process.env.PATH || '') {
  let real;
  try {real=realpathSync(execPath);} catch {return execPath;}
  for(const dir of pathEnv.split(path.delimiter)) {
    if(!dir)continue;
    const candidate=path.join(dir,path.basename(execPath));
    try {if(candidate!==real && realpathSync(candidate)===real)return candidate;} catch {}
  }
  return execPath;
}
export function addClaudeHooks(settings,command,harness='claude') {
  if(!settings || typeof settings!=='object' || Array.isArray(settings))throw new Error('Invalid settings');
  const result=structuredClone(settings);
  if(result.hooks!=null && (typeof result.hooks!=='object' || Array.isArray(result.hooks)))throw new Error('Invalid hooks');
  result.hooks ??={};
  for(const event of eventTypes[harness]) {
    const rules=result.hooks[event] ??=[];
    if(!Array.isArray(rules))throw new Error('Invalid hook rules');
    const own=rules.flatMap(r=>Array.isArray(r.hooks) ? r.hooks : []).filter(h=>typeof h.command==='string' && h.command.includes(`${harness}-monitor-hook.mjs`));
    if(own.some(h=>h.command!==command))throw new Error('A different Burn collector is installed; remove it explicitly before changing its configuration');
    if(!own.length)rules.push({matcher:'*',hooks:[{type:'command',command,timeout:harness==='codex' ? 3 : 5}]});
  }
  return result;
}

export function removeClaudeHooks(settings,dataset,harness='claude') {
  const result=structuredClone(settings);
  const marker=`'--dataset' '${dataset}'`;
  for(const [event,rules] of Object.entries(result.hooks || {})) {
    if(!Array.isArray(rules))throw new Error('Invalid hook rules');
    result.hooks[event]=rules.flatMap(rule=>{
      if(!Array.isArray(rule.hooks))return [rule];
      const hooks=rule.hooks.filter(h=>!(typeof h.command==='string' && h.command.includes(`${harness}-monitor-hook.mjs`) && h.command.includes(marker)));
      if(hooks.length===rule.hooks.length)return [rule];
      return hooks.length ? [{...rule,hooks}] : [];
    });
    if(rules.length && !result.hooks[event].length)delete result.hooks[event];
  }
  return result;
}

export function installClaudeMonitor({dataset,settingsFile,url='http://localhost:4095/api/monitor/events',apply=false,remove=false,replace=false,harness='claude'}) {
  if(!eventTypes[harness])throw new Error('Unsupported hook harness');
  if(!['personal','enterprise'].includes(dataset))throw new Error('Use --dataset personal or enterprise');
  const endpoint=new URL(url);
  if(endpoint.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname) || endpoint.pathname!=='/api/monitor/events' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password)throw new Error('Use a local Burn event endpoint');
  const target=path.resolve(settingsFile || path.join(homedir(),dataset==='personal' ? `.${harness}` : `.${harness}-enterprise`,harness==='claude' ? 'settings.json' : 'hooks.json'));
  if(existsSync(target) && lstatSync(target).isSymbolicLink())throw new Error('Use the actual settings file instead of a symbolic link');
  const script=fileURLToPath(new URL(`./${harness}-monitor-hook.mjs`,import.meta.url));
  const command=[stableNodePath(),script,'--dataset',dataset,'--url',endpoint.href].map(quote).join(' ');
  const present=existsSync(target),original=present ? readFileSync(target,'utf8') : '{}';
  const settings=JSON.parse(original);
  const result=remove ? removeClaudeHooks(settings,dataset,harness) : addClaudeHooks(replace ? removeClaudeHooks(settings,dataset,harness) : settings,command,harness);
  const contents=JSON.stringify(result,null,2)+'\n';
  const changed=JSON.stringify(JSON.parse(original))!==JSON.stringify(result);
  let backup=null;
  if(apply && changed) {
    mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    if(present){backup=target+'.burn-backup-'+randomUUID();copyFileSync(target,backup,constants.COPYFILE_EXCL);chmodSync(backup,0o600);}
    const temp=target+'.burn-'+randomUUID()+'.tmp';
    writeFileSync(temp,contents,{mode:present ? statSync(target).mode & 0o777 : 0o600,flag:'wx'});
    // Refuse to overwrite another process's concurrent settings change.
    if(present ? readFileSync(target,'utf8')!==original : existsSync(target)) {
      unlinkSync(temp);throw new Error('Settings changed during installation');
    }
    renameSync(temp,target);
  }
  return {harness,dataset,settingsFile:target,changed,applied:apply && changed,backup,events:remove ? 0 : eventTypes[harness].length};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const {values}=parseArgs({options:{dataset:{type:'string'},settings:{type:'string'},url:{type:'string'},apply:{type:'boolean',default:false},remove:{type:'boolean',default:false},replace:{type:'boolean',default:false}}});
    // Summary only: never print existing settings or credentials.
    console.log(JSON.stringify(installClaudeMonitor({dataset:values.dataset,settingsFile:values.settings,url:values.url,apply:values.apply,remove:values.remove,replace:values.replace}),null,2));
  } catch{console.error('Burn Claude installer: invalid or unavailable configuration.');process.exitCode=1;}
}
