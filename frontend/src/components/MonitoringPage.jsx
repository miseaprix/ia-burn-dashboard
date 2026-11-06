import {apiFetch} from '../lib/api.js';
import React,{useEffect,useState} from 'react';
import ActivationPage from './ActivationPage.jsx';
export default function MonitoringPage({integration,onAdmin,onHelp}) {
  const [data,setData]=useState(null),[error,setError]=useState(false);
  useEffect(()=>{let active=true,busy=false;let controller;
    async function load() {
      if(busy || document.hidden)return;
      busy=true;controller=new AbortController();
      try {
        const [sessions,requests]=await Promise.all(['/api/monitor?range=all','/api/monitor/requests'].map(async url=>{const r=await apiFetch(url,{signal:controller.signal});if(!r.ok)throw new Error();return r.json();}));
        if(active){setData({sessions,requests});setError(false);}
      } catch(e) {if(active && e.name!=='AbortError')setError(true);}
      finally {busy=false;}
    }
    load();const timer=setInterval(load,60000);const visible=()=>{if(!document.hidden)load();};document.addEventListener('visibilitychange',visible);
    return()=>{active=false;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[]);
  if(error)return <div className="error-banner" role="alert">Impossible de lire les métriques Monitoring. Réessayez depuis localhost.</div>;
  if(!data)return <p className="loading">Chargement du Monitoring…</p>;
  const hasData=data.sessions.summary.sessions>0 || data.requests.summary.requests>0;
  if(!hasData)return <ActivationPage kind="monitoring" waiting={data.sessions.configured} onAdmin={onAdmin} onHelp={onHelp}/>;
  return <article className="help-page" lang="fr"><section className="card"><h2>Métriques étendues <span className="activation-state">Collecte reçue</span></h2><p>Échanges API et événements locaux restent séparés des dépenses et des bilans de tokens du dashboard.</p><div className="monitor-summary"><div><strong>{data.sessions.summary.sessions}</strong><span>Sessions observées</span></div><div><strong>{data.sessions.summary.events || 0}</strong><span>Événements locaux</span></div><div><strong>{data.requests.summary.requests}</strong><span>Échanges API</span></div><div><strong>{data.requests.summary.unknownHarness || 0}</strong><span>Échanges sans harnais identifié</span></div></div></section>
    <section className="card"><h2>Dernières sessions</h2>{!data.sessions.sessions.length ? <p>Les hooks des harnais n’ont pas encore transmis de sessions. <button className="activation-secondary" onClick={onHelp}>Voir la configuration</button></p> : <div className="help-table-wrap"><table><thead><tr><th>Projet</th><th>Ticket</th><th>Harnais</th><th>Événements</th></tr></thead><tbody>{data.sessions.sessions.map(s=><tr key={s.source+s.id}><td>{s.project || 'Non identifié'}</td><td>{s.ticket || 'Non identifié'}</td><td>{s.harness}</td><td>{s.eventCount}</td></tr>)}</tbody></table></div>}</section>
    <section className="card"><h2>Derniers échanges API</h2><div className="help-table-wrap"><table><thead><tr><th>Modèle</th><th>Harnais</th><th>Statut HTTP</th><th>Jusqu’aux en-têtes</th></tr></thead><tbody>{data.requests.requests.map(r=><tr key={r.machine_id+r.request_id}><td>{r.model || 'Non identifié'}</td><td>{r.harness || 'Non identifié'}</td><td>{r.status}</td><td>{r.response_headers_ms==null ? '—' : `${r.response_headers_ms} ms`}</td></tr>)}</tbody></table></div></section></article>;
}
