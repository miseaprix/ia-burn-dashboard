import React, { useEffect, useId, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { groupContextBlocks, measuredSessionsUrl, monitoringOffset, monitoringUrl, rankSessionContext } from '../lib/monitoring.js';
import MonitoringPagination from './MonitoringPagination.jsx';
import './MonitoringModelRequests.css';

const number = new Intl.NumberFormat('fr-FR');
const usd = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'medium' });
const categories = {
  skill: ['Skills', 'M12 2l2.7 6.3L21 11l-6.3 2.7L12 20l-2.7-6.3L3 11l6.3-2.7L12 2zM19 15v6m-3-3h6'],
  mcp: ['MCP', 'M8 3v5m8-5v5M6 8h12v2a6 6 0 01-6 6v4m-6-10a6 6 0 006 6'],
  tool: ['Outils', 'M14 7a4 4 0 015-4l-3 3 2 2 3-3a4 4 0 01-5 5l-8 9a2 2 0 01-3-3l9-9z'],
  rule: ['Règles', 'M6 3h9l3 3v15H6zM14 3v4h4M9 11h6m-6 4h6'],
  memory: ['Mémoire', 'M4 5h16v4H4zM5 9v10h14V9m-9 4h4'],
  system: ['Système', 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4m6-4v4m-6 10v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4'],
  message: ['Messages', 'M4 4h16v12H9l-5 4zM8 8h8m-8 4h5'],
};
const categoryHelp = {
  system: ['Instructions générales que le harnais transmet au modèle. Elles peuvent inclure des éléments détaillés ailleurs.', '« Réponds en français. »'],
  message: ['Texte des échanges repris dans la requête, y compris les messages précédents.', '« Ajoute des tests à ce composant. »'],
  tool: ['Définitions des outils intégrés au harnais et activité observée autour de leurs appels.', 'Le schéma de Read ou le résultat d’une lecture de fichier.'],
  skill: ['Noms et descriptions du catalogue, ainsi que les instructions des skills dont le contenu a été repéré.', 'La description d’une skill de revue de code ou ses étapes de vérification.'],
  mcp: ['Outils fournis par des serveurs MCP. La vue peut inclure leur nom, leur schéma, leurs instructions ou leur résultat.', 'Le serveur remote-devices annonce un outil de navigation.'],
  memory: ['Notes persistantes reprises dans le contexte, comme des préférences ou des décisions passées.', 'Une note de MEMORY.md qui indique la commande de test habituelle.'],
  rule: ['Consignes du projet ou du poste repérées dans le contexte.', 'Une règle d’AGENTS.md qui demande de lancer npm test.'],
};
const icons = {
  request: 'M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5',
  usage: 'M4 19h16M7 15v-4m5 4V6m5 9V9',
  chevron: 'M9 6l6 6-6 6',
};
const states = {
  name: 'Nom annoncé', description: 'Description envoyée', excerpt: 'Extrait envoyé',
  full: 'Contenu complet envoyé', body: 'Contenu détecté', called: 'Appel demandé par le modèle',
  instructions: 'Instructions envoyées', schema: 'Schéma envoyé', result: 'Résultat transmis', failed: 'Appel en échec',
};
const journalStates = {
  name: 'Nom dans le catalogue', description: 'Description dans le catalogue', full: 'Fichier complet vérifié dans un résultat',
  called: 'Appel journalisé', result: 'Résultat journalisé', failed: 'Appel en échec',
};
const granularities = { request: 'Appel modèle', message: 'Message assistant', turn: 'Tour' };
const sources = { 'claude-capture': 'Capture Claude Code', 'codex-log': 'Journal Codex', 'opencode-message': 'Base OpenCode', 'opencode-request': 'Requête OpenCode', 'provider-report': 'Rapport fournisseur' };
const billing = { subscription: 'Abonnement', api: 'API à l’usage', local: 'Local' };
const n = value => value == null ? '—' : number.format(value);
const byteNumber = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const size = bytes => bytes >= 1e9 ? `${byteNumber.format(bytes / 1e9)} Go`
  : bytes >= 1e6 ? `${byteNumber.format(bytes / 1e6)} Mo`
    : bytes >= 1e3 ? `${byteNumber.format(bytes / 1e3)} Ko` : `${n(bytes)} o`;
const costLabel = cost => cost ? `${usd.format(cost.usd)} · ${cost.basis === 'billed' ? 'facturé' : 'estimé'}` : '—';

function Icon({ path }) {
  return <svg className="request-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>;
}

function CategoryLabel({ kind }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [label] = categories[kind];
  const [description, example] = categoryHelp[kind];
  return <span className="request-category-label"
    onPointerEnter={event => { if (event.pointerType === 'mouse') setOpen(true); }}
    onPointerLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setOpen(false); }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    <strong>{label}</strong>
    <button type="button" className="request-category-help" aria-label={`À propos de la catégorie ${label}`}
      aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onClick={event => {
        event.stopPropagation();
        event.currentTarget.focus();
        setOpen(true);
      }}><span aria-hidden="true">ⓘ</span></button>
    {open && <span id={id} className="request-category-tooltip" role="tooltip">
      <span>{description}</span><span><strong>Exemple</strong> · {example}</span>
    </span>}
  </span>;
}

