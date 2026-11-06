import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { claudeTokenCosts, codexTokenCosts } from '../domain/pricing.js';
import { enterpriseDirs, enterpriseOpenCodeProviders } from '../config/enterprise.js';

// OpenCode 2 stores messages for all providers in one database. Select the
// enterprise providers explicitly (ENTERPRISE_OPENCODE_PROVIDERS), never infer
// corporate usage from the configuration directory.
export async function loadOpenCodeRows(file = enterpriseDirs().opencodeDb, providers = enterpriseOpenCodeProviders()) {
  if (!providers.length || !existsSync(file)) return [];
  const db = new DatabaseSync(file, {readOnly: true});
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x => x.name);
    const v2 = tables.includes('session_message');
    if (!v2 && !tables.includes('message')) throw new Error('Unsupported OpenCode database');
    const messages = db.prepare(v2
      ? "SELECT id,data FROM session_message WHERE type='assistant'"
      : 'SELECT id,data FROM message').all();
    const days = new Map();
    for (const m of messages) {
      const x = JSON.parse(m.data);
      const provider = x.model?.providerID || x.providerID;
      if (!providers.includes(provider) || (x.role && x.role !== 'assistant')) continue;
      if (!x.time?.completed || !x.tokens) continue;
      const t = new Date(x.time.created);
      if (!Number.isFinite(t.getTime())) continue;
      const period = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
      const model = x.model?.id || x.modelID || 'unknown';
      const u = x.tokens;
      const breakdown = {input: u.input || 0, output: u.output || 0, cacheWrite: u.cache?.write || 0, cacheRead: u.cache?.read || 0};
      if (Object.values(breakdown).some(n => !Number.isFinite(n) || n < 0)) continue;
      const tokens = Object.values(breakdown).reduce((a,b)=>a+b,0);
      // OpenCode gateway cost zero is not evidence that priced token usage is free.
      const parts = model.startsWith('claude') ? claudeTokenCosts(model, {
        input_tokens: breakdown.input, output_tokens: breakdown.output,
        cache_creation_input_tokens: breakdown.cacheWrite, cache_read_input_tokens: breakdown.cacheRead,
      }) : codexTokenCosts(model, {input: breakdown.input + breakdown.cacheRead, cached: breakdown.cacheRead, output: breakdown.output});
      const cost = Object.values(parts).some(v => v == null) ? null : Object.values(parts).reduce((a,b)=>a+b,0);
      if (!days.has(period)) days.set(period, {period, agent:'opencode', tokens:0, cost:0, unknownTokens:0,
        models:new Map(), breakdown:{input:0,output:0,cacheWrite:0,cacheRead:0}, tokenCosts:{input:0,output:0,cacheWrite:0,cacheRead:0}});
      const day = days.get(period);
      day.tokens += tokens; day.cost += cost ?? 0; day.unknownTokens += cost == null ? tokens : 0;
      for (const k of Object.keys(breakdown)) {
        day.breakdown[k] += breakdown[k];
        if (breakdown[k] > 0) day.tokenCosts[k] = day.tokenCosts[k] == null || parts[k] == null ? null : day.tokenCosts[k] + parts[k];
      }
      const item = day.models.get(model) || {tokens:0,cost:0,unknownTokens:0};
      item.tokens += tokens; item.cost += cost ?? 0; item.unknownTokens += cost == null ? tokens : 0;
      day.models.set(model,item);
    }
    return [...days.values()];
  } finally { db.close(); }
}
