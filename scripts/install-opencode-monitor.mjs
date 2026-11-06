#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync,copyFileSync,chmodSync,lstatSync,unlinkSync,constants} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {monitorEndpoint} from './monitor-client.mjs';

export function installOpenCodeMonitor({datasets=[],configFile,url,apply=false}={}) {
  if(datasets.some(d=>!['personal','enterprise'].includes(d)))throw new Error('Unsupported dataset');
  const target=path.resolve(configFile || path.join(homedir(),'.config/opencode/opencode.json'));
  if(existsSync(target) && lstatSync(target).isSymbolicLink())throw new Error('Use the actual config file');
  const present=existsSync(target),original=present ? readFileSync(target,'utf8') : '{}';
  const result=JSON.parse(original);
  if(!result || typeof result!=='object' || Array.isArray(result))throw new Error('Invalid config');
  const pluginPath=fileURLToPath(new URL('../plugins/opencode-burn',import.meta.url)),entry=pathToFileURL(pluginPath).href;
  const list=result.plugins || [];
  if(!Array.isArray(list))throw new Error('Invalid plugins');
  const own=list.find(p=>p && typeof p==='object' && p.package===entry);
  const remaining=list.filter(p=>(typeof p==='string' ? p : p.package)!==entry);
  if(datasets.length)remaining.push({package:entry,options:{...own?.options,datasets:[...new Set(datasets)].sort(),url:monitorEndpoint(url).href}});
  if(datasets.length || result.plugins)result.plugins=remaining;
  const changed=JSON.stringify(result)!==JSON.stringify(JSON.parse(original));
  let backup=null;
  if(apply && changed) {
    mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    if(present){backup=target+'.burn-backup-'+randomUUID();copyFileSync(target,backup,constants.COPYFILE_EXCL);chmodSync(backup,0o600);}
    const temp=target+'.burn-'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});
    if(present ? readFileSync(target,'utf8')!==original : existsSync(target)){unlinkSync(temp);throw new Error('Config changed during installation');}
    renameSync(temp,target);
  }
  return {configFile:target,datasets,changed,applied:apply && changed,backup};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const {values}=parseArgs({options:{datasets:{type:'string',default:''},config:{type:'string'},url:{type:'string'},apply:{type:'boolean'}}});
    console.log(JSON.stringify(installOpenCodeMonitor({datasets:values.datasets.split(',').filter(Boolean),configFile:values.config,url:values.url,apply:values.apply}),null,2));
  } catch{console.error('Burn OpenCode installer: invalid or unavailable configuration.');process.exitCode=1;}
}
