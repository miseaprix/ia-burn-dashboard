import {useEnterpriseLabel} from '../lib/enterprise.js';
import React from 'react';
export default function Header({
  title,
  source,
  enterpriseEnabled = true,
  onSourceChange,
  range,
  onRangeChange,
  rangeLabel,
  onRefresh,
  loading,
  quota,
  onToggleSidebar,
  from, to, onFromChange, onToChange, today,
}) {
  const label=useEnterpriseLabel();
  return (
    <header className="header">
      <div className="toolbar-title">
        <button
          className="icon-button sidebar-toggle"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9 4v16" />
          </svg>
        </button>
        {quota != null && (
          <span className="toolbar-quota">{quota.toFixed(0)}%</span>
        )}
        <div>
          <h1>{title}</h1>
          <p>{rangeLabel}</p>
        </div>
      </div>
      <div className="header-controls">
        <div
          className="segmented source-switch"
          role="group"
          aria-label="Data source"
        >
          <button
            className={source === 'local' ? 'active' : ''}
            onClick={() => onSourceChange('local')}
          >
            Perso
          </button>
          {enterpriseEnabled && <button className={source === 'enterprise-local' ? 'active' : ''} onClick={() => onSourceChange('enterprise-local')}>{label} local</button>}
          {enterpriseEnabled && <button
            className={source === 'enterprise' ? 'active' : ''}
            onClick={() => onSourceChange('enterprise')}
          >
            {label}
          </button>}
        </div>
        <select
          className="select"
          value={range}
          onChange={(e) => onRangeChange(e.target.value)}
          aria-label="Period"
        >
          {Object.entries({
            today: 'Today',
            yesterday: 'Yesterday',
            wtd: 'Week to date',
            mtd: 'Month to date',
            week: 'Last 7 days',
            month: 'Last 30 days',
            ytd: 'Year to date',
            all: 'All time',
            custom: 'Custom dates',
            ...(source === 'local' ? { rtd: 'Reset to date' } : {}),
          }).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {range === 'custom' && <div className="date-range">
          <label>From <input className="select" type="date" aria-label="From date"
            value={from} max={today} onInput={e => onFromChange(e.currentTarget.value)} onChange={e => onFromChange(e.target.value)} /></label>
          <label>To <input className="select" type="date" aria-label="To date"
            value={to} max={today} min={from} onInput={e => onToChange(e.currentTarget.value)} onChange={e => onToChange(e.target.value)} /></label>
        </div>}
        <button
          className={`icon-button ${loading ? 'spin' : ''}`}
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh"
        >
          ↻
        </button>
      </div>
    </header>
  );
}
