import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';

function ago(ts) {
  if (!ts) return null;
  const ms = Date.now() - ts;
  if (ms < 60000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m ago`;
  return `${Math.round(ms / 3600000)}h ago`;
}

function StatusDot({ ok, warning }) {
  const cls = ok ? (warning ? 'stale' : '') : 'stale';
  return <i className={`freshness-dot ${cls}`} />;
}

function PipelineNode({ label, status, detail, icon, children }) {
  return (
    <div className="source-node">
      <div className="source-node-header">
        <span className="source-node-icon">{icon}</span>
        <strong>{label}</strong>
        {status && <StatusDot ok={status !== 'error'} warning={status === 'stale'} />}
      </div>
      {detail && <div className="source-node-detail">{detail}</div>}
      {children}
    </div>
  );
}

function Arrow() {
  return <div className="source-arrow">→</div>;
}

export default function SourcesPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const r = await apiFetch('/api/sources/status');
        if (r.ok && active) setData(await r.json());
      } catch {}
      if (active) setLoading(false);
    }
    load();
    const id = setInterval(load, 30000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (loading) return <div className="loading">Loading…</div>;
  if (!data) return <div className="error-banner">Could not load sources status.</div>;

  const { collectors, claude, codex, mounts } = data;
  const personal = collectors.personal;
  const local = collectors.local;

  return (
    <div className="sources-page">
      <section className="card sources-overview">
        <h2 className="card-title">Data pipeline</h2>
        <p className="sources-subtitle">How metrics flow from your subscriptions to this dashboard.</p>

        <div className="pipeline-diagram">
          <div className="pipeline-stage">
            <h3 className="pipeline-stage-title">Sources</h3>
            <div className="pipeline-nodes">
              <PipelineNode
                label="Claude Code"
                icon="⌘"
                status={claude.burndown ? (claude.burndown.fresh ? 'ok' : 'stale') : 'error'}
                detail={claude.burndown
                  ? <>
                      <span>Source: {claude.burndown.source}</span>
                      <span>Last reading: {ago(Date.parse(claude.burndown.observedAt))}</span>
                      <span>{claude.burndown.hasSession ? '✓' : '✗'} Session · {claude.burndown.hasWeekly ? '✓' : '✗'} Weekly</span>
                    </>
                  : <span className="source-unavailable">No quota reading</span>
                }
              />
              <PipelineNode
                label="Codex"
                icon="◈"
                status={codex.burndown ? (codex.burndown.fresh ? 'ok' : 'stale') : 'error'}
                detail={codex.burndown
                  ? <>
                      <span>Source: {codex.burndown.source}</span>
                      <span>Last reading: {ago(Date.parse(codex.burndown.observedAt))}</span>
                      <span>{codex.burndown.hasSession ? '✓' : '✗'} Session · {codex.burndown.hasWeekly ? '✓' : '✗'} Weekly</span>
                    </>
                  : <span className="source-unavailable">No quota reading</span>
                }
              />
            </div>
          </div>

          <Arrow />

          <div className="pipeline-stage">
            <h3 className="pipeline-stage-title">Collection</h3>
            <div className="pipeline-nodes">
              <PipelineNode
                label="Quota collector"
                icon="⟳"
                status={personal.error ? 'error' : personal.lastSuccess ? 'ok' : 'stale'}
                detail={<>
                  <span>Interval: {Math.round((personal.intervalMs || 60000) / 1000)}s</span>
                  {personal.lastSuccess && <span>Last success: {ago(personal.lastSuccess)}</span>}
                  {personal.error && <span className="source-error">{personal.error}</span>}
                  <span>{personal.running ? 'Running now' : `Next: ${ago(personal.nextAttempt)?.replace(' ago', '') || '—'}`}</span>
                </>}
              />
              <PipelineNode
                label="Usage collector"
                icon="⟳"
                status={local.error ? 'error' : local.lastSuccess ? 'ok' : 'stale'}
                detail={<>
                  <span>Interval: {Math.round((local.intervalMs || 60000) / 1000)}s</span>
                  {local.lastSuccess && <span>Last success: {ago(local.lastSuccess)}</span>}
                  {local.error && <span className="source-error">{local.error}</span>}
                </>}
              />
              <PipelineNode
                label="Agent Burn (macOS)"
                icon="🔥"
                status="ok"
                detail={<>
                  <span>launchd · 60s cycle</span>
                  <span>agent-burn harness claude / codex</span>
                </>}
              />
            </div>
          </div>

          <Arrow />

          <div className="pipeline-stage">
            <h3 className="pipeline-stage-title">Storage</h3>
            <div className="pipeline-nodes">
              <PipelineNode label="quota-archive.json" icon="📁" detail={<span>{mounts.archiveFile}</span>} />
              <PipelineNode label="claude-account.json" icon="📁" detail={<span>{mounts.accountFile}</span>} />
              <PipelineNode label="claude-usage.json" icon="📁" detail={<span>{mounts.cacheFile}</span>} />
              <PipelineNode label="State DB" icon="💾" detail={<span>{mounts.stateDir}</span>} />
            </div>
          </div>

          <Arrow />

          <div className="pipeline-stage">
            <h3 className="pipeline-stage-title">Render</h3>
            <div className="pipeline-nodes">
              <PipelineNode label="This dashboard" icon="📊" status="ok" detail={<span>localhost:4095</span>} />
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">Diagnostic</h2>
        <p className="sources-subtitle">If a metric shows "Unavailable", trace the pipeline from left to right to find the broken link.</p>
        <div className="diagnostic-grid">
          <DiagRow label="Claude token" ok={!!claude.burndown} detail={claude.burndown ? `Reading from ${claude.burndown.source}` : 'Token expired or missing — re-authenticate in Claude Code'} />
          <DiagRow label="Claude session (5h)" ok={claude.burndown?.hasSession} detail={claude.burndown?.hasSession ? 'Active' : 'No active session window or idle'} />
          <DiagRow label="Claude weekly" ok={claude.burndown?.hasWeekly} detail={claude.burndown?.hasWeekly ? 'Active' : 'No weekly data'} />
          <DiagRow label="Codex token" ok={!!codex.burndown} detail={codex.burndown ? `Reading from ${codex.burndown.source}` : 'Token missing — authenticate in Codex'} />
          <DiagRow label="Codex session (5h)" ok={codex.burndown?.hasSession} detail={codex.burndown?.hasSession ? 'Active' : 'No active session window'} />
          <DiagRow label="Codex weekly" ok={codex.burndown?.hasWeekly} detail={codex.burndown?.hasWeekly ? 'Active' : 'No weekly data'} />
          <DiagRow label="Surface breakdown" ok={codex.surfaceStatus && !codex.surfaceStatus.error} detail={codex.surfaceStatus?.error || (codex.surfaceStatus ? 'Available' : 'Not collected')} />
          <DiagRow label="Quota collector" ok={!!personal.lastSuccess && !personal.error} detail={personal.error || (personal.lastSuccess ? `Last: ${ago(personal.lastSuccess)}` : 'Never succeeded')} />
          <DiagRow label="Usage collector" ok={!!local.lastSuccess && !local.error} detail={local.error || (local.lastSuccess ? `Last: ${ago(local.lastSuccess)}` : 'Never succeeded')} />
        </div>
      </section>
    </div>
  );
}

function DiagRow({ label, ok, detail }) {
  return (
    <div className={`diag-row ${ok ? '' : 'diag-bad'}`}>
      <StatusDot ok={ok} />
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  );
}