const stateLabel = (kind, state, journal) => kind === 'skill' && state === 'body' ? 'Contenu détecté, étendue inconnue'
  : (journal ? journalStates[state] : null) ?? states[state] ?? state;
const roleLabels = { user: 'Utilisateur', assistant: 'Assistant', system: 'Système' };

function Totals({ bytes, estimatedTokens }) {
  return <span className="request-totals tabnum">
    <span title={bytes == null ? undefined : `${n(bytes)} octets`}>{bytes == null ? 'Taille inconnue' : size(bytes)}</span>
    {estimatedTokens != null && <strong>≈ {n(estimatedTokens)} jetons</strong>}
  </span>;
}

function ContextItem({ kind, item, journal, server }) {
  const toolName = server ? item.name.slice(server.length + 7) : null;
  const label = toolName || ((kind === 'message' ? roleLabels[item.name] : null) ?? item.name ?? 'Élément sans nom');
  return <details className="request-context-item">
    <summary className="request-item-summary">
      <span className="request-chevron"><Icon path={icons.chevron}/></span>
      <span className="request-item-name" title={toolName ? item.name : undefined}>{label}</span>
      <span className="request-tags">{item.states.map(state => <span key={state}>{stateLabel(kind, state, journal)}</span>)}</span>
    </summary>
    <ul className="request-observations">{item.blocks.map((block, index) => <li key={index}>
      <strong>{stateLabel(kind, block.state, journal)}</strong>
      <span className="request-observation-values">
        {block.bytes == null ? 'Taille inconnue' : `${n(block.bytes)} octets`}
        {block.estimatedTokens != null && <> · ≈ {n(block.estimatedTokens)} jetons</>}
        {block.repeated ? ' · Renvoyé' : block.firstSeen ? ' · Première apparition observée' : null}
      </span>
      {block.description && <p>{block.description}</p>}
    </li>)}</ul>
  </details>;
}

function ContextList({ items, render }) {
  const [limit, setLimit] = useState(12);
  return <div className="request-category-items">
    {items.slice(0, limit).map(render)}
    {items.length > 12 && <div className="request-item-pagination">
      <span>{n(Math.min(limit, items.length))} sur {n(items.length)} éléments</span>
      {items.length > limit && <button type="button" onClick={() => setLimit(limit + 12)}>Afficher la suite</button>}
    </div>}
  </div>;
}

const mcpServerLabel = name => name ?? 'Serveur non identifié';

function McpServer({ server, journal }) {
  return <details className="request-mcp-server">
    <summary className="request-category-summary">
      <span className="request-category-copy"><strong>{mcpServerLabel(server.name)}</strong>
        <span>{n(server.items.length)} {server.items.length === 1 ? 'élément' : 'éléments'}</span></span>
      <Totals {...server.totals}/>
      <span className="request-chevron"><Icon path={icons.chevron}/></span>
    </summary>
    <ContextList items={server.items} render={item => <ContextItem key={item.name} kind="mcp" item={item} journal={journal} server={server.name}/>}/>
  </details>;
}

