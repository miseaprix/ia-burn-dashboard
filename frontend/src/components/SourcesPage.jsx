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

// Tree layout: each node has {id, label, sub, status, detail, children, x, y}
function buildTree(data) {
  if (!data) return null;
  const { collectors, claude, codex } = data;
  const personal = collectors.personal;
  const local = collectors.local;

  const claudeOk = !!claude.burndown;
  const codexOk = !!codex.burndown;

  return {
    id: 'dashboard', label: 'Dashboard', sub: 'localhost:4095',
    status: 'ok', detail: 'Rendering',
    children: [
      {
        id: 'quota-collector', label: 'Quota collector',
        sub: `${Math.round((personal.intervalMs || 60000) / 1000)}s cycle`,
        status: nodeStatus(!personal.error && !!personal.lastSuccess, true),
        detail: personal.error || (personal.lastSuccess ? `${ago(personal.lastSuccess)} ago` : 'waiting'),
        children: [
          {
            id: 'claude-api', label: 'Claude API',
            sub: claudeOk ? claude.burndown.source : 'OAuth token',
            status: nodeStatus(claudeOk, claude.burndown?.fresh),
            detail: claudeOk ? `${ago(Date.parse(claude.burndown.observedAt))} ago` : 'token expired',
            children: [
              {
                id: 'claude-session', label: '5h session',
                sub: 'Claude',
                status: nodeStatus(claude.burndown?.hasSession, true),
                detail: claude.burndown?.hasSession ? 'active' : 'idle',
                children: [],
              },
              {
                id: 'claude-weekly', label: 'Weekly',
                sub: 'Claude',
                status: nodeStatus(claude.burndown?.hasWeekly, true),
                detail: claude.burndown?.hasWeekly ? 'active' : 'no data',
                children: [],
              },
            ],
          },
          {
            id: 'codex-api', label: 'Codex API',
            sub: codexOk ? codex.burndown.source : 'OAuth token',
            status: nodeStatus(codexOk, codex.burndown?.fresh),
            detail: codexOk ? `${ago(Date.parse(codex.burndown.observedAt))} ago` : 'no token',
            children: [
              {
                id: 'codex-session', label: '5h session',
                sub: 'Codex',
                status: nodeStatus(codex.burndown?.hasSession, true),
                detail: codex.burndown?.hasSession ? 'active' : 'idle',
                children: [],
              },
              {
                id: 'codex-weekly', label: 'Weekly',
                sub: 'Codex',
                status: nodeStatus(codex.burndown?.hasWeekly, true),
                detail: codex.burndown?.hasWeekly ? 'active' : 'no data',
                children: [],
              },
            ],
          },
        ],
      },
      {
        id: 'usage-collector', label: 'Usage collector',
        sub: `${Math.round((local.intervalMs || 60000) / 1000)}s cycle`,
        status: nodeStatus(!local.error && !!local.lastSuccess, true),
        detail: local.error || (local.lastSuccess ? `${ago(local.lastSuccess)} ago` : 'waiting'),
        children: [
          {
            id: 'claude-logs', label: 'Claude logs',
            sub: '~/.claude',
            status: 'ok',
            detail: 'JSONL sessions',
            children: [],
          },
          {
            id: 'codex-logs', label: 'Codex logs',
            sub: '~/.codex',
            status: 'ok',
            detail: 'JSONL sessions',
            children: [],
          },
        ],
      },
      {
        id: 'agent-burn', label: 'Agent Burn',
        sub: 'launchd 60s',
        status: 'ok',
        detail: 'macOS app',
        children: [
          {
            id: 'archive', label: 'quota-archive',
            sub: '.json',
            status: 'ok',
            detail: 'quota history',
            children: [],
          },
          {
            id: 'cache', label: 'claude-usage',
            sub: '.json',
            status: 'ok',
            detail: 'cached response',
            children: [],
          },
          {
            id: 'account', label: 'claude-account',
            sub: '.json',
            status: claudeOk ? 'ok' : 'down',
            detail: claudeOk ? 'cached quota' : 'stale/missing',
            children: [],
          },
        ],
      },
    ],
  };
}

// Recursive layout: returns flat node list with x,y coordinates
const NODE_W = 130, NODE_H = 52, H_GAP = 36, V_GAP = 26;

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

