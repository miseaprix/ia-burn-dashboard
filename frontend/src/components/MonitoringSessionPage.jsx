import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { datasetLabels, measuredSessionsUrl, monitoringListUrl, monitoringOffset, monitoringUrl } from '../lib/monitoring.js';
import MonitoringPagination from './MonitoringPagination.jsx';
import MonitoringModelRequests from './MonitoringModelRequests.jsx';

const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
const number = new Intl.NumberFormat('fr-FR');
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const date = value => value ? dateFormat.format(new Date(value)) : '—';
const count = value => value == null ? '—' : number.format(value);
const measures = value => `${count(value)} ${value === 1 ? 'mesure' : 'mesures'}`;
const harnessLabels = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };
const eventLabels = { UserPromptSubmit: 'Message utilisateur', PostToolUse: 'Outil terminé',
  PostToolUseFailure: 'Échec d’un outil', Interrupt: 'Tour interrompu', PostCompact: 'Contexte compacté',
  SessionStart: 'Début de session', SessionEnd: 'Fin de session', Stop: 'Fin de tour' };

function SessionOverview({ session, summary, totalEvents, timelineSource }) {
  const hookUsage = session.usage;
  const fromMeasures = Boolean(summary?.usageCount);
  const hookInput = hookUsage && [hookUsage.input, hookUsage.cacheRead, hookUsage.cacheWrite].every(value => value != null)
    ? hookUsage.input + hookUsage.cacheRead + hookUsage.cacheWrite : null;
  const usage = fromMeasures ? summary.usage : { ...hookUsage, input: hookInput };
  const totalTokens = usage.input != null && usage.output != null ? usage.input + usage.output : null;
  const models = summary?.models.length ? summary.models : [hookUsage?.model].filter(Boolean);
  const costs = summary?.costs;
  const hasBilled = Boolean(costs?.billed.count);
  const primaryCost = hasBilled ? costs.billed : costs?.estimated.count ? costs.estimated : null;
  const hasCalls = Boolean(summary?.calls);
  const detail = [
    ['Identifiant', session.id], ['Ticket', session.ticket], ['Machine', session.machine],
    ['Démarrage', date(session.startedAt)], ['Dernière activité', date(session.lastEventAt ?? summary?.lastMeasurementAt)],
    ['Fin observée', date(session.endedAt)], ['Événements', count(totalEvents)],
  ];
  return <section className="card session-overview">
    <div className="session-overview-header">
      <div><span className="session-overview-kicker">Détail de la session</span>
        <h2>{session.project || harnessLabels[session.harness] || 'Session'}</h2></div>
      <div className="session-overview-tags">{[
        session.project && harnessLabels[session.harness], datasetLabels[session.dataset], ...models,
      ].filter(Boolean).map(label => <span key={label}>{label}</span>)}</div>
    </div>
    <dl className="session-kpis">
      <div><dt>Jetons observés</dt><dd>{count(totalTokens)}</dd><small>{fromMeasures
        ? `${measures(summary.completeUsage)} avec entrée et sortie`
        : hookUsage ? `Bilan de session ${hookUsage.final ? 'final' : 'provisoire'}` : 'Compteurs indisponibles'}</small></div>
      <div><dt>Tours observés</dt><dd>{count(summary?.turns)}</dd><small>{timelineSource === 'codex-log'
        ? 'Journal Codex' : summary?.turns != null ? 'Tours ou messages identifiés' : 'Nombre de tours indisponible'}</small></div>
      <div><dt>{hasCalls ? 'Appels au modèle' : 'Mesures du modèle'}</dt><dd>{count(hasCalls ? summary.calls : summary?.measurements)}</dd>
        <small>{hasCalls && summary.measurements !== summary.calls ? `${measures(summary.measurements)} au total` : 'Dans les mesures importées'}</small></div>
      <div><dt>{hasBilled ? 'Coût facturé' : 'Coût API estimé'}</dt><dd>{primaryCost ? usd.format(primaryCost.usd) : '—'}</dd>
        <small>{primaryCost ? `${measures(primaryCost.count)} ${primaryCost.count === 1 ? 'tarifée' : 'tarifées'}` : 'Coût indisponible'}</small>
        {hasBilled && costs.estimated.count > 0 && <small>API estimée sur {measures(costs.estimated.count)} · {usd.format(costs.estimated.usd)}</small>}</div>
    </dl>
    {(fromMeasures || hookUsage) && <dl className="session-token-breakdown">
      {[
        ['Entrée totale', usage.input], ['Sortie', usage.output], ['Lus en cache', usage.cacheRead], ['Écrits en cache', usage.cacheWrite],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{count(value)}</dd></div>)}
    </dl>}
    <details className="session-overview-details">
      <summary>Informations de session</summary>
      <dl className="monitor-metadata">{detail.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>
      ))}</dl>
    </details>
  </section>;
}

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
  const { session, summary, events, totalEvents, timelineSource, limit } = data;
  return (
    <article className="help-page monitor-session-page" lang="fr">
      <nav className="monitor-links" aria-label="Navigation de la session">
        <a href={monitoringListUrl()}>Sessions</a>
        <span aria-current="page">Détail de la session</span>
        <a href="#model-requests">Appels au modèle</a>
        <a href="#session-events">Événements</a>
        <a href={measuredSessionsUrl()}>Sessions avec mesures</a>
      </nav>
      <SessionOverview {...{ session, summary, totalEvents, timelineSource }}/>
      <MonitoringModelRequests source={source} id={id}/>
      <section className="card" id="session-events">
        <h2>Chronologie des événements</h2>
        {timelineSource && <p className="session-timeline-source">{count(totalEvents)} événements · {timelineSource === 'codex-log' ? 'Journal local Codex' : 'Hooks de session'}</p>}
        {events.length ? <div className="help-table-wrap">
          <table>
            <thead><tr><th>Heure</th><th>Événement</th><th>Outil ou skill</th><th>Commande ou script</th><th>Agent</th></tr></thead>
            <tbody>{events.map(event => (
              <tr key={event.id}>
                <td>{date(event.timestamp)}</td>
                <td>{eventLabels[event.type] ?? event.type}</td>
                <td>{event.skill || (event.mcpServer && event.mcpTool ? `${event.mcpServer} / ${event.mcpTool}` : event.tool) || '—'}</td>
                <td>{[...new Set([event.cli, event.command, event.script].filter(Boolean))].join(' / ') || '—'}</td>
                <td>{event.agent || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div> : <p>{totalEvents ? 'Aucun événement sur cette page.' : 'Aucun événement disponible pour cette session.'}</p>}
        <MonitoringPagination label="événements" offset={offset} limit={limit} total={totalEvents}
          href={next => monitoringUrl('monitor-session', { eventsOffset: next })}/>
      </section>
    </article>
  );
}
