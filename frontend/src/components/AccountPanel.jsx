import React, { useState } from 'react';
import BrandIcon from './BrandIcon.jsx';
import QuotaBurndown, { QuotaPlot } from './QuotaBurndown.jsx';
import { fmtUsd, fmtCountdown } from '../lib/format.js';
export default function AccountPanel({ harness, data }) {
  const [range, setRange] = useState('rte'),
    b = data.burndown,
    s = data.subscription,
    w = b?.weekly;
  const title = harness === 'claude' ? 'Claude' : 'Codex',
    time = b
      ? new Date(b.observedAt).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;
  const windows = [b?.session, w].filter(Boolean);
  const risk = windows.find(q => q.remainingPercent === 0) || windows.find(q => q.forecast?.runsOut);
  const sessionRisk = risk && risk === b?.session;
  const label = sessionRisk ? '5-hour limit' : 'Weekly limit';
  return (
    <section className={`card account-panel ${harness}-account`}>
      <div className="account-header">
        <h2 className="card-title">
          <BrandIcon name={harness === 'claude' ? 'spend' : 'ratio'} />
          {title} {s?.plan || 'Unknown plan'}
        </h2>
        <div className="account-meta">
          <span>
            {s?.pricePerMonth == null ? '—' : fmtUsd(s.pricePerMonth)} / month
          </span>
          {harness === 'codex' && w ? (
            <select
              className="chart-range"
              value={range}
              onChange={(e) => setRange(e.target.value)}
              aria-label="Quota chart range"
            >
              <option value="rte">Until reset</option>
              <option value="rtd">Reset to date</option>
            </select>
          ) : (
            <>
              <span className={`freshness-dot ${b?.stale ? 'stale' : ''}`} />
              <span>{time || 'Unavailable'}</span>
            </>
          )}
        </div>
      </div>
      {b?.stale && (
        <p className="quota-note">Last available reading · {b.source}</p>
      )}
      {b && !b.historyPersisted && (
        <div className="error-banner">
          Quota history could not be saved. Check state volume permissions.
        </div>
      )}
      {risk && (
        <div className="budget-alert">
          <strong>⚠ {label}{risk.remainingPercent === 0 ? ' reached.' : ` runs out ≈ ${new Date(risk.forecast.projectedEnd).toLocaleString('en-US', {weekday:'short',hour:'numeric',minute:'2-digit'})}.`}</strong>{' '}
          {risk.remainingPercent === 0
            ? `Resets ${new Date(risk.resetsAt).toLocaleString('en-US', {weekday:'short',hour:'numeric',minute:'2-digit'})}.`
            : `Keep under ${(risk.remainingPercent / Math.max(0.01, (Date.parse(risk.resetsAt) - Date.parse(b.observedAt)) / (sessionRisk ? 3600000 : 86400000))).toFixed(1)}%/${sessionRisk ? 'hour' : 'day'} to last until the reset.`}
        </div>
      )}
      {harness === 'claude' ? (
        <>
          <div className="claude-quota-grid">
            <QuotaBurndown window={b?.session} title="5-hour session" />
            <QuotaBurndown window={b?.weekly} title="Weekly" />
          </div>
          {(b?.scoped || []).map((q) => (
            <div className="scoped-row" key={q.name}>
              <strong>{q.name} · weekly</strong>
              <div className="group-barwrap">
                <div
                  className="group-barfill"
                  style={{
                    width: `${q.remainingPercent}%`,
                    background:
                      q.remainingPercent < 15
                        ? 'var(--danger)'
                        : 'var(--flame)',
                  }}
                />
              </div>
              <span>
                <b>{q.remainingPercent.toFixed(0)}%</b> left
              </span>
            </div>
          ))}
          {(b?.extraUsage?.enabled || b?.extraUsage?.usedUSD > 0) && (
            <p className="quota-note">
              Extra usage{' '}
              {b.extraUsage.usedUSD == null
                ? '—'
                : fmtUsd(b.extraUsage.usedUSD)}{' '}
              /{' '}
              {b.extraUsage.limitUSD == null
                ? '—'
                : fmtUsd(b.extraUsage.limitUSD)}
            </p>
          )}
        </>
      ) : w ? (
        <div className="codex-quota-layout">
          {b?.session && <div className="codex-session-panel"><QuotaBurndown window={b.session} title={b.session.windowMinutes === 300 ? "5-hour session" : "Session quota"} showResetTime /></div>}
          <div className="quota-summary">
            <div className="quota-summary-heading">
            <h3>Weekly quota</h3>
            <div className="quota-summary-values">
            <div className="quota-big">
              <strong>{w.remainingPercent.toFixed(1)}%</strong>
              <span>remaining</span>
            </div>
            <span
              className={`pace-badge ${w.paceDelta >= -0.05 ? 'good' : 'bad'}`}
            >
              {w.paceDelta >= 0 ? '+' : '−'}
              {Math.abs(w.paceDelta).toFixed(1)}%{' '}
              {w.paceDelta >= 0 ? 'ahead' : 'behind'}
            </span>
            </div>
            <div className="quota-meter group-barwrap">
              <div
                className="group-barfill"
                style={{
                  width: `${w.remainingPercent}%`,
                  background: 'var(--success)',
                }}
              />
            </div>
            </div>
            <dl>
              <div>
                <dt>Reset in</dt>
                <dd>{fmtCountdown(w.resetsAt)} <small>{new Date(w.resetsAt).toLocaleString('fr-FR', {weekday:'short', hour:'2-digit', minute:'2-digit'})}</small></dd>
              </div>
              <div>
                <dt>Used</dt>
                <dd>
                  {w.usedPercent.toFixed(1)}%{' '}
                  <small>
                    since{' '}
                    {new Date(w.start).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </small>
                </dd>
              </div>
              <div>
                <dt>Daily</dt>
                <dd>{w.dailyAllowancePercent.toFixed(1)}% / day</dd>
              </div>
              <div>
                <dt>Avg $ / %</dt>
                <dd>
                  {w.dollarsPerPercent == null
                    ? '—'
                    : fmtUsd(w.dollarsPerPercent)}{' '}
                  / %
                </dd>
              </div>
              {b.resetCreditsAvailable != null && (
                <div>
                  <dt>Resets</dt>
                  <dd>
                    {b.resetCreditsAvailable} <small>banked</small>
                  </dd>
                </div>
              )}
            </dl>
          </div>
          <div className={`codex-quota-chart quota-card ${w.forecast?.runsOut ? 'at-risk' : ''}`}>
            <div className="chart-head"><h3>Weekly</h3><span className="quota-countdown">Resets in <b>{fmtCountdown(w.resetsAt)}</b></span></div>
            <div className="quota-big"><strong>{w.remainingPercent.toFixed(1)}%</strong><span>left</span></div>
            <div className="quota-chart-legend">
              <span>
                <i className="line-swatch" />
                Recorded <b>{w.remainingPercent.toFixed(1)}%</b>
              </span>
              {w.forecast && (
                <span>
                  <i className="line-swatch forecast" />
                  Forecast <b>{w.forecast.projectedRemaining.toFixed(1)}%</b>
                </span>
              )}
              <span>
                <i className="line-swatch pace" />
                Pace <b>{w.idealRemaining.toFixed(1)}%</b>
              </span>
              <small>Latest · {time}</small>
            </div>
            <QuotaPlot window={w} range={range} compact />
          </div>
        </div>
      ) : (
        <div className="codex-quota-layout">
          <QuotaBurndown window={b?.session} title="5-hour session" showResetTime />
          <QuotaBurndown title="Weekly" />
        </div>
      )}
      {!b && harness === 'claude' && (
        <p className="quota-note">
          No current quota reading. Mount personal credentials or a fresh
          account cache to enable limits.
        </p>
      )}
    </section>
  );
}
