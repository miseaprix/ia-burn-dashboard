import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { datasetLabels, measuredSessionsUrl, monitoringListUrl, monitoringOffset, monitoringUrl } from '../lib/monitoring.js';
import MonitoringPagination from './MonitoringPagination.jsx';
import MonitoringModelRequests from './MonitoringModelRequests.jsx';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
const number = new Intl.NumberFormat('fr-FR');
const date = value => value ? dateFormat.format(new Date(value)) : '—';

export default function MonitoringSessionPage() {
  const params = new URLSearchParams(window.location.search);
  const source = params.get('monitorSource'), id = params.get('session');
  const offset = monitoringOffset(params, 'eventsOffset');
  const [data, setData] = useState(null), [error, setError] = useState('');

  useEffect(() => {
    if (!source || !id) return;
    const controller = new AbortController();
    const query = new URLSearchParams({ source, id, offset, limit: 50 });
    apiFetch(`/api/monitor/session?${query}`, { signal: controller.signal }).then(async response => {
      if (response.status === 404) { setError('Cette session est introuvable.'); return; }
      if (!response.ok) throw new Error('Session unavailable');
      setData(await response.json());
    }).catch(err => {
      if (err.name !== 'AbortError') setError('Impossible de lire le détail de la session.');
    });
    return () => controller.abort();
  }, [source, id, offset]);

  if (!source || !id) return <p className="error-banner" role="alert">Ouvre une session depuis la liste Monitoring.</p>;
  if (error) return <p className="error-banner" role="alert">{error}</p>;
  if (!data) return <p className="loading">Chargement de la session…</p>;
  const { session, events, totalEvents, limit } = data;
  const usage = session.usage;
  const info = [
    ['Projet', session.project], ['Ticket', session.ticket], ['Harnais', session.harness],
    ['Environnement', datasetLabels[session.dataset]], ['Machine', session.machine],
    ['Démarrage', date(session.startedAt)], ['Dernier événement', date(session.lastEventAt)],
    ['Fin observée', date(session.endedAt)], ['Événements', number.format(totalEvents)],
  ];
  const tokenCounts = [
    ['Entrée hors cache', usage?.input], ['Sortie', usage?.output],
    ['Lus en cache', usage?.cacheRead], ['Écrits en cache', usage?.cacheWrite],
  ];
  return (
    <article className="help-page" lang="fr">
      <nav className="monitor-links" aria-label="Navigation de la session">
        <a href={monitoringListUrl()}>Sessions</a>
        <span aria-current="page">Détail de la session</span>
        <a href="#model-requests">Appels au modèle</a>
        <a href="#session-events">Événements</a>
        <a href={measuredSessionsUrl()}>Sessions avec mesures</a>
      </nav>
      <section className="card">
        <h2>Détail de la session</h2>
        <p><code>{session.id}</code></p>
        <dl className="monitor-metadata">{info.map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>
        ))}</dl>
      </section>
      <section className="card">
        <h2>Consommation observée</h2>
        {usage ? <>
          <p>{usage.model || 'Modèle non identifié'} · {usage.final ? 'Bilan final' : 'Bilan provisoire'}</p>
          <dl className="monitor-metadata">{tokenCounts.map(([label, value]) => (
            <div key={label}><dt>{label}</dt><dd>{value == null ? '—' : number.format(value)}</dd></div>
          ))}</dl>
        </> : <p>Aucun bilan de session remonté par les hooks. Les mesures disponibles par appel figurent ci-dessous.</p>}
      </section>
      <MonitoringModelRequests source={source} id={id}/>
      <section className="card" id="session-events">
        <h2>Chronologie des événements</h2>
        {events.length ? <div className="help-table-wrap">
          <table>
            <thead><tr><th>Heure</th><th>Événement</th><th>Outil ou skill</th><th>Commande ou script</th><th>Agent</th></tr></thead>
            <tbody>{events.map(event => (
              <tr key={event.id}>
                <td>{date(event.timestamp)}</td>
                <td>{event.type}</td>
                <td>{event.skill || (event.mcpServer && event.mcpTool ? `${event.mcpServer} / ${event.mcpTool}` : event.tool) || '—'}</td>
                <td>{[...new Set([event.cli, event.command, event.script].filter(Boolean))].join(' / ') || '—'}</td>
                <td>{event.agent || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div> : <p>Aucun événement sur cette page.</p>}
        <MonitoringPagination label="événements" offset={offset} limit={limit} total={totalEvents}
          href={next => monitoringUrl('monitor-session', { eventsOffset: next })}/>
      </section>
    </article>
  );
}
