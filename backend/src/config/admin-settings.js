import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const root = () => process.env.STATE_DIR || '/data/state';
const location = () => path.join(root(), 'admin-settings.json');
export function readSettings() {
  if (!existsSync(location())) return {};
  return JSON.parse(readFileSync(location(), 'utf8'));
}
function encryptionKey() {
  const file = path.join(root(), 'admin-secret.key');
  mkdirSync(root(), {recursive:true,mode:0o700});
  if (!existsSync(file)) writeFileSync(file,randomBytes(32),{mode:0o600,flag:'wx'});
  chmodSync(file,0o600);
  return readFileSync(file);
}
export function storedApiKey(settings = readSettings()) {
  if (!settings.secret) return null;
  const {iv,tag,data} = settings.secret;
  const cipher = createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv,'base64'));
  cipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]).toString('utf8');
}
export function saveSettings(input, {isolateHistory = false} = {}) {
  const allowed = ['budget','localSeconds','quotaSeconds','corporateSeconds','apiKey','useEnvironmentKey'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!allowed.includes(k))) throw new Error('Invalid settings');
  const next = {...readSettings()};
  if (isolateHistory) next.corporateScope = randomBytes(16).toString('hex');
  for (const [key,min,max] of [['budget',1,1000000],['localSeconds',15,3600],['quotaSeconds',30,3600],['corporateSeconds',60,86400]]) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key]<min || input[key]>max || (key !== 'budget' && !Number.isInteger(input[key]))) throw new Error('Invalid settings');
    next[key] = input[key];
  }
  if (input.useEnvironmentKey !== undefined && typeof input.useEnvironmentKey !== 'boolean') throw new Error('Invalid settings');
  if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 4096 || /\s/.test(input.apiKey))) throw new Error('Invalid API key');
  if (input.useEnvironmentKey && input.apiKey) throw new Error('Choose one API key source');
  if (input.useEnvironmentKey) delete next.secret;
  if (input.apiKey) {
    const iv = randomBytes(12),cipher = createCipheriv('aes-256-gcm',encryptionKey(),iv);
    const data = Buffer.concat([cipher.update(input.apiKey,'utf8'),cipher.final()]);
    next.secret = {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
  }
  mkdirSync(root(),{recursive:true,mode:0o700});
  const tmp = location()+'.tmp';
  writeFileSync(tmp,JSON.stringify(next),{mode:0o600});chmodSync(tmp,0o600);renameSync(tmp,location());
}
