import { stateStore } from '../storage/state-store.js';

// API exchanges are individual readings, never session snapshots or billed totals.
export function ingestProxy(body, {store=stateStore()}={}) {
  if (!body || body.schema_version!==1 || !['enterprise','accorgpt'].includes(body.dataset)) throw new Error('Invalid exchange');
  const text=(v,max=256)=>{
    if (v==null) return null;
    if (typeof v!=='string' || !v || v.length>max || /[\x00-\x1f\x7f]/.test(v)) throw new Error('Invalid metadata');
    return v;
  };
  const number=v=>{
    if (v==null) return null;
    if (!Number.isSafeInteger(v) || v<0) throw new Error('Invalid counter');
    return v;
  };
  const id=text(body.request_id),machine=text(body.machine_id),at=text(body.timestamp);
  if (!id || !machine || !at || !/Z$|[+-]\d{2}:\d{2}$/.test(at) || !Number.isFinite(Date.parse(at))) throw new Error('Invalid identity');
  const harness=text(body.harness);
  if (harness && !['claude','codex','opencode'].includes(harness)) throw new Error('Invalid harness');
  const status=number(body.status),ms=number(body.response_headers_ms);
  if (status==null || status<100 || status>599) throw new Error('Invalid status');
  const usage={};
  for (const key of ['input','output','cacheRead','cacheWrite','total']) usage[key]=number(body.usage?.[key]);
  const event={schema_version:1,dataset:'enterprise',request_id:id,machine_id:machine,timestamp:new Date(at).toISOString(),
    harness,session_id:text(body.session_id),client_request_id:text(body.client_request_id),
    project:text(body.project,1000),ticket:text(body.ticket),tool_use_id:text(body.tool_use_id),parent_tool_use_id:text(body.parent_tool_use_id),
    model:text(body.model),model_requested:text(body.model_requested),status,response_headers_ms:ms,
    stream:body.stream===true,response_complete:body.response_complete===true,usage};
  const payload=JSON.stringify(event),db=store.db;
  db.exec('BEGIN IMMEDIATE');
  try {
    const old=db.prepare('SELECT payload FROM monitor_requests WHERE machine=? AND id=?').get(machine,id);
    if (old && old.payload!==payload) throw new Error('Conflicting exchange');
    if (!old) db.prepare('INSERT INTO monitor_requests VALUES(?,?,?,?,?,?,?,?)').run(machine,id,event.timestamp,harness,event.session_id,event.project,event.ticket,payload);
    db.exec('COMMIT');return {accepted:true,duplicate:!!old,requestId:id};
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
