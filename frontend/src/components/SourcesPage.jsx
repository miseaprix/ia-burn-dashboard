import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiFetch } from '../lib/api.js';

function ago(ts) {
  if (!ts) return null;
  const ms = Date.now() - ts;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 3600000)}h`;
}

function nodeStatus(ok, fresh) {
  if (!ok) return 'down';
  if (!fresh) return 'stale';
  return 'ok';
}

const FIX_HINTS = {
  'claude-api': {
    down: [
      "Le token OAuth Claude a expiré.",
      "Le token est lu depuis ~/.claude/.credentials.json (monté en lecture seule dans le conteneur à /data/claude/.credentials.json).",
      "Pour le régénérer : ouvrez un terminal et lancez une session Claude Code (commande \"claude\"). L'authentification OAuth se fait automatiquement et écrit le nouveau token dans ~/.claude/.credentials.json.",
      "Le conteneur Docker le voit immédiatement (volume bind monté en ro).",
      "Vérification : docker compose exec ia-burn cat /data/claude/.credentials.json | jq .claudeAiOauth.accessToken",
    ],
    stale: [
      "Les données Claude sont obsolètes (pas de lecture récente).",
      "Vérifiez que le conteneur tourne : docker compose ps",
      "Vérifiez les logs du collecteur : docker compose logs -f ia-burn --since 5m",
      "Si le token est valide mais le quota non-lu, le collecteur réessaiera au prochain cycle (toutes les ~60s).",
    ],
  },
  'codex-api': {
    down: [
      "Pas de token Codex (auth.json absent ou invalide).",
      "Le token est lu depuis ~/.codex/auth.json (monté à /data/codex/auth.json dans le conteneur).",
      "Pour le générer : ouvrez un terminal et lancez \"codex\". L'authentification crée ~/.codex/auth.json automatiquement.",
      "Vérification : docker compose exec ia-burn cat /data/codex/auth.json | jq .tokens.access_token",
      "Si CODEX_DATA_DIR est défini dans votre .env, vérifiez qu'il pointe vers le bon répertoire.",
    ],
    stale: [
      "Les données Codex sont obsolètes.",
      "Vérifiez les logs : docker compose logs -f ia-burn --since 5m | grep -i codex",
      "Le token peut avoir expiré silencieusement — relancez \"codex\" dans un terminal pour le renouveler.",
    ],
  },
  'quota-collector': {
    down: [
      "Le collecteur de quotas ne répond pas.",
      "Vérifiez que le conteneur tourne : docker compose ps",
      "Consultez les logs : docker compose logs -f ia-burn --since 5m",
      "Le collecteur est un timer interne au serveur Node.js — s'il est down, le conteneur est probablement en erreur ou redémarre.",
      "Redémarrage : docker compose restart ia-burn",
    ],
  },
  'usage-collector': {
    down: [
      "Le collecteur d'usage ne répond pas.",
      "Il lit les logs JSONL directement depuis les volumes montés :",
      "• Claude : ~/.claude → /data/claude (défini par CLAUDE_DATA_DIR ou ~/.claude par défaut)",
      "• Codex : ~/.codex → /data/codex (défini par CODEX_DATA_DIR ou ~/.codex par défaut)",
      "Vérifiez les montages : docker compose exec ia-burn ls -la /data/claude /data/codex",
    ],
  },
  'claude-logs': {
    ok: [
      "Logs JSONL des sessions Claude Code.",
      "Chemin hôte : ~/.claude/projects/*/*.jsonl",
      "Chemin conteneur : /data/claude/projects/*/*.jsonl",
      "Le collecteur parse les blocs \"usage\" de chaque message pour extraire les tokens consommés par modèle et par jour.",
    ],
  },
  'codex-logs': {
    ok: [
      "Logs JSONL des sessions Codex CLI.",
      "Chemin hôte : ~/.codex/sessions/*/*.jsonl et ~/.codex/archived_sessions/*/*.jsonl",
      "Chemin conteneur : /data/codex/sessions/ et /data/codex/archived_sessions/",
      "Le collecteur lit les événements \"token_count\" des 24 fichiers les plus récents.",
    ],
  },
  'archive': {
    ok: [
      "Historique des quotas collecté par l'app native Agent Burn (macOS).",
      "Chemin hôte : ~/Library/Application Support/Agent Burn/quota-archive.json",
      "Chemin conteneur : /data/agent-burn-history/quota-archive.json",
      "Activé via docker-compose.native-cache.yml (compose override).",
      "Si non activé : ce noeud est ignoré, les quotas viennent directement de l'API.",
    ],
  },
  'cache': {
    ok: [
      "Cache de la dernière réponse quota Claude, écrit par l'app native Agent Burn.",
      "Chemin hôte : ~/Library/Caches/agent-burn/claude-usage.json",
      "Chemin conteneur : /data/agent-burn-cache/claude-usage.json",
      "Activé via docker-compose.native-cache.yml.",
      "Utilisé comme fallback quand le token OAuth est expiré mais le cache est encore frais (< 15 min).",
    ],
  },
  'account': {
    down: [
      "Le fichier claude-account.json est manquant ou obsolète.",
      "Chemin hôte : ~/.claude.json (configurable via CLAUDE_ACCOUNT_PATH dans .env)",
      "Chemin conteneur : /data/claude-account.json",
      "Ce fichier est généré par Claude Code lors de l'authentification OAuth. Lancez \"claude\" dans un terminal pour le créer.",
      "Monté via docker-compose.personal.yml (optionnel, doit être inclus dans votre commande docker compose).",
      "Vérification : docker compose exec ia-burn cat /data/claude-account.json | jq .oauthAccount.accountUuid",
    ],
    ok: [
      "Informations de compte Claude (tier, plan, UUID).",
      "Chemin hôte : ~/.claude.json",
      "Chemin conteneur : /data/claude-account.json",
      "Monté via docker-compose.personal.yml.",
    ],
  },
  'dashboard': {
    ok: [
      "Point d'entrée du dashboard IA Burn.",
      "Le serveur Node.js (Fastify) sert le frontend React et l'API.",
      "Port : 8080 interne, exposé sur BURN_PORT (défaut 4090, voir docker-compose.yml).",
      "Config Docker : docker-compose.yml + overrides optionnels (.personal.yml, .native-cache.yml).",
    ],
  },
  'agent-burn': {
    ok: [
      "App native macOS (launchd) qui collecte les quotas toutes les 60s.",
      "Les données sont stockées dans ~/Library/Application Support/Agent Burn/ et ~/Library/Caches/agent-burn/.",
      "Pour activer dans Docker : ajoutez -f docker-compose.native-cache.yml à votre commande docker compose.",
      "Sans cette app, les quotas sont lus directement via les tokens OAuth dans le conteneur.",
    ],
  },
};

function buildTree(data) {
  if (!data) return null;
  const { collectors, claude, codex } = data;
  const personal = collectors.personal;
  const local = collectors.local;

  const claudeOk = !!claude.burndown;
  const codexOk = !!codex.burndown;

  return {
    id: 'dashboard', label: 'Dashboard', sub: 'Serveur · localhost:4095',
    type: 'affichage', status: 'ok', detail: 'Fastify + React',
    children: [
      {
        id: 'quota-collector', label: 'Quota collector',
        sub: `Timer · cycle ${Math.round((personal.intervalMs || 60000) / 1000)}s`,
        type: 'traitement',
        status: nodeStatus(!personal.error && !!personal.lastSuccess, true),
        detail: personal.error || (personal.lastSuccess ? `${ago(personal.lastSuccess)} ago` : 'waiting'),
        children: [
          {
            id: 'claude-api', label: 'Claude API',
            sub: 'API · api.anthropic.com/oauth/usage',
            type: 'source',
            status: nodeStatus(claudeOk, claude.burndown?.fresh),
            detail: claudeOk ? `${ago(Date.parse(claude.burndown.observedAt))} ago` : 'token expired',
            children: [],
          },
          {
            id: 'codex-api', label: 'Codex API',
            sub: 'API · chatgpt.com/wham/usage',
            type: 'source',
            status: nodeStatus(codexOk, codex.burndown?.fresh),
            detail: codexOk ? `${ago(Date.parse(codex.burndown.observedAt))} ago` : 'no token',
            children: [],
          },
        ],
      },
      {
        id: 'usage-collector', label: 'Usage collector',
        sub: `Timer · cycle ${Math.round((local.intervalMs || 60000) / 1000)}s`,
        type: 'traitement',
        status: nodeStatus(!local.error && !!local.lastSuccess, true),
        detail: local.error || (local.lastSuccess ? `${ago(local.lastSuccess)} ago` : 'waiting'),
        children: [
          {
            id: 'claude-logs', label: 'Claude logs',
            sub: 'Fichier · ~/.claude/projects/**/*.jsonl',
            type: 'source', status: 'ok', detail: 'JSONL sessions',
            children: [],
          },
          {
            id: 'codex-logs', label: 'Codex logs',
            sub: 'Fichier · ~/.codex/sessions/**/*.jsonl',
            type: 'source', status: 'ok', detail: 'JSONL sessions',
            children: [],
          },
        ],
      },
      {
        id: 'agent-burn', label: 'Agent Burn',
        sub: 'App · launchd macOS (60s)',
        type: 'traitement', status: 'ok', detail: 'native quota cache',
        children: [
          {
            id: 'archive', label: 'quota-archive',
            sub: 'Fichier · quota-archive.json',
            type: 'source', status: 'ok',
            detail: '~/Library/Application Support/Agent Burn/',
            children: [],
          },
          {
            id: 'cache', label: 'claude-usage',
            sub: 'Fichier · claude-usage.json',
            type: 'source', status: 'ok',
            detail: '~/Library/Caches/agent-burn/',
            children: [],
          },
          {
            id: 'account', label: 'claude-account',
            sub: 'Fichier · ~/.claude.json',
            type: 'source',
            status: claudeOk ? 'ok' : 'down',
            detail: claudeOk ? 'account info' : 'manquant',
            children: [],
          },
        ],
      },
    ],
  };
}

// Recursive layout: returns flat node list with x,y coordinates
const NODE_W = 200, NODE_H = 44, H_GAP = 36, V_GAP = 22;

function layoutTree(root) {
  const nodes = [];
  const edges = [];

  function subtreeHeight(node) {
    if (!node.children.length) return NODE_H;
    return node.children.reduce((s, c) => s + subtreeHeight(c) + V_GAP, -V_GAP);
  }

  function layout(node, x, yCenter, parentId) {
    node.x = x;
    node.y = yCenter - NODE_H / 2;
    nodes.push(node);
    if (parentId) edges.push({ from: parentId, to: node.id });

    if (!node.children.length) return;
    const totalH = subtreeHeight(node);
    let cy = yCenter - totalH / 2;
    for (const child of node.children) {
      const ch = subtreeHeight(child);
      layout(child, x + NODE_W + H_GAP, cy + ch / 2, node.id);
      cy += ch + V_GAP;
    }
  }

  const totalH = subtreeHeight(root);
  layout(root, 20, totalH / 2 + 20, null);
  // Mirror: sources (leaves) on left, dashboard (root) on right
  const maxX = Math.max(...nodes.map(n => n.x + NODE_W));
  const pad = 20;
  for (const n of nodes) n.x = maxX + pad - n.x - NODE_W;
  return { nodes, edges, width: 0, height: totalH + 40 };
}

const STATUS_COLORS = {
  ok: '#22c55e',
  stale: '#f59e0b',
  down: '#ef4444',
};

const TYPE_COLORS = {
  source: { border: '#60a5fa', bg: 'rgba(96,165,250,0.08)' },
  traitement: { border: '#a78bfa', bg: 'rgba(167,139,250,0.08)' },
  affichage: { border: '#f59e0b', bg: 'rgba(245,158,11,0.08)' },
};

function NodeDetail({ node, onClose }) {
  if (!node) return null;
  const color = STATUS_COLORS[node.status] || STATUS_COLORS.ok;
  const hint = FIX_HINTS[node.id]?.[node.status];
  const hintLines = Array.isArray(hint) ? hint : hint ? [hint] : null;
  const isError = node.status === 'down' || node.status === 'stale';
  return (
    <div className="node-detail-panel">
      <div className="node-detail-header">
        <i className="legend-dot" style={{ background: color }} />
        <strong>{node.label}</strong>
        <button className="node-detail-close" onClick={onClose}>×</button>
      </div>
      <dl className="node-detail-dl">
        <dt>Statut</dt>
        <dd style={{ color }}>{node.status === 'ok' ? 'OK' : node.status === 'stale' ? 'Stale' : 'Down'}</dd>
        <dt>Source</dt>
        <dd>{node.sub}</dd>
        <dt>Détail</dt>
        <dd>{node.detail}</dd>
      </dl>
      {hintLines && (
        <div className={isError ? 'node-detail-fix' : 'node-detail-info'}>
          <strong>{isError ? '⚠ Correction' : 'i Détails'}</strong>
          {hintLines.map((line, i) => (
            <p key={i} className={/^(docker |codex |claude |Vérification|Redmarrage|Consultez)/.test(line) ? 'hint-cmd' : undefined}>{line}</p>
          ))}
        </div>
      )}
      {!hintLines && node.status === 'ok' && (
        <div className="node-detail-ok">Ce noeud fonctionne normalement.</div>
      )}
    </div>
  );
}

function TreeDiagram({ data, selected, onSelect }) {
  const tree = buildTree(data);
  if (!tree) return null;

  const { nodes, edges, height } = layoutTree(tree);
  const nodeMap = Object.fromEntries(nodes.map(n => [n.id, n]));
  const maxX = Math.max(...nodes.map(n => n.x + NODE_W));
  const contentW = maxX + 40;
  const contentH = height;

  const containerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef(null);
  const [hovered, setHovered] = useState(null);
  const [nodePositions, setNodePositions] = useState({});
  const nodeDrag = useRef(null);

  useEffect(() => {
    const id = setInterval(() => {}, 2000);
    return () => clearInterval(id);
  }, []);

  // Fit content on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    const fit = Math.min(scaleX, scaleY, 1.2) * 0.9;
    setZoom(fit);
    setPan({
      x: (rect.width - contentW * fit) / 2,
      y: (rect.height - contentH * fit) / 2,
    });
  }, [contentW, contentH]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(z => {
      const nz = Math.min(Math.max(z * factor, 0.2), 3);
      setPan(p => ({
        x: mx - (mx - p.x) * (nz / z),
        y: my - (my - p.y) * (nz / z),
      }));
      return nz;
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (nodeDrag.current) return;
    dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false };
  }, [pan]);

  const onMouseMove = useCallback((e) => {
    if (nodeDrag.current) {
      const dx = (e.clientX - nodeDrag.current.startX) / zoom;
      const dy = (e.clientY - nodeDrag.current.startY) / zoom;
      if (!nodeDrag.current.moved && Math.abs(dx) + Math.abs(dy) > 3) {
        nodeDrag.current.moved = true;
        setDragging(true);
      }
      if (nodeDrag.current.moved) {
        setNodePositions(prev => ({
          ...prev,
          [nodeDrag.current.nodeId]: {
            x: nodeDrag.current.origX + dx,
            y: nodeDrag.current.origY + dy,
          },
        }));
      }
      return;
    }
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    if (!dragStart.current.moved && Math.abs(dx) + Math.abs(dy) > 4) {
      dragStart.current.moved = true;
      setDragging(true);
    }
    if (dragStart.current.moved) {
      setPan({ x: dragStart.current.panX + dx, y: dragStart.current.panY + dy });
    }
  }, [zoom]);

  const onMouseUp = useCallback(() => {
    setDragging(false);
    dragStart.current = null;
    nodeDrag.current = null;
  }, []);

  const zoomIn = () => setZoom(z => Math.min(z * 1.25, 3));
  const zoomOut = () => setZoom(z => Math.max(z * 0.8, 0.2));
  const fitView = (resetPositions = false) => {
    if (resetPositions) setNodePositions({});
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const scaleX = rect.width / contentW;
    const scaleY = rect.height / contentH;
    const fit = Math.min(scaleX, scaleY, 1.2) * 0.9;
    setZoom(fit);
    setPan({
      x: (rect.width - contentW * fit) / 2,
      y: (rect.height - contentH * fit) / 2,
    });
  };

  function getNodePos(node) {
    return nodePositions[node.id] || { x: node.x, y: node.y };
  }

  function edgePath(from, to) {
    const fp = getNodePos(from), tp = getNodePos(to);
    const x1 = tp.x + NODE_W;
    const y1 = tp.y + NODE_H / 2;
    const x2 = fp.x;
    const y2 = fp.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  return (
    <div className="canvas-container"
      ref={containerRef}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}>

      {/* Dotted grid background */}
      <svg className="canvas-grid" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        <defs>
          <pattern id="grid-dots" width="24" height="24" patternUnits="userSpaceOnUse"
            x={pan.x % (24 * zoom)} y={pan.y % (24 * zoom)}
            patternTransform={`scale(${zoom})`}>
            <circle cx="12" cy="12" r="1" fill="rgba(255,255,255,0.18)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-dots)" />
      </svg>

      {/* Tree content */}
      <svg className="canvas-content"
        style={{
          position: 'absolute', top: 0, left: 0,
          width: contentW, height: contentH,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          overflow: 'visible',
        }}>
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {edges.map(({ from, to }) => {
          const fn = nodeMap[from], tn = nodeMap[to];
          if (!fn || !tn) return null;
          const sourceNode = tn;
          const color = TYPE_COLORS[sourceNode.type]?.border || TYPE_COLORS.source.border;
          const d = edgePath(fn, tn);
          const isDown = sourceNode.status === 'down';
          return (
            <g key={`${from}-${to}`}>
              <path d={d} fill="none" stroke={color} strokeWidth="2" strokeOpacity="0.25"
                strokeDasharray={isDown ? '4 4' : 'none'} />
              {!isDown && (
                <circle r="3" fill={color} filter="url(#glow)">
                  <animateMotion dur={`${2 + Math.random()}s`} repeatCount="indefinite" begin={`${Math.random() * 2}s`}>
                    <mpath href={`#path-${from}-${to}`} />
                  </animateMotion>
                </circle>
              )}
              <path id={`path-${from}-${to}`} d={d} fill="none" stroke="none" />
            </g>
          );
        })}

        {nodes.map(node => {
          const statusColor = STATUS_COLORS[node.status] || STATUS_COLORS.ok;
          const tc = TYPE_COLORS[node.type] || TYPE_COLORS.source;
          const active = hovered === node.id || selected === node.id;
          const pos = getNodePos(node);
          const isDraggingThis = nodeDrag.current?.nodeId === node.id;
          return (
            <g key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                nodeDrag.current = {
                  nodeId: node.id,
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: pos.x,
                  origY: pos.y,
                  moved: false,
                };
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (!nodeDrag.current?.moved && !dragStart.current?.moved) onSelect(node);
              }}
              style={{ cursor: isDraggingThis ? 'grabbing' : 'grab' }}>
              <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H}
                rx="10" ry="10"
                fill={tc.bg}
                stroke={tc.border}
                strokeWidth={active ? 2 : 1}
                strokeOpacity={active ? 1 : 0.4}
              />
              <circle cx={pos.x + 12} cy={pos.y + 14} r="4" fill={statusColor}>
                {node.status === 'ok' && (
                  <animate attributeName="opacity" values="1;0.4;1" dur="3s" repeatCount="indefinite" />
                )}
              </circle>
              <text x={pos.x + 22} y={pos.y + 17} className="tree-label">{node.label}</text>
              <text x={pos.x + 10} y={pos.y + 33} className="tree-sub">{node.sub}</text>
            </g>
          );
        })}
      </svg>

      {/* Zoom controls */}
      <div className="canvas-controls">
        <button onClick={zoomIn} title="Zoom in">+</button>
        <button onClick={zoomOut} title="Zoom out">&minus;</button>
        <button onClick={() => fitView(true)} title="Reset layout">&#x21BA;</button>
        <button onClick={() => fitView()} title="Fit to view">&#x26F6;</button>
      </div>
    </div>
  );
}

