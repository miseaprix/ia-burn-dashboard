import React from 'react';
import { fmtSpend, fmtCompact } from '../lib/format.js';
import BrandIcon from './BrandIcon.jsx';

// Live split of the period by configured log folder; a click filters the dashboard.
export default function ProfileBreakdown({ profiles, selected, onSelect }) {
  const max = Math.max(0.01, ...profiles.map(p => p.spend));
  return (
    <section className="card by-group">
      <div className="chart-head">
        <h2 className="card-title"><BrandIcon name="overview" />By source</h2>
        {selected
          ? <button className="chart-unit" onClick={() => onSelect('')}>Toutes les sources ×</button>
          : <span className="chart-unit">{profiles.length} configured · live</span>}
      </div>
      <div className="group-list">
        {profiles.map(p => (
          <button className={`group-row ${p.id === selected ? 'active' : ''}`} key={p.id}
            onClick={() => onSelect(p.id === selected ? '' : p.id)} aria-pressed={p.id === selected}>
            <BrandIcon name={p.harness} size={21} />
            <span className="group-content">
              <span className="group-main"><strong>{p.name || p.path}</strong><b>{fmtSpend(p)}</b></span>
              <span className="group-barwrap"><span className="group-barfill" style={{ width: `${(p.spend / max) * 100}%` }} /></span>
              <span className="group-sub">{p.name ? `${p.path} · ` : ''}{fmtCompact(p.tokens)} tokens</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
