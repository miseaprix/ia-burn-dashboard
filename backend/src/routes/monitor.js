import { ingestProxy } from '../services/proxy-ingest.js';
import { monitorMetrics } from '../services/monitor-metrics.js';
import { ingestMonitor } from '../services/monitor-ingest.js';
import { stateStore } from '../storage/state-store.js';
import { periodRequest } from '../domain/period.js';
import { rangeToDates } from '../domain/providers.js';

export async function monitorRoutes(app) {
  async function localOnly(request,reply) {
    const host=request.headers.host || '',origin=request.headers.origin;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || request.headers['sec-fetch-site']==='cross-site' ||
        origin && origin!==`http://${host}` && origin!==`https://${host}`)
      return reply.code(403).send({error:{message:'Monitoring is available only on localhost.'}});
    reply.header('Cache-Control','no-store');
  }
  for (const [url,legacy] of [['/api/monitor/events',false],['/api/hook',true]])
    app.post(url,{preHandler:localOnly,bodyLimit:1048576},async (request,reply)=>{
      if (process.env.MONITOR_INGEST_ENABLED!=='1') return reply.code(503).send({error:{message:'Monitor ingestion is disabled.'}});
      try {return ingestMonitor(request.body,{legacy});}
      catch {return reply.code(400).send({error:{message:'Invalid monitoring event. Check its identity, timestamp and counters.'}});}
    });

  app.post('/api/monitor/requests',{preHandler:localOnly,bodyLimit:16384},async(request,reply)=>{
    if (process.env.MONITOR_INGEST_ENABLED!=='1') return reply.code(503).send({error:{message:'Monitor ingestion is disabled.'}});
    try {return ingestProxy(request.body);}
    catch {return reply.code(400).send({error:{message:'Invalid API exchange.'}});}
  });
  app.get('/api/monitor/requests',{preHandler:localOnly},async(request,reply)=>{
    const terms=[],args=[];
    let period;
    try {period=periodRequest({...request.query,range:request.query.range || 'all'});}
    catch(e) {return reply.code(400).send({error:{message:e.message}});}
    const dates=period.range==='custom' ? {start:period.from,end:period.to} : rangeToDates(period.range);
    if(dates.start) {terms.push('substr(timestamp,1,10)>=?');args.push(dates.start);}
    if(dates.end) {terms.push('substr(timestamp,1,10)<=?');args.push(dates.end);}
    for (const key of ['harness','project','ticket','machine','session_id']) if(request.query[key]) {
      const value=request.query[key];
      if(typeof value!=='string' || value.length>1000) return reply.code(400).send({error:{message:'Invalid filter'}});
      terms.push(`${key}=?`);args.push(value);
    }
    const offset=Number(request.query.offset || 0);
    if(!Number.isSafeInteger(offset) || offset<0) return reply.code(400).send({error:{message:'Invalid offset'}});
    const where=terms.length ? ' WHERE '+terms.join(' AND ') : '',db=stateStore().db;
    const summary=db.prepare(`SELECT COUNT(*) AS requests,
      SUM(CASE WHEN json_extract(payload,'$.status')>=400 THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN harness IS NULL THEN 1 ELSE 0 END) AS unknownHarness,
      SUM(CASE WHEN session_id IS NULL THEN 1 ELSE 0 END) AS unknownSession,
      AVG(json_extract(payload,'$.response_headers_ms')) AS avgResponseHeadersMs
      FROM monitor_requests${where}`).get(...args);
    const requests=db.prepare(`SELECT payload FROM monitor_requests${where} ORDER BY timestamp DESC,machine,id LIMIT 50 OFFSET ?`).all(...args,offset).map(r=>JSON.parse(r.payload));
    return {requests,summary,offset,limit:50,period:dates,basis:'Observed proxy exchanges; separate from session snapshots and gateway spend.'};
  });
  app.get('/api/monitor', {preHandler:localOnly}, async (request, reply) => {
    const q = request.query;
    let period;
    try { period=periodRequest({...q,range:q.range || 'all'}); }
    catch (e) { return reply.code(400).send({error:{message:e.message}}); }
    const dates=period.range==='custom' ? {start:period.from,end:period.to} : rangeToDates(period.range);
    const terms=[],args=[];
    if (dates.start) {terms.push('substr(s.started_at,1,10)>=?');args.push(dates.start);}
    if (dates.end) {terms.push('substr(s.started_at,1,10)<=?');args.push(dates.end);}
    for (const key of ['project','ticket','machine','source']) if (q[key]) {
      if (typeof q[key] !== 'string' || q[key].length>1000) return reply.code(400).send({error:{message:'Invalid filter'}});
      terms.push(`s.${key}=?`);args.push(q[key]);
    }
    const where=terms.length ? 'WHERE '+terms.join(' AND ') : '';
    const offset=Number(q.offset || 0);
    if (!Number.isSafeInteger(offset) || offset<0) return reply.code(400).send({error:{message:'Invalid offset'}});
    const db=stateStore().db;
    const summary=db.prepare(`SELECT COUNT(*) AS sessions,SUM(json_extract(payload,'$.tokens')) AS tokens,
      COUNT(*)-COUNT(json_extract(payload,'$.tokens')) AS missingUsage,SUM(json_extract(payload,'$.eventCount')) AS events
      FROM monitor_sessions s ${where}`).get(...args);
    const sessions=db.prepare(`SELECT payload FROM monitor_sessions s ${where} ORDER BY started_at DESC,source,id LIMIT 50 OFFSET ?`).all(...args,offset).map(r=>JSON.parse(r.payload));
    const filters={};
    for (const key of ['project','ticket','machine','source']) filters[key]=db.prepare(`SELECT DISTINCT ${key} AS value FROM monitor_sessions WHERE ${key} IS NOT NULL AND ${key}!='' ORDER BY ${key} LIMIT 200`).all().map(r=>r.value);
    const latest=db.prepare('SELECT MAX(timestamp) AS lastEventAt FROM monitor_events').get();
    const status={lastEventAt:latest.lastEventAt};
    return {sessions,summary,metrics:monitorMetrics(db,where,args),filters,offset,limit:50,period:dates,status,configured:process.env.MONITOR_INGEST_ENABLED==='1',
      basis:'Monitor snapshots; separate from dashboard usage totals. Dates filter session start (UTC).'};
  });
  app.get('/api/monitor/session', {preHandler:localOnly}, async (request,reply) => {
    const {source,id}=request.query;
    if (typeof source !== 'string' || typeof id !== 'string' || source.length>1000 || id.length>1000)
      return reply.code(400).send({error:{message:'Choose a session'}});
    const db=stateStore().db;
    const row=db.prepare('SELECT payload FROM monitor_sessions WHERE source=? AND id=?').get(source,id);
    if (!row) return reply.code(404).send({error:{message:'Session not found'}});
    const events=db.prepare('SELECT payload FROM monitor_events WHERE source=? AND session_id=? ORDER BY timestamp,id LIMIT 500').all(source,id).map(r=>JSON.parse(r.payload));
    const total=db.prepare('SELECT COUNT(*) AS count FROM monitor_events WHERE source=? AND session_id=?').get(source,id).count;
    return {session:JSON.parse(row.payload),events,totalEvents:total};
  });
}
