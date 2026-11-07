import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { datasetLabels, hourMs, measuredSessionsUrl, monitoringListUrl, monitoringOffset, monitoringUrl } from '../lib/monitoring.js';
import ActivationPage from './ActivationPage.jsx';
import MonitoringPagination from './MonitoringPagination.jsx';
import MonitoringTimeFilter from './MonitoringTimeFilter.jsx';

export default function MonitoringPage({ onAdmin, onHelp }) {
  const [data, setData] = useState(null), [error, setError] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const sessionsOffset = monitoringOffset(params, 'sessionsOffset');
  const requestsOffset = monitoringOffset(params, 'requestsOffset');
  const modelOnly = params.get('modelOnly') === '1';
  const from = Date.parse(params.get('monitorFrom')), to = Date.parse(params.get('monitorTo'));
  const requestedWindow = params.get('monitorWindow');
  const windowType = requestedWindow === 'all' ? 'all'
    : requestedWindow === 'custom' && Number.isFinite(from) && Number.isFinite(to) && from <= to ? 'custom' : 'hour';
  const fromTime = windowType === 'custom' ? new Date(from).toISOString() : null;
  const toTime = windowType === 'custom' ? new Date(to).toISOString() : null;
  const loaded = data !== null;

  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    if (loaded && ['monitor-sessions', 'monitor-requests'].includes(anchor))
      document.getElementById(anchor)?.scrollIntoView();
  }, [loaded]);

  useEffect(() => {
    let active = true, busy = false, controller;
    async function load() {
      if (busy || document.hidden) return;
      busy = true;
      controller = new AbortController();
      const time = {};
      if (windowType === 'hour') {
        const now = Date.now();
        time.fromTime = new Date(now - hourMs).toISOString();
        time.toTime = new Date(now).toISOString();
      }
      if (windowType === 'custom') {
        time.fromTime = fromTime;
        time.toTime = toTime;
      }
      try {
        const urls = [
          '/api/monitor?' + new URLSearchParams({ ...time, offset: sessionsOffset, ...(modelOnly && { modelOnly: '1' }) }),
          '/api/monitor/requests?' + new URLSearchParams({ ...time, offset: requestsOffset }),
        ];
        const [sessions, requests] = await Promise.all(urls.map(async url => {
          const response = await apiFetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error('Monitoring unavailable');
          return response.json();
        }));
        if (active) { setData({ sessions, requests }); setError(false); }
      } catch (err) {
        if (active && err.name !== 'AbortError') setError(true);
      } finally { busy = false; }
    }
    load();
    const timer = setInterval(load, 60000);
    document.addEventListener('visibilitychange', load);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', load);
    };
  }, [windowType, fromTime, toTime, sessionsOffset, requestsOffset, modelOnly]);

  return (
    <article className="help-page" lang="fr">
      <MonitoringTimeFilter windowType={windowType} fromTime={fromTime} toTime={toTime}/>
      <nav className="monitor-links" aria-label="Vues des sessions">
        <a href={monitoringListUrl({ modelOnly: null, sessionsOffset: null })} aria-current={!modelOnly ? 'page' : undefined}>Toutes les sessions</a>
        <a href={measuredSessionsUrl()} aria-current={modelOnly ? 'page' : undefined}>Sessions avec mesures</a>
      </nav>
      {error && <div className="error-banner" role="alert">Impossible de lire les métriques Monitoring. Réessayez depuis localhost.</div>}
      {!data && !error && <p className="loading">Chargement du Monitoring…</p>}
      {data && !data.sessions.configured && !data.sessions.summary.sessions && !data.requests.summary.requests
        ? <ActivationPage kind="monitoring" waiting={false} onAdmin={onAdmin} onHelp={onHelp}/>
        : data && <>
          <section className="card">
            <h2>Métriques étendues</h2>
            <p>Les sessions sont filtrées par heure de démarrage. Les échanges API suivent leur propre horodatage.</p>
            <div className="monitor-summary">
              <div><strong>{data.sessions.summary.sessions}</strong><span>Sessions observées</span></div>
              <div><strong>{data.sessions.summary.events || 0}</strong><span>Événements des sessions</span></div>
              <div><strong>{data.requests.summary.requests}</strong><span>Échanges API</span></div>
              <div><strong>{data.requests.summary.unknownHarness || 0}</strong><span>Échanges sans harnais identifié</span></div>
            </div>
          </section>
          <section className="card" id="monitor-sessions">
            <h2>{modelOnly ? 'Sessions avec mesures' : 'Dernières sessions'}</h2>
            {data.sessions.sessions.length ? <div className="help-table-wrap">
              <table>
                <thead><tr><th>Projet</th><th>Ticket</th><th>Harnais</th><th>Événements</th><th>Session</th><th>Mesures</th></tr></thead>
                <tbody>{data.sessions.sessions.map(session => (
                  <tr key={JSON.stringify([session.source, session.id])}>
                    <td>{session.project || 'Non identifié'}</td>
                    <td>{session.ticket || 'Non identifié'}</td>
                    <td>{session.harness}</td>
                    <td>{session.eventCount}</td>
                    <td><a href={monitoringUrl('monitor-session', { monitorSource: session.source, session: session.id, eventsOffset: null, modelOffset: null })}
                      title={session.id} aria-label={`Voir le détail de la session ${session.id}`}>
                      {session.id.length > 16 ? `${session.id.slice(0, 12)}…` : session.id}
                    </a></td>
                    <td>{session.modelRequestCount > 0 ? <a href={monitoringUrl('monitor-session', {
                      monitorSource: session.source, session: session.id, eventsOffset: null, modelOffset: null,
                    }) + '#model-requests'}>{session.modelRequestCount}</a> : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div> : <p>{modelOnly ? 'Aucune session avec mesures sur cette page.' : 'Aucune session sur cette page.'}</p>}
            <MonitoringPagination label="sessions" offset={sessionsOffset} limit={data.sessions.limit || 50}
              total={data.sessions.summary.sessions} href={offset => monitoringUrl('monitoring', { sessionsOffset: offset }) + '#monitor-sessions'}/>
          </section>
          <section className="card" id="monitor-requests">
            <h2>Derniers échanges API</h2>
            {data.requests.requests.length ? <div className="help-table-wrap">
              <table>
                <thead><tr><th>Environnement</th><th>Modèle</th><th>Harnais</th><th>Statut HTTP</th><th>Jusqu’aux en-têtes</th></tr></thead>
                <tbody>{data.requests.requests.map(request => (
                  <tr key={JSON.stringify([request.dataset, request.machine_id, request.request_id])}>
                    <td>{datasetLabels[request.dataset] || 'Non identifié'}</td>
                    <td>{request.model || 'Non identifié'}</td>
                    <td>{request.harness || 'Non identifié'}</td>
                    <td>{request.status}</td>
                    <td>{request.response_headers_ms == null ? '—' : `${request.response_headers_ms} ms`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div> : <p>Aucun échange API sur cette page.</p>}
            <MonitoringPagination label="échanges API" offset={requestsOffset} limit={data.requests.limit || 50}
              total={data.requests.summary.requests} href={offset => monitoringUrl('monitoring', { requestsOffset: offset }) + '#monitor-requests'}/>
          </section>
        </>}
    </article>
  );
}