function TreeDiagram({ data }) {
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

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [pan]);

  const onPointerMove = useCallback((e) => {
    if (!dragging || !dragStart.current) return;
    setPan({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    setDragging(false);
    dragStart.current = null;
  }, []);

  const zoomIn = () => setZoom(z => Math.min(z * 1.25, 3));
  const zoomOut = () => setZoom(z => Math.max(z * 0.8, 0.2));
  const fitView = () => {
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

  function edgePath(from, to) {
    const x1 = to.x + NODE_W;
    const y1 = to.y + NODE_H / 2;
    const x2 = from.x;
    const y2 = from.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
  }

  return (
    <div className="canvas-container"
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
          const color = STATUS_COLORS[sourceNode.status] || STATUS_COLORS.ok;
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
          const color = STATUS_COLORS[node.status] || STATUS_COLORS.ok;
          const active = hovered === node.id;
          return (
            <g key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'grab' }}>
              <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H}
                rx="10" ry="10"
                fill="var(--surface, #1a1a1a)"
                stroke={color}
                strokeWidth={active ? 2 : 1}
                strokeOpacity={active ? 1 : 0.5}
              />
              <circle cx={node.x + 14} cy={node.y + 15} r="4" fill={color}>
                {node.status === 'ok' && (
                  <animate attributeName="opacity" values="1;0.4;1" dur="3s" repeatCount="indefinite" />
                )}
              </circle>
              <text x={node.x + 24} y={node.y + 18} className="tree-label">{node.label}</text>
              <text x={node.x + 14} y={node.y + 34} className="tree-sub">{node.sub}</text>
              <text x={node.x + NODE_W - 8} y={node.y + 34} className="tree-detail" textAnchor="end">{node.detail}</text>
            </g>
          );
        })}
      </svg>

      {/* Zoom controls */}
      <div className="canvas-controls">
        <button onClick={zoomIn} title="Zoom in">+</button>
        <button onClick={zoomOut} title="Zoom out">&minus;</button>
        <button onClick={fitView} title="Fit to view">&#x26F6;</button>
      </div>
    </div>
  );
}

export default function SourcesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

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

  const { collectors, claude, codex } = data;
  const personal = collectors.personal;
  const local = collectors.local;

  return (
    <div className="sources-page">
      <section className="card sources-overview">
        <div className="sources-header">
          <div>
            <h2 className="card-title">Pipeline de collecte</h2>
            <p className="sources-subtitle">
              Flux de données de gauche à droite — les nœuds rouges signalent une rupture dans la chaîne.
            </p>
          </div>
          <div className="sources-legend">
            <span><i className="legend-dot" style={{ background: '#22c55e' }} /> OK</span>
            <span><i className="legend-dot" style={{ background: '#f59e0b' }} /> Stale</span>
            <span><i className="legend-dot" style={{ background: '#ef4444' }} /> Down</span>
            {lastRefresh && <span className="legend-refresh">Refresh {ago(lastRefresh)} ago</span>}
          </div>
        </div>
        <TreeDiagram data={data} />
      </section>

      <section className="card">
        <h2 className="card-title">Diagnostic rapide</h2>
        <p className="sources-subtitle">Si une métrique affiche « Unavailable », remontez l’arbre de gauche à droite pour trouver la rupture.</p>
        <div className="diagnostic-grid">
          <DiagRow label="Claude token" status={claude.burndown ? 'ok' : 'down'} detail={claude.burndown ? `Source: ${claude.burndown.source}` : 'Token expiré — ré-authentifier dans Claude Code'} />
          <DiagRow label="Claude session 5h" status={claude.burndown?.hasSession ? 'ok' : 'stale'} detail={claude.burndown?.hasSession ? 'Active' : 'Pas de fenêtre active ou idle'} />
          <DiagRow label="Claude weekly" status={claude.burndown?.hasWeekly ? 'ok' : 'stale'} detail={claude.burndown?.hasWeekly ? 'Active' : 'Pas de données weekly'} />
          <DiagRow label="Codex token" status={codex.burndown ? 'ok' : 'down'} detail={codex.burndown ? `Source: ${codex.burndown.source}` : 'Token manquant'} />
          <DiagRow label="Codex session 5h" status={codex.burndown?.hasSession ? 'ok' : 'stale'} detail={codex.burndown?.hasSession ? 'Active' : 'Pas de fenêtre active'} />
          <DiagRow label="Codex weekly" status={codex.burndown?.hasWeekly ? 'ok' : 'stale'} detail={codex.burndown?.hasWeekly ? 'Active' : 'Pas de données'} />
          <DiagRow label="Surface breakdown" status={codex.surfaceStatus && !codex.surfaceStatus.error ? 'ok' : 'stale'} detail={codex.surfaceStatus?.error || (codex.surfaceStatus ? 'Disponible' : 'Non collecté')} />
          <DiagRow label="Quota collector" status={personal.lastSuccess && !personal.error ? 'ok' : 'down'} detail={personal.error || (personal.lastSuccess ? `Dernière: ${ago(personal.lastSuccess)} ago` : 'Jamais réussi')} />
          <DiagRow label="Usage collector" status={local.lastSuccess && !local.error ? 'ok' : 'down'} detail={local.error || (local.lastSuccess ? `Dernière: ${ago(local.lastSuccess)} ago` : 'Jamais réussi')} />
        </div>
      </section>
    </div>
  );
}

function DiagRow({ label, status, detail }) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.ok;
  return (
    <div className={`diag-row ${status === 'down' ? 'diag-bad' : status === 'stale' ? 'diag-warn' : ''}`}>
      <i className="legend-dot" style={{ background: color, flexShrink: 0 }} />
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  );
}
