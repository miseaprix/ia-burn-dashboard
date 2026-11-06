import React, { useState, useMemo } from 'react';
import BrandIcon from './BrandIcon.jsx';
import { fmtSpend, fmtCompact } from '../lib/format.js';

export default function ModelsTable({ models, capabilities }) {
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState('spend'); // spend | tokens
  const showTokens = !!capabilities?.tokens;
  const all = Array.isArray(models) ? models : [];

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const key = sortBy === 'tokens' && showTokens ? 'tokens' : 'spend';
    return all
      .filter((m) => String(m.model).toLowerCase().includes(q))
      .sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
  }, [all, filter, sortBy, showTokens]);

  return (
    <section className="card models-card">
      <div className="chart-head wrap">
        <h2 className="card-title">
          <BrandIcon name="models" />
          Models
        </h2>
        <span className="models-meta">
          {all.length} · available source data
        </span>
        <input
          className="filter-input"
          type="text"
          placeholder="Filter models"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter models"
        />
      </div>

      <div className="table-scroll">
        <table className="models-table">
          <thead>
            <tr>
              <th>Model</th>
              {showTokens && (
                <th className="num">
                  {showTokens ? (
                    <button
                      type="button"
                      className="th-btn"
                      onClick={() => setSortBy('tokens')}
                    >
                      Tokens{sortBy === 'tokens' ? ' ↓' : ''}
                    </button>
                  ) : (
                    'Tokens'
                  )}
                </th>
              )}
              <th className="num">
                <button
                  type="button"
                  className="th-btn"
                  onClick={() => setSortBy('spend')}
                >
                  Spend{sortBy === 'spend' || !showTokens ? ' ↓' : ''}
                </button>
              </th>
              <th className="num">Share</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const share = Math.max(
                0,
                Math.min(100, (Number(m.share) || 0) * 100),
              );
              return (
                <tr key={`${m.provider || ''}${m.model}`}>
                  <td>
                    {m.model}
                    {m.provider && (
                      <span className="model-provider">{m.provider}</span>
                    )}
                  </td>
                  {showTokens && (
                    <td className="num">
                      {m.tokens != null ? fmtCompact(m.tokens) : '—'}
                    </td>
                  )}
                  <td className="num" title={m.costComplete === false ? 'Pricing unavailable for some or all usage' : undefined}>{m.costComplete === false && m.knownSpend > 0 ? fmtSpend({ ...m, spend: m.knownSpend }) : fmtSpend(m)}</td>
                  <td className="num">
                    {m.share == null ? '—' : <div className="share-cell">
                      <span className="share-capsule">
                        <span
                          className="share-capsule-fill"
                          style={{ width: `${share}%` }}
                        />
                      </span>
                      <span className="tabnum share-pct">
                        {share.toFixed(1)}%
                      </span>
                    </div>}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={showTokens ? 4 : 3} className="group-sub">
                  {all.length === 0
                    ? 'No usage for this period.'
                    : 'No models match.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
