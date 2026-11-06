import React from 'react';
import { fmtUsd, fmtCompact, fmtInt } from '../lib/format.js';
import BrandIcon from './BrandIcon.jsx';
function Tile({ icon, label, value, sub }) {
  return (
    <div className="kpi-card">
      <div className="kpi-head">
        <BrandIcon name={icon} />
        <span className="stat-label">{label}</span>
      </div>
      <div className="kpi-number">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}
export default function StatStrip({
  totals,
  capabilities,
  periodLabel,
  harnessName = 'Across all harnesses',
  gateway = false,
}) {
  const t = totals || {},
    local = capabilities?.tokens,
    ratio = t.costComplete !== false && t.tokens > 0 && t.spend > 0 ? t.tokens / t.spend : null;
  return (
    <section className="card statstrip" aria-label="Usage summary">
      <Tile
        icon="spend"
        label={t.costComplete === false ? 'Known spend' : 'Total spend'}
        value={t.costComplete === false && !(t.spend > 0) ? '—' : fmtUsd(t.spend)}
        sub={t.costComplete === false ? 'Known API-equivalent value · incomplete' : gateway ? 'Reported gateway spend' : local ? 'API-equivalent value' : 'Gateway usage'}
      />
      {local ? (
        <Tile
          icon="tokens"
          label="Tokens"
          value={t.tokens == null ? '—' : fmtCompact(t.tokens)}
          sub="Input, output and cache"
        />
      ) : (
        <Tile
          icon="tokens"
          label="Requests"
          value={t.requests == null ? '—' : fmtInt(t.requests)}
          sub="API requests"
        />
      )}
      {local ? (
        <Tile
          icon="ratio"
          label="Avg tokens / $"
          value={ratio == null ? '—' : `${fmtCompact(ratio)} / $`}
          sub={periodLabel}
        />
      ) : (
        <Tile
          icon="ratio"
          label="Days recorded"
          value={fmtInt(t.days)}
          sub={periodLabel}
        />
      )}
      <Tile
        icon="models"
        label="Models"
        value={fmtInt(t.models)}
        sub={harnessName}
      />
    </section>
  );
}
