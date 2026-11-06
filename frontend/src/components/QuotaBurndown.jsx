import React, { useId } from 'react';
import {
  ChartHitArea,
  ChartTooltip,
  useChartCursor,
} from './ChartInteraction.jsx';
import {
  drawnQuotaSamples,
  quotaReading,
  quotaDeltaPoints,
} from '../lib/quota-chart.js';
import { fmtCountdown } from '../lib/format.js';
export function QuotaPlot({ window: w, minimal = false, compact = false, range = 'rte' }) {
  const id = useId().replace(/:/g, '');
  const W = minimal || compact ? 640 : 900;
  const cursor = useChartCursor({ width: W, left: 38, right: 12, steps: 100 });
  if (!w) return null;
  const start = Date.parse(w.start),
    reset = Date.parse(w.resetsAt),
    observed = Date.parse(w.samples.at(-1)?.t) || start;
  const end = range === 'rtd' ? observed : reset,
    duration = end - start;
  const H = minimal || compact ? 205 : 230,
    L = 38,
    R = 12,
    T = 14,
    B = 32,
    PW = W - L - R,
    PH = H - T - B;
  const x = (t) =>
      L +
      Math.max(0, Math.min(1, (Date.parse(t) - start) / (duration || 1))) * PW,
    y = (v) => T + PH * (1 - v / 100);
  const actual = w.samples || [],
    last = actual.at(-1),
    f = range === 'rte' ? w.forecast : null;
  const samples = drawnQuotaSamples(w),
    deltaPoints = quotaDeltaPoints(w, samples);
  const line = (points) =>
    points
      .map((p, i) => `${i ? 'L' : 'M'}${x(p.t)},${y(p.remaining)}`)
      .join(' ');
  const even = (t) => 100 * (1 - (Date.parse(t) - start) / (reset - start));
  const dateLabel = (t) =>
    new Date(t).toLocaleString(
      'en-US',
      minimal && w.windowMinutes < 1440
        ? { hour: 'numeric', minute: '2-digit' }
        : { weekday: 'short', day: 'numeric' },
    );
  const ticks = minimal
    ? [w.start, new Date(end).toISOString()]
    : Array.from({ length: 8 }, (_, i) =>
        new Date(start + (duration * i) / 7).toISOString(),
      );
  const selectedTime =
    cursor.fraction == null ? null : start + cursor.fraction * duration;
  const reading =
    selectedTime == null ? null : quotaReading(w, samples, selectedTime, range);
  const at = selectedTime == null ? null : new Date(selectedTime).toISOString();
  return (
    <div className="chart-wrap quota-interactive">
      <svg
        className="burn-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Quota history and forecast"
      >
        <defs>
          <pattern
            id={id}
            width="7"
            height="7"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="7"
              stroke="var(--danger)"
              strokeOpacity=".5"
              strokeWidth="2"
            />
          </pattern>
        </defs>
        {(minimal ? [0, 100] : [0, 25, 50, 75, 100]).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <text x={L - 7} y={y(v) + 4} textAnchor="end" className="axis-text">
              {v}%
            </text>
          </g>
        ))}
        {ticks.map((t, i) => (
          <g key={t}>
            <line
              x1={x(t)}
              x2={x(t)}
              y1={T}
              y2={T + PH}
              stroke="var(--line)"
              strokeOpacity=".35"
            />
            <text
              x={x(t)}
              y={H - 9}
              textAnchor={
                i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'
              }
              className="axis-text"
            >
              {dateLabel(t)}
            </text>
          </g>
        ))}
        {minimal && f?.runsOut && (
          <g>
            <rect
              x={x(f.projectedEnd)}
              y={T}
              width={x(w.resetsAt) - x(f.projectedEnd)}
              height={PH}
              fill={`url(#${id})`}
            />
            <text
              x={(x(f.projectedEnd) + x(w.resetsAt)) / 2}
              y={T + PH * 0.6}
              textAnchor="middle"
              className="lock-text"
            >
              Locked out
              <tspan x={(x(f.projectedEnd) + x(w.resetsAt)) / 2} dy="13">{Math.floor(f.lockedOutSeconds / 3600)}h {Math.floor(f.lockedOutSeconds / 60) % 60}m</tspan>
            </text>
          </g>
        )}
        {deltaPoints.slice(1).map((p, i) => {
            const a = deltaPoints[i],
              tone =
                a.remaining - even(a.t) + p.remaining - even(p.t) >= 0
                  ? 'var(--success)'
                  : 'var(--danger)';
            return (
              <path
                key={i}
                d={`M${x(a.t)},${y(a.remaining)} L${x(p.t)},${y(p.remaining)} L${x(p.t)},${y(even(p.t))} L${x(a.t)},${y(even(a.t))} Z`}
                fill={tone}
                opacity=".16"
              />
            );
          })}
        <line
          x1={L}
          y1={y(100)}
          x2={W - R}
          y2={y(even(new Date(end).toISOString()))}
          stroke="var(--muted)"
          strokeDasharray="3 4"
        />
        {minimal && (
          <text
            x={L + PW * 0.59}
            y={y(even(new Date(start + duration * 0.59).toISOString())) - 5}
            className="axis-text"
          >
            even pace
          </text>
        )}
        {minimal ? (
          <path
            d={line(samples)}
            fill="none"
            stroke="var(--flame)"
            strokeWidth="2.4"
          />
        ) : (
          deltaPoints.slice(1).map((p, i) => {
            const a = deltaPoints[i];
            return (
              <path
                key={i}
                d={line([a, p])}
                fill="none"
                stroke={
                  a.remaining - even(a.t) + p.remaining - even(p.t) >= 0
                    ? 'var(--success)'
                    : 'var(--danger)'
                }
                strokeWidth="2.5"
              />
            );
          })
        )}
        {last && (
          <>
            <line
              x1={x(last.t)}
              x2={x(last.t)}
              y1={T}
              y2={T + PH}
              stroke={minimal ? 'var(--flame)' : 'var(--success)'}
              opacity=".5"
            />
            <circle
              cx={x(last.t)}
              cy={y(last.remaining)}
              r="4"
              fill={minimal ? 'var(--flame)' : 'var(--success)'}
            />
            {minimal && (
              <text
                x={x(last.t)}
                y={T - 3}
                className="axis-text now"
                textAnchor="middle"
              >
                Now
              </text>
            )}
            {f && (
              <>
                <path
                  d={line([
                    last,
                    { t: f.projectedEnd, remaining: f.projectedRemaining },
                  ])}
                  fill="none"
                  stroke={
                    f.runsOut
                      ? 'var(--danger)'
                      : minimal
                        ? 'var(--flame)'
                        : 'var(--success)'
                  }
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />
                {minimal && (
                  <>
                    <circle
                      cx={x(f.projectedEnd)}
                      cy={y(f.projectedRemaining)}
                      r="3"
                      fill="var(--surface)"
                      stroke={f.runsOut ? 'var(--danger)' : 'var(--flame)'}
                    />
                    <text
                      x={x(f.projectedEnd) - 6}
                      y={y(f.projectedRemaining) + (f.runsOut ? -8 : 18)}
                      textAnchor="end"
                      className={f.runsOut ? 'lock-text' : 'forecast-text'}
                    >
                      {f.runsOut
                        ? `Empty ${dateLabel(f.projectedEnd)}`
                        : `~${f.projectedRemaining.toFixed(1)}% at reset`}
                    </text>
                  </>
                )}
              </>
            )}
            {!minimal && (
              <text x={W - R} y={T - 3} className="axis-text" textAnchor="end">
                Reset
              </text>
            )}
          </>
        )}
        {reading && reading.value != null && (
          <g className="chart-cursor">
            <line
              x1={x(at)}
              x2={x(at)}
              y1={T}
              y2={T + PH}
              stroke="var(--flame)"
              opacity=".65"
            />
            <circle
              cx={x(at)}
              cy={y(reading.value)}
              r="4"
              fill="var(--flame)"
            />
          </g>
        )}
        <ChartHitArea
          left={L}
          top={T}
          width={PW}
          height={PH}
          handlers={cursor.handlers}
          label={
            minimal ? 'Inspect quota history' : 'Inspect Codex quota history'
          }
        />
      </svg>
      {reading && (
        <ChartTooltip
          left={(x(at) / W) * 100}
          top={(y(reading.value ?? 50) / H) * 100}
        >
          <strong>
            {reading.value?.toFixed(1) ?? '—'}% ·{' '}
            <span className={reading.delta >= 0 ? 'pos' : 'neg'}>
              {reading.delta == null ? '—' : `${reading.delta >= 0 ? '+' : '−'}${Math.abs(reading.delta).toFixed(1)}% ${reading.delta >= 0 ? 'ahead' : 'behind'}`}
            </span>
          </strong>
        </ChartTooltip>
      )}
    </div>
  );
}
export default function QuotaBurndown({ window: w, title, showResetTime = false }) {
  if (!w)
    return (
      <section className="quota-card">
        <h3>{title}</h3>
        <div className="empty">Quota reading unavailable.</div>
      </section>
    );
  if (w.state === 'idle') return (
    <section className="quota-card quota-idle">
      <div className="chart-head"><h3>{title}</h3><span className="quota-countdown">Reset</span></div>
      <div className="quota-big"><strong>100%</strong><span>left</span></div>
      <div className="quota-idle-meter group-barwrap"><div className="group-barfill" style={{width:'100%', background:'var(--flame)'}} /></div>
      <p className="quota-note">Limit reset. A new window starts with your next request.</p>
    </section>
  );
  return (
    <section className={`quota-card ${w.forecast?.runsOut ? 'at-risk' : ''}`}>
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="quota-countdown">
          Resets in <b>{fmtCountdown(w.resetsAt)}</b>
        </span>
      </div>
      <div className="quota-big">
        <strong>
          {w.remainingPercent.toFixed(w.remainingPercent % 1 ? 1 : 0)}%
        </strong>
        <span>left</span>
        <span className={`pace-badge ${w.paceDelta >= -0.05 ? 'good' : 'bad'}`}>
          {w.paceDelta > 0 ? '+' : w.paceDelta < 0 ? '−' : ''}
          {Math.abs(w.paceDelta).toFixed(1)} pts{' '}
          {w.paceDelta >= 0 ? 'ahead' : 'behind'}
        </span>
      </div>
      <QuotaPlot window={w} minimal />
      {showResetTime && <p className="quota-note">Used {w.usedPercent.toFixed(1)}% · Resets {new Date(w.resetsAt).toLocaleString('en-US', {weekday:'short', hour:'numeric', minute:'2-digit'})}</p>}
    </section>
  );
}
