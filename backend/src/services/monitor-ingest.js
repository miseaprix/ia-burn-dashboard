import { stateStore } from '../storage/state-store.js';
import { normalizeMonitorEvent } from '../domain/monitor-event.js';
export { normalizeMonitorEvent } from '../domain/monitor-event.js';
export function ingestMonitor(body,options={}) {
  const {source,id,event,usage}=normalizeMonitorEvent(body,options);
  const store=options.store || stateStore(), db=store.db;
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=db.prepare('SELECT payload FROM monitor_events WHERE source=? AND id=?').get(source,id);
    if (existing) {
      const old=JSON.parse(existing.payload);
      if (old.signature!==event.signature) throw new Error('Conflicting event ID');
      db.exec('COMMIT');return {accepted:true,duplicate:true,eventId:id};
    }
    const prior=db.prepare('SELECT payload FROM monitor_sessions WHERE source=? AND id=?').get(source,event.sessionId);
    const session=prior ? JSON.parse(prior.payload) : {id:event.sessionId,source,harness:event.harness,dataset:event.dataset,
      machine:event.machine,startedAt:event.timestamp,endedAt:null,tools:[],agents:[],usage:null,tokens:null,eventCount:0};
    session.startedAt=session.startedAt<event.timestamp ? session.startedAt : event.timestamp;
    session.lastEventAt=!session.lastEventAt || event.timestamp>session.lastEventAt ? event.timestamp : session.lastEventAt;
    if (event.type==='SessionEnd' && (!session.endedAt || event.timestamp>session.endedAt)) session.endedAt=event.timestamp;
    for (const field of ['project','branch','ticket','hostname']) if (event[field] && (!prior || event.timestamp===session.lastEventAt || !session[field])) session[field]=event[field];
    if (event.tool && !session.tools.includes(event.tool)) session.tools=[...session.tools,event.tool].slice(0,100);
    if (event.agent && !session.agents.includes(event.agent)) session.agents=[...session.agents,event.agent].slice(0,100);
    if (usage && event.usageScope==='session') db.prepare(`INSERT INTO monitor_usage VALUES(?,?,?,?,?) ON CONFLICT(source,session_id,is_final) DO UPDATE SET
      measured_at=excluded.measured_at,payload=excluded.payload WHERE excluded.measured_at>=monitor_usage.measured_at`).run(source,event.sessionId,+usage.final,usage.measuredAt,JSON.stringify(usage));
    const best=db.prepare('SELECT payload FROM monitor_usage WHERE source=? AND session_id=? ORDER BY is_final DESC,measured_at DESC LIMIT 1').get(source,event.sessionId);
    session.usage=best ? JSON.parse(best.payload) : null;session.tokens=session.usage?.tokens ?? null;session.eventCount++;
    db.prepare('INSERT INTO monitor_events VALUES(?,?,?,?,?)').run(source,id,event.sessionId,event.timestamp,JSON.stringify({...event,id}));
    db.prepare(`INSERT INTO monitor_sessions VALUES(?,?,?,?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET
      started_at=excluded.started_at,project=excluded.project,ticket=excluded.ticket,machine=excluded.machine,payload=excluded.payload`).run(source,event.sessionId,session.startedAt,session.project||null,session.ticket||null,session.machine||null,JSON.stringify(session));
    db.exec('COMMIT');return {accepted:true,duplicate:false,eventId:id};
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