function ContextCategory({ kind, items, servers, totals, stateCounts, journal }) {
  const [loaded, setLoaded] = useState(false);
  const [, icon] = categories[kind];
  const called = kind === 'skill' ? ['skill appelée', 'skills appelées'] : ['outil appelé', 'outils appelés'];
  const highlights = [['called', ...called], ['full', 'contenu complet', 'contenus complets'],
    ['schema', 'schéma', 'schémas'], ['description', 'description', 'descriptions'], ['name', 'nom', 'noms']]
    .filter(([key]) => stateCounts[key])
    .map(([key, singular, plural]) => `${n(stateCounts[key])} ${stateCounts[key] > 1 ? plural : singular}`);
  return <details className="request-category" data-category={kind} onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open) setLoaded(true);
  }}>
    <summary className="request-category-summary">
      <span className="request-category-icon"><Icon path={icon}/></span>
      <span className="request-category-copy">
        <CategoryLabel kind={kind}/>
        {highlights.length > 0 && <span>{highlights.join(' · ')}</span>}
      </span>
      <Totals {...totals}/>
      <span className="request-count" aria-label={`${n(items.length)} élément${items.length > 1 ? 's' : ''}`}>{n(items.length)}</span>
      <span className="request-chevron"><Icon path={icons.chevron}/></span>
    </summary>
    {loaded && (servers
      ? <ContextList items={servers} render={server => <McpServer key={server.name} server={server} journal={journal}/>}/>
      : <ContextList items={items} render={item => <ContextItem key={item.name} kind={kind} item={item} journal={journal}/>}/>)}
  </details>;
}

function ContextBlocks({ blocks, source }) {
  const groups = groupContextBlocks(blocks);
  if (!groups.length) return <p className="request-empty">Détail du contexte indisponible pour cette mesure.</p>;
  const journal = source === 'codex-log';
  return <div className="request-context">
    <h3>Contexte {journal ? 'observé' : 'de la requête'}</h3>
    {journal && <p className="request-context-note">Catalogue et activité relevés dans le journal Codex. Les schémas et le corps complet de la requête restent indisponibles.</p>}
    <div className="request-categories">{groups.map(group => <ContextCategory key={group.kind} {...group} journal={journal}/>)}</div>
  </div>;
}

function ContextBar({ tokens, max }) {
  if (tokens == null || !max) return null;
  return <span className="request-bar" aria-hidden="true"><span style={{ width: `${100 * tokens / max}%` }}/></span>;
}

function SessionContext({ summary, total }) {
  if (!summary?.groups.length) return null;
  const groups = rankSessionContext(summary.groups);
  const max = groups[0]?.estimatedTokens;
  return <section className="request-session-context" aria-label="Poids du contexte sur la session">
    <h3>Poids du contexte sur la session</h3>
    <p className="request-context-note">
      Contexte disponible sur {n(summary.measuredRequests)} des {n(total)} mesures.
      La plus grande estimation fixe l’échelle. Les blocs peuvent se recouvrir, et les barres ne représentent pas un coût facturé.
    </p>
    <ul>{groups.map(({ kind, servers, ...totals }) => {
      const [, icon] = categories[kind];
      const row = <>
        <span className="request-category-icon"><Icon path={icon}/></span>
        <CategoryLabel kind={kind}/>
        <Totals {...totals}/>
        <ContextBar tokens={totals.estimatedTokens} max={max}/>
      </>;
      return <li key={kind} className="request-rank" data-category={kind}>
        {servers.length ? <details>
          <summary className="request-rank-row">{row}<span className="request-chevron"><Icon path={icons.chevron}/></span></summary>
          <ul className="request-rank-servers">{[...servers].sort((a, b) => (b.estimatedTokens ?? -1) - (a.estimatedTokens ?? -1)).map(server => (
            <li key={server.server} className="request-rank-row">
              <strong>{mcpServerLabel(server.server)}</strong><Totals {...server}/>
              <ContextBar tokens={server.estimatedTokens} max={max}/>
            </li>
          ))}</ul>
        </details> : <div className="request-rank-row">{row}</div>}
      </li>;
    })}</ul>
  </section>;
}

