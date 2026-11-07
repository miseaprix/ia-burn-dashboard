import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { measuredSessionsUrl, monitoringOffset, monitoringUrl } from '../lib/monitoring.js';
import MonitoringPagination from './MonitoringPagination.jsx';

const number = new Intl.NumberFormat('fr-FR');
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
const kinds = {
  skill: 'Skill', mcp: 'MCP', tool: 'Outil', rule: 'Règle', memory: 'Mémoire', system: 'Système', message: 'Message',
};
const states = {
  name: 'Nom annoncé', description: 'Description envoyée', excerpt: 'Extrait envoyé',
  full: 'Contenu complet envoyé', body: 'Contenu détecté', called: 'Appel demandé par le modèle',
  instructions: 'Instructions envoyées', schema: 'Schéma envoyé', result: 'Résultat transmis',
};
const journalStates = {
  name: 'Nom dans le catalogue', description: 'Description dans le catalogue', full: 'Fichier complet vérifié dans un résultat',
  called: 'Appel journalisé', result: 'Résultat journalisé', failed: 'Appel en échec',
};
const granularities = { request: 'Appel modèle', message: 'Message assistant', turn: 'Tour' };
const sources = { 'claude-capture': 'Capture Claude Code', 'codex-log': 'Journal Codex', 'opencode-message': 'Base OpenCode', 'provider-report': 'Rapport fournisseur' };
const billing = { subscription: 'Abonnement', api: 'API à l’usage', local: 'Local' };
const n = value => value == null ? '—' : number.format(value);
const costLabel = cost => cost ? `${usd.format(cost.usd)} · ${cost.basis === 'billed' ? 'facturé' : 'estimé'}` : '—';

function ContextBlocks({ blocks, source }) {
  const journal = source === 'codex-log';
  const catalog = journal ? blocks?.filter(block => block.kind === 'skill' && ['name', 'description'].includes(block.state)) ?? [] : [];
  const details = journal ? blocks?.filter(block => block.kind !== 'skill' || !['name', 'description'].includes(block.state)) ?? [] : blocks ?? [];
  return <>
    {journal && <p>Journal Codex : catalogue observé et activité journalisée depuis la mesure précédente du tour.
      Les schémas des outils et des MCP ne sont pas disponibles dans cet import.</p>}
    {journal && <p>{[
      ['MCP', details.filter(block => block.kind === 'mcp' && block.state === 'called').length],
      ['Outils', details.filter(block => block.kind === 'tool' && block.state === 'called').length],
      ['Fichiers de skill vérifiés', details.filter(block => block.kind === 'skill' && block.state === 'full').length],
    ].map(([label, count]) => `${label} : ${n(count)}`).join(' · ')} (observés dans le journal)</p>}
    {!blocks?.length && <p>Détail du contexte indisponible pour cette mesure.</p>}
    {details.length > 0 && <ContextTable blocks={details} journal={journal}/>}
    {catalog.length > 0 && <details open={!details.length}>
      <summary>Catalogue de skills ({n(catalog.length)})</summary>
      <ContextTable blocks={catalog} journal/>
    </details>}
  </>;
}

function ContextTable({ blocks, journal }) {
  return <div className="help-table-wrap"><table>
    <thead><tr><th>Élément</th><th>État</th><th>Octets</th><th>Jetons estimés</th><th>Présence</th></tr></thead>
    <tbody>{blocks.map((block, index) => (
      <tr key={index}>
        <td><strong>{kinds[block.kind]}</strong>{block.name && <> · <code>{block.name}</code></>}
          {block.description && <div>{block.description}</div>}</td>
        <td>{block.kind === 'skill' && block.state === 'body' ? 'Contenu détecté, étendue inconnue' :
          (journal ? journalStates[block.state] : null) ?? states[block.state]}</td>
        <td>{n(block.bytes)}</td>
        <td>{n(block.estimatedTokens)}</td>
        <td>{block.repeated ? 'Renvoyé' : block.firstSeen ? 'Première apparition observée' : '—'}</td>
      </tr>
    ))}</tbody>
  </table></div>;
}

