import { existsSync } from 'node:fs';
import path from 'node:path';
import { stateStore } from '../storage/state-store.js';
import { historyDataset } from '../config/datasets.js';
import { corporateConfig } from '../config/corporate-config.js';
import { readSettings, saveSettings } from '../config/admin-settings.js';
import { ENTERPRISE, ENTERPRISE_LOCAL } from '../config/enterprise.js';

// This is a local single-user admin page, not a remotely accessible admin API.
export async function adminRoutes(app, {collector,calibration}) {
  async function localOnly(request,reply) {
    const host = request.headers.host || '';
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
    const origin = request.headers.origin;
    if (!local || request.headers['sec-fetch-site'] === 'cross-site' ||
      (origin && origin !== `http://${host}` && origin !== `https://${host}`))
      return reply.code(403).send({error:{message:'Administration is available only on localhost.'}});
    reply.header('Cache-Control','no-store');
  }
  async function view() {
    const config = await corporateConfig(),settings = readSettings();
    return {budget:Number(config.budget),baseUrl:config.baseUrl,hasApiKey:!!config.token,
      keySource:settings.secret ? 'admin' : config.token ? 'environment' : 'missing',
      localSeconds:collector.intervals.local/1000,quotaSeconds:collector.intervals.personal/1000,
      corporateSeconds:collector.intervals[ENTERPRISE]/1000};
  }
  app.get('/api/integrations',{preHandler:localOnly},async()=>{
    const config=await corporateConfig(),db=stateStore().db;
    const observed=source=>Object.fromEntries(db.prepare('SELECT harness,COUNT(*) AS days FROM daily_usage WHERE dataset=? GROUP BY harness').all(historyDataset(source)).map(r=>[r.harness,r.days>0]));
    const roots={claude:process.env.CLAUDE_CONFIG_DIR || '/data/claude',codex:process.env.CODEX_HOME || '/data/codex'};
    const configured={claude:existsSync(path.join(roots.claude,'.credentials.json')) || existsSync(process.env.CLAUDE_ACCOUNT_FILE || '/data/claude-account.json'),codex:existsSync(path.join(roots.codex,'auth.json'))};
    return {corporate:{configured:!!config.token && !!config.baseUrl},personal:{observed:observed('local'),configured},corporateLocal:{observed:observed(ENTERPRISE_LOCAL)},
      monitoring:{configured:process.env.MONITOR_INGEST_ENABLED==='1',events:db.prepare('SELECT COUNT(*) AS n FROM monitor_events').get().n,requests:db.prepare('SELECT COUNT(*) AS n FROM monitor_requests').get().n}};
  });
  app.get('/api/context/models',{preHandler:localOnly},()=>calibration.catalog());
  app.get('/api/admin/calibration/matrix',{preHandler:localOnly},()=>calibration.matrix());
  app.get('/api/admin/calibration',{preHandler:localOnly},()=>calibration.status());
  app.post('/api/admin/calibration/catalog',{preHandler:localOnly},async(request,reply)=>{
    try{return await calibration.discover();}catch{return reply.code(400).send({error:{message:'Catalog unavailable, missing key or campaign running. Previous tariffs retained.'}});}
  });
  app.post('/api/admin/calibration',{preHandler:localOnly,bodyLimit:4096},async(request,reply)=>{
    try{return reply.code(202).send(await calibration.start(request.body));}catch{return reply.code(400).send({error:{message:'Campaign refused: check key, isolation, selection, prices and budget; only one campaign may run.'}});}
  });
  app.post('/api/admin/calibration/reconcile',{preHandler:localOnly,bodyLimit:4096},async(request,reply)=>{
    try{
      if(Object.keys(request.body || {}).some(k=>k!=='runId'))throw new Error('Invalid reconciliation');
      return reply.code(202).send(await calibration.reconcile(request.body?.runId));
    }catch{return reply.code(400).send({error:{message:'Read-only reconciliation refused: active campaign, wrong account or missing evidence.'}});}
  });
  app.post('/api/admin/calibration/stop',{preHandler:localOnly},async()=>{await calibration.stop();return calibration.status();});
  app.get('/api/admin/settings',{preHandler:localOnly},view);
  app.put('/api/admin/settings',{preHandler:localOnly,bodyLimit:8192},async (request,reply) => {
    if(calibration.active || calibration.starting)return reply.code(409).send({error:{message:'Stop the calibration campaign before changing settings.'}});
    try {
      const previous = await corporateConfig();
      saveSettings(request.body, {isolateHistory: !!request.body?.apiKey && request.body.apiKey !== previous.token || !!request.body?.useEnvironmentKey && !!readSettings().secret});
    }
    catch { return reply.code(400).send({error:{message:'Invalid settings. Check the values and allowed intervals.'}}); }
    await collector.reconfigure();
    return view();
  });
}
