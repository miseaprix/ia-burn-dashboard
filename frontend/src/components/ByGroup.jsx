import React from 'react';
import { fmtSpend, fmtCompact } from '../lib/format.js';
import BrandIcon from './BrandIcon.jsx';
export default function ByGroup({ groups, capabilities, onSelect }) {
  const rows = groups || [],
    local = capabilities?.groups === 'harness',
    max = Math.max(0.01, ...rows.map((g) => g.spend));
  return (
    <section className="card by-group">
      <div className="chart-head">
        <h2 className="card-title">
          <BrandIcon name="overview" />
          {local ? 'By harness' : 'By provider'}
        </h2>
        {local && <span className="chart-unit">{rows.length} active</span>}
      </div>
      <div className="group-list">
        {rows.map((g) => (
          <button
            className="group-row"
            key={g.key}
            onClick={() => onSelect?.(g.key)}
            disabled={!onSelect}
          >
            <BrandIcon name={local ? g.key : 'enterprise'} size={21} />
            <span className="group-content">
              <span className="group-main">
                <strong>
                  {g.key === 'claude'
                    ? 'Claude Code'
                    : g.key === 'codex'
                      ? 'Codex'
                      : g.label}
                </strong>
                <b>{fmtSpend(g)}</b>
              </span>
              <span className="group-barwrap">
                <span
                  className="group-barfill"
                  style={{
                    width: `${(g.spend / max) * 100}%`,
                    background: g.color,
                  }}
                />
              </span>
              {g.tokens != null && (
                <span className="group-sub">{fmtCompact(g.tokens)} tokens</span>
              )}
            </span>
            {onSelect && <span className="chevron">›</span>}
          </button>
        ))}
      </div>
      {!rows.length && <p className="empty">No data for this period.</p>}
    </section>
  );
}