function TaskComparison({ comparison }) {
  if (!comparison) return null;
  return <section className="card">
    <h2>Comparaison des mesures de la tâche</h2>
    <p><code>{comparison.taskId}</code> · Les volumes regroupent les mesures importées pour cette tâche.</p>
    <div className="help-table-wrap"><table>
      <thead><tr><th>Configuration</th><th>Type de mesure</th><th>Mesures</th><th>Exécutions</th><th>Entrée totale</th><th>Sortie</th><th>Cache lu</th><th>Cache écrit</th><th>Durée cumulée</th><th>Coût</th></tr></thead>
      <tbody>{comparison.rows.map(row => (
        <tr key={JSON.stringify([row.orchestrator,row.harness,row.provider,row.model,row.gateway,row.billing,row.captureSource,row.granularity])}>
          <td>{[row.orchestrator,row.harness,row.provider,row.model,row.gateway,billing[row.billing]].filter(Boolean).join(' / ')}</td>
          <td>{granularities[row.granularity]} · {sources[row.captureSource]}</td>
          <td>{n(row.calls)}</td><td>{n(row.runs)}</td><td>{n(row.input)}</td><td>{n(row.output)}</td>
          <td>{n(row.cacheRead)}</td><td>{n(row.cacheWrite)}</td>
          <td>{row.durationMs == null ? '—' : `${n(row.durationMs)} ms`}</td>
          <td>{costLabel(row.usd == null ? null : { usd: row.usd, basis: row.costBasis })}</td>
        </tr>
      ))}</tbody>
    </table></div>
  </section>;
}

export default function MonitoringModelRequests({ source, id }) {
  const offset = monitoringOffset(new URLSearchParams(window.location.search), 'modelOffset');
  const [data, setData] = useState(null), [error, setError] = useState(false);
  useEffect(() => {
    const section = window.location.hash === '#model-requests' ? 'model-requests'
      : window.location.hash === '#session-events' ? 'session-events' : null;
    if (section) document.getElementById(section)?.scrollIntoView();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ source, id, offset });
    apiFetch(`/api/monitor/model-requests?${query}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('Model requests unavailable');
        return response.json();
      })
      .then(setData).catch(err => {
        if (err.name !== 'AbortError') setError(true);
      });
    return () => controller.abort();
  }, [source, id, offset]);
  return <>
    <section className="card" id="model-requests">
      <h2>Appels au modèle et contexte observé</h2>
      {error && <p role="alert">Impossible de charger les mesures par appel.</p>}
      {!data && !error && <p>Chargement des mesures…</p>}
      {data?.total === 0 && <p>Aucune mesure par appel importée pour cette session. <a href={measuredSessionsUrl()}>Voir les sessions avec mesures</a></p>}
      {data?.total > 0 && <>
        <p>Les jetons par bloc sont estimés à partir des octets. Certains blocs détaillent une partie d’un bloc parent.</p>
        {data.requests.map((request, index) => (
          <details className="monitor-request" key={request.id} open={index === 0}>
            <summary>{date.format(new Date(request.timestamp))} · {granularities[request.granularity]} · {request.model || 'Modèle inconnu'}</summary>
            <p>{[request.orchestrator, request.harness, request.provider, request.gateway, billing[request.billing], sources[request.captureSource]].filter(Boolean).join(' / ')}</p>
            <p><code>{request.id}</code>{request.turnId && <> · Tour <code>{request.turnId}</code></>}</p>
            <dl className="monitor-metadata">{[
              ['Entrée totale', n(request.usage.input)], ['Sortie', n(request.usage.output)],
              ['Cache lu', n(request.usage.cacheRead)], ['Cache écrit', n(request.usage.cacheWrite)],
              ['Raisonnement', n(request.usage.reasoning)], ['Octets de la requête', n(request.requestBytes)],
              ['Durée', request.durationMs == null ? '—' : `${n(request.durationMs)} ms`], ['Coût', costLabel(request.cost)],
            ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <ContextBlocks blocks={request.context} source={request.captureSource}/>
          </details>
        ))}
        <MonitoringPagination label="mesures" offset={offset} limit={data.limit} total={data.total}
          href={next => monitoringUrl('monitor-session', { modelOffset: next })}/>
      </>}
    </section>
    <TaskComparison comparison={data?.comparison}/>
  </>;
}
