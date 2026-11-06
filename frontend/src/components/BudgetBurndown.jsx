import {useEnterpriseLabel} from '../lib/enterprise.js';
import React from 'react';
import {
  ChartHitArea,
  ChartTooltip,
  useChartCursor,
} from './ChartInteraction.jsx';
import { fmtCountdown, fmtUsd, parseDay, shortDate } from '../lib/format.js';

const W = 720,
  H = 280,
  L = 44,
  R = 16,
  T = 16,
  B = 30;
const PW = W - L - R;
const PH = H - T - B;

const num = (n, d = 0) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: d });

export default function BudgetBurndown({ budget, burndown }) {
  const label=useEnterpriseLabel();
  const cursor = useChartCursor({ width: W, left: L, right: R, steps: 30 });
  const b = burndown;
  const days = Math.max(1, Number(b.daysInMonth) || 30);
  const start = parseDay(budget.monthStart);
  const limit = Number(budget.limit) || 0;

  // x fraction (0..1) at END of the given day (cumulative values are end-of-day).
  const fracOf = (date) => {
    // Un horodatage se ramène au jour local, pas au jour UTC (décalé après minuit)
    const s = String(date || '');
    const d = parseDay(s.length > 10 ? new Date(s).toLocaleDateString('en-CA') : s);
    if (!d || !start) return 0;
    const idx = Math.round((d - start) / 86400000);
    return Math.min(1, Math.max(0, (idx + 1) / days));
  };
  const X = (f) => L + f * PW;
  const Y = (pct) => T + PH * (1 - Math.min(100, Math.max(0, pct)) / 100);
  const remaining = (p) => 100 - (Number(p.cumPct) || 0);

  const actualPts = [
    [0, 100],
    ...(b.actual || []).map((p) => [fracOf(p.date), remaining(p)]),
  ];
  const last = actualPts[actualPts.length - 1];
  const forecastPts = [
    last,
    ...(b.forecast || []).map((p) => [fracOf(p.date), remaining(p)]),
  ];
  const nowF = Math.min(1, Math.max(0, (Number(b.daysElapsed) || 0) / days));
  const path = (pts) =>
    pts
      .map(
        ([f, v], i) => `${i ? 'L' : 'M'}${X(f).toFixed(1)},${Y(v).toFixed(1)}`,
      )
      .join(' ');

  // Split at intersections so a single daily segment can change pace color.
  const paceSegments = [];
  const addSegment = (a, b) => paceSegments.push({a, b,
    ahead: (a[1] - 100 * (1 - a[0]) + b[1] - 100 * (1 - b[0])) >= 0});
  for (let i = 1; i < actualPts.length; i++) {
    const a = actualPts[i - 1], c = actualPts[i];
    const da = a[1] - 100 * (1 - a[0]), dc = c[1] - 100 * (1 - c[0]);
    if (da * dc < 0) {
      const fraction = a[0] + (c[0] - a[0]) * da / (da - dc);
      const crossing = [fraction, 100 * (1 - fraction)];
      addSegment(a, crossing); addSegment(crossing, c);
    } else addSegment(a, c);
  }

  const over = b.status === 'over_pace';
  const willExceed = !!b.willExceed;
  const endF =
    willExceed && b.projectedEndDate ? fracOf(b.projectedEndDate) : null;
  const perDay = Math.round(limit / days);
  const projColor = willExceed ? 'var(--danger)' : 'var(--success)';
  const nowY = last[1];

  const midDate = (f) => {
    if (!start) return '';
    return shortDate(
      new Date(start.getTime() + Math.round(f * days) * 86400000).toISOString(),
    );
  };

  const f = cursor.fraction;
  const projected = f != null && f > last[0];
  const points = projected ? forecastPts : actualPts;
  const interpolate = (pts, at) => {
    if (at <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++)
      if (at <= pts[i][0]) {
        const [a, av] = pts[i - 1],
          [b, bv] = pts[i];
        return b === a ? bv : av + ((bv - av) * (at - a)) / (b - a);
      }
    return pts.at(-1)[1];
  };
  const value = f == null ? null : interpolate(points, f),
    ideal = f == null ? null : 100 * (1 - f);
  return (
    <section className="card budget-card" aria-label="Monthly budget">
      {willExceed && (
        <div className="budget-alert" role="alert">
          ⚠️ Budget runs out ≈ {shortDate(b.projectedEndDate)}. Keep under{' '}
          {perDay} $/day to last the month.
        </div>
      )}

      <div className="budget-head">
        <div>
          <h2 className="card-title big">{label} budget remaining</h2>
          <div className="budget-sub">
            {num(limit)} $US / month · Resets in {fmtCountdown(budget.resetsAt)}
            <div>100% = unspent · 0% = exhausted · Dotted line = forecast · Green = ahead · Red = behind</div>
          </div>
        </div>
        <div className="budget-big">
          <span className="budget-pct tabnum">{num(b.remainingPct, 1)}%</span>
          <span className="budget-left">left</span>
          <span className={`pace-badge ${over ? 'bad' : 'good'}`}>
            {over
              ? `−${num(b.paceAbsPts, 0)} pts behind`
              : `+${num(b.paceAbsPts, 0)} pts ahead`}
          </span>
        </div>
      </div>

      <div className="chart-wrap">
        <svg
          className="burn-svg"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Budget burn-down chart"
        >
          <defs>
            <pattern
              id="lockHatch"
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="8" height="8" fill="rgba(255,59,48,0.08)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="rgba(255,59,48,0.45)"
                strokeWidth="2"
              />
            </pattern>
          </defs>

          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line
                x1={L}
                x2={W - R}
                y1={Y(v)}
                y2={Y(v)}
                stroke="var(--line)"
                strokeWidth="1"
              />
              <text
                x={L - 8}
                y={Y(v) + 4}
                textAnchor="end"
                className="axis-text"
              >
                {v}%
              </text>
            </g>
          ))}

          {endF != null && endF < 1 && (
            <g>
              <rect
                x={X(endF)}
                y={T}
                width={X(1) - X(endF)}
                height={PH}
                fill="url(#lockHatch)"
              />
              <text
                x={(X(endF) + X(1)) / 2}
                y={T + 16}
                textAnchor="middle"
                className="lock-text"
              >
                Locked out
              </text>
              <text
                x={X(endF)}
                y={H - B + 26 > H ? H - 4 : T + PH + 24}
                textAnchor="middle"
                className="empty-text"
              >
                Empty {shortDate(b.projectedEndDate)}
              </text>
            </g>
          )}

          {paceSegments.map(({a,b,ahead},i) => (
            <path key={`pace-fill-${i}`}
              d={`${path([a,b,[b[0],100*(1-b[0])],[a[0],100*(1-a[0])]])} Z`}
              fill={ahead ? 'var(--success)' : 'var(--danger)'} fillOpacity="0.18" />
          ))}

          {/* even pace */}
          <line
            x1={X(0)}
            y1={Y(100)}
            x2={X(1)}
            y2={Y(0)}
            stroke="var(--muted)"
            strokeWidth="1.5"
            strokeDasharray="5 5"
          />
          <text
            x={X(0.78)}
            y={Y(22) - 6}
            className="axis-text"
            transform={`rotate(${(Math.atan2(PH, PW) * 180) / Math.PI} ${X(0.78)} ${Y(22) - 6})`}
          >
            even pace
          </text>

          {/* Now */}
          <line
            x1={X(nowF)}
            x2={X(nowF)}
            y1={T}
            y2={T + PH}
            stroke="var(--ink)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <text
            x={X(nowF)}
            y={T + PH + 14}
            textAnchor="middle"
            className="axis-text now"
          >
            Now
          </text>

          {forecastPts.length > 1 && (
            <path
              d={path(forecastPts)}
              fill="none"
              stroke={projColor}
              strokeWidth="2"
              strokeDasharray="2 5"
              strokeLinecap="round"
            />
          )}
          {paceSegments.map(({a,b,ahead},i) => (
            <path key={`pace-line-${i}`} d={path([a,b])} fill="none"
              stroke={ahead ? 'var(--success)' : 'var(--danger)'} strokeWidth="2.5"
              strokeLinejoin="round" strokeLinecap="round" />
          ))}
          <circle
            cx={X(last[0])}
            cy={Y(nowY)}
            r="5"
            fill={last[1] >= 100*(1-last[0]) ? 'var(--success)' : 'var(--danger)'}
            stroke="var(--bg)"
            strokeWidth="2"
          />

          {[0, 0.5, 1].map((f) => (
            <text
              key={f}
              x={X(f)}
              y={H - 4}
              textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
              className="axis-text"
            >
              {midDate(f === 1 ? 1 - 1 / days : f)}
            </text>
          ))}
          {value != null && (
            <g>
              <line
                x1={X(f)}
                x2={X(f)}
                y1={T}
                y2={T + PH}
                stroke="var(--flame)"
                opacity=".65"
              />
              <circle cx={X(f)} cy={Y(value)} r="4" fill="var(--flame)" />
            </g>
          )}
          <ChartHitArea
            left={L}
            top={T}
            width={PW}
            height={PH}
            handlers={cursor.handlers}
            label="Inspect monthly budget burn-down"
          />
        </svg>
        {value != null && (
          <ChartTooltip left={(X(f) / W) * 100} top={(Y(value) / H) * 100}>
            <strong>
              {projected ? 'Projected · ' : ''}
              {value.toFixed(1)}% left
            </strong>
            <span className={value >= ideal ? 'pos' : 'neg'}>
              {value >= ideal ? '+' : '−'}{Math.abs(value - ideal).toFixed(1)}% {value >= ideal ? 'ahead' : 'behind'}
            </span>
          </ChartTooltip>
        )}
      </div>

      <div className="budget-stats tabnum">
        <span>
          Used <b>{num(b.usedPct, 1)}%</b>
        </span>
        <span>Remaining <b>{fmtUsd(budget.remaining)}</b></span>
        <span>
          Spent <b>{fmtUsd(budget.spent)}</b> / {num(limit)}$
        </span>
        <span>
          <b>
            {b.daysElapsed}/{b.daysInMonth}
          </b>{' '}
          days
        </span>
        <span>
          Projected{' '}
          <b className={willExceed ? 'neg' : 'pos'}>
            {fmtUsd(b.projectedSpend)}
          </b>
        </span>
      </div>
    </section>
  );
}