export default function SourcesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/api/sources/status');
      if (r.ok) {
        setData(await r.json());
        setLastRefresh(Date.now());
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="loading">Loading…</div>;
  if (!data) return <div className="error-banner">Could not load sources status.</div>;

  return (
    <div className="sources-page">
      <div className="sources-toolbar">
        <div>
          <h2 className="card-title" style={{ margin: 0 }}>Pipeline de collecte</h2>
          <p className="sources-subtitle">
            Cliquez sur un noeud pour voir le détail. Les noeuds rouges signalent une rupture.
          </p>
        </div>
        <div className="sources-legend">
          <span><i className="legend-dot" style={{ background: '#60a5fa' }} /> Source</span>
          <span><i className="legend-dot" style={{ background: '#a78bfa' }} /> Traitement</span>
          <span><i className="legend-dot" style={{ background: '#f59e0b' }} /> Affichage</span>
          <span style={{ marginLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 8 }}>
            <i className="legend-dot" style={{ background: '#22c55e' }} /> OK
          </span>
          <span><i className="legend-dot" style={{ background: '#ef4444' }} /> Down</span>
          {lastRefresh && <span className="legend-refresh">Refresh {ago(lastRefresh)} ago</span>}
        </div>
      </div>
      <div className="sources-layout">
        <TreeDiagram data={data} selected={selectedNode?.id} onSelect={setSelectedNode} />
        {selectedNode && <NodeDetail node={selectedNode} onClose={() => setSelectedNode(null)} />}
      </div>
    </div>
  );
}