function Measurement({ request, initiallyOpen }) {
  const [loaded, setLoaded] = useState(initiallyOpen);
  const hasContext = Boolean(request.context?.length);
  const evidence = hasContext ? request.captureSource === 'codex-log' ? 'Contexte journalisé' : 'Requête capturée' : 'Compteurs seuls';
  const input = request.usage.input, output = request.usage.output;
  const provenance = [request.orchestrator, request.harness, request.provider, request.gateway, billing[request.billing]]
    .filter(Boolean).join(' · ');
  return <details className="monitor-request" open={initiallyOpen} onToggle={event => {
    if (event.target === event.currentTarget && event.currentTarget.open) setLoaded(true);
  }}>
    <summary className="request-summary">
      <span className="request-category-icon"><Icon path={icons.request}/></span>
      <span className="request-title">
        <strong>{request.model || 'Modèle inconnu'}</strong>
        <span>{granularities[request.granularity]} · <time dateTime={request.timestamp}>{date.format(new Date(request.timestamp))}</time></span>
      </span>
      <span className="request-signal">
        <span className="request-evidence" data-evidence={hasContext ? request.captureSource : 'usage'}>{evidence}</span>
        {(input != null || output != null) ? <span className="request-preview tabnum">{n(input)} en entrée · {n(output)} en sortie</span>
          : hasContext && <span className="request-preview tabnum">{n(request.context.length)} {request.context.length === 1 ? 'bloc' : 'blocs'}</span>}
      </span>
      <span className="request-chevron"><Icon path={icons.chevron}/></span>
    </summary>
    {loaded && <div className="request-body">
      <details className="request-category" data-category="usage">
        <summary className="request-category-summary">
          <span className="request-category-icon"><Icon path={icons.usage}/></span>
          <span className="request-category-copy"><strong>Consommation et provenance</strong><span>{sources[request.captureSource]}</span></span>
          <span className="request-chevron"><Icon path={icons.chevron}/></span>
        </summary>
        <div className="request-usage">
          <dl>{[
            ['Entrée totale', n(input)], ['Sortie', n(output)],
            ['Cache lu', n(request.usage.cacheRead)], ['Cache écrit', n(request.usage.cacheWrite)],
            ['Raisonnement', n(request.usage.reasoning)], ['Octets de la requête', n(request.requestBytes)],
            ['Durée', request.durationMs == null ? '—' : `${n(request.durationMs)} ms`], ['Coût', costLabel(request.cost)],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd className="tabnum">{value}</dd></div>)}</dl>
          {provenance && <p>{provenance}</p>}
          <p>Référence <code>{request.id}</code>{request.turnId && <> · Tour <code>{request.turnId}</code></>}</p>
        </div>
      </details>
      <ContextBlocks blocks={request.context} source={request.captureSource}/>
    </div>}
  </details>;
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
  const requests = data?.requests ?? [];
  const initialRequest = requests.find(request => request.context?.some(block => ['skill', 'mcp', 'tool'].includes(block.kind)))
    ?? requests.find(request => request.context?.length) ?? requests[0];
  return <>
    <section className="card" id="model-requests">
      <h2>Appels au modèle et contexte observé</h2>
      {error && <p role="alert">Impossible de charger les mesures par appel.</p>}
      {!data && !error && <p>Chargement des mesures…</p>}
      {data?.total === 0 && <p>Aucune mesure par appel importée pour cette session. <a href={measuredSessionsUrl()}>Voir les sessions avec mesures</a></p>}
      {data?.total > 0 && <>
        <SessionContext summary={data.contextSummary} total={data.total}/>
        <p className="request-context-note">Ouvre une mesure, puis une catégorie et un élément. Les totaux additionnent les valeurs disponibles.</p>
        <div className="request-list">{requests.map(request => (
          <Measurement key={request.id} request={request} initiallyOpen={request === initialRequest}/>
        ))}</div>
        <MonitoringPagination label="mesures" offset={offset} limit={data.limit} total={data.total}
          href={next => monitoringUrl('monitor-session', { modelOffset: next })}/>
      </>}
    </section>
    <TaskComparison comparison={data?.comparison}/>
  </>;
}
