import React, { useState, useMemo } from 'react';
import {
  ChartHitArea,
  ChartReadout,
  useChartCursor,
} from './ChartInteraction.jsx';
const colors = [
  '#009dff',
  '#35cf60',
  '#ff9f43',
  '#bf5af2',
  '#ffd60a',
  '#8a8f98',
];
export default function SurfaceChart({ data, status }) {
  const [mode, setMode] = useState('surfaces');
  const cursor = useChartCursor({
    width: 1100,
    left: 36,
    right: 8,
    steps: Math.max(1, (data?.days.length || 1) - 1),
  });
  const chart = useMemo(() => {
    if (!data?.days?.length) return null;
    const sums = new Map();
    const rows = data.days.map((d) => {
      const values = {};
      for (const s of d[mode]) {
        const key =
          mode === 'surfaces'
            ? s.label
            : s.model + (s.speed === 'fast' ? ' fast' : '');
        values[key] = (values[key] || 0) + s.usedPercent;
        sums.set(key, (sums.get(key) || 0) + s.usedPercent);
      }
      return { ...d, values };
    });
    const top = [...sums]
        .filter(([key]) => key !== 'Other')
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([k]) => k),
      keys = [...top];
    if (sums.size > top.length) keys.push('Other');
    return {
      keys,
      rows: rows.map((d) => ({
        ...d,
        values: Object.fromEntries(
          keys.map((k) => [
            k,
            k === 'Other'
              ? Object.entries(d.values)
                  .filter(([n]) => !top.includes(n))
                  .reduce((n, [, v]) => n + v, 0)
              : d.values[k] || 0,
          ]),
        ),
      })),
    };
  }, [data, mode]);
  if (!chart) return (
    <section className="card surface-panel">
      <h2 className="card-title">Weekly limit used per day</h2>
      <p className="surface-footnote" role="status">
        {status?.error ? 'Daily usage breakdown temporarily unavailable. Retrying automatically.'
          : 'No daily usage breakdown available yet.'}
      </p>
    </section>
  );
  const W = 1100,
    H = 210,
    L = 36,
    R = 8,
    T = 12,
    B = 28,
    PW = W - L - R,
    PH = H - T - B,
    max = Math.max(
      100,
      ...chart.rows.map((d) =>
        Object.values(d.values).reduce((a, b) => a + b, 0),
      ),
    ),
    slot = PW / chart.rows.length;
  const selectedIndex =
    cursor.fraction == null
      ? null
      : Math.min(
          chart.rows.length - 1,
          Math.floor(cursor.fraction * chart.rows.length),
        );
  const selected = selectedIndex == null ? null : chart.rows[selectedIndex];
  const selectedX =
    selectedIndex == null ? 0 : L + (selectedIndex + 0.35) * slot;
  return (
    <section className="card surface-panel">
      <div className="chart-head">
        <h2 className="card-title">Weekly limit used per day</h2>
        <div
          className="segmented small"
          role="group"
          aria-label="Usage grouping"
        >
          {['surfaces', 'models'].map((m) => (
            <button
              key={m}
              className={mode === m ? 'active' : ''}
              onClick={() => setMode(m)}
            >
              {m === 'surfaces' ? 'Surface' : 'Model'}
            </button>
          ))}
        </div>
        <ChartReadout label="Selected daily quota usage">
          {selected ? <>
            <span>{selected.date}</span><span>{selected.usedPercent.toFixed(1)}%</span>
            {chart.keys.filter(k => selected.values[k] > 0).map(k =>
              <span key={k}><i className="group-dot" style={{ background: colors[chart.keys.indexOf(k)] }} />{k} {selected.values[k].toFixed(1)}%</span>)}
          </> : <span>{data.totalPercent.toFixed(0)}% over {data.days.length} days</span>}
        </ChartReadout>
      </div>
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label="Weekly limit usage by day"
          className="chart-svg"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line
                x1={L}
                x2={W - R}
                y1={T + PH * (1 - f)}
                y2={T + PH * (1 - f)}
                stroke="var(--line)"
              />
              <text
                x={L - 7}
                y={T + PH * (1 - f) + 4}
                className="axis-text"
                textAnchor="end"
              >
                {Math.round(f * max)}%
              </text>
            </g>
          ))}
          {chart.rows.map((d, i) => {
            let total = 0;
            return (
              <g key={d.date}>
                <title>
                  {d.date} · {d.usedPercent.toFixed(1)}% ·{' '}
                  {Object.entries(d.values)
                    .map(([k, v]) => `${k}: ${v.toFixed(1)}%`)
                    .join(', ')}
                </title>
                {chart.keys.map((k, j) => {
                  const h = (d.values[k] / max) * PH,
                    y = T + PH - total - h;
                  total += h;
                  return (
                    <rect
                      key={k}
                      x={L + i * slot}
                      y={y}
                      width={slot * 0.7}
                      height={h}
                      fill={colors[j]}
                    />
                  );
                })}
                {i % Math.max(1, Math.ceil(chart.rows.length / 6)) === 0 && (
                  <text x={L + i * slot} y={H - 8} className="axis-text">
                    {new Date(`${d.date}T00:00:00Z`).toLocaleDateString(
                      'en-US',
                      {
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      },
                    )}
                  </text>
                )}
              </g>
            );
          })}
          {selected && (
            <line
              x1={selectedX}
              x2={selectedX}
              y1={T}
              y2={T + PH}
              stroke="var(--muted)"
              opacity=".6"
            />
          )}
          <ChartHitArea
            left={L}
            top={T}
            width={PW}
            height={PH}
            handlers={cursor.handlers}
            label="Inspect weekly limit used per day"
          />
        </svg>

      </div>
      <div className="legend">
        {chart.keys.map((k, i) => (
          <span key={k} className="legend-item">
            <span className="group-dot" style={{ background: colors[i] }} />
            {k}
          </span>
        ))}
      </div>
      <p className="surface-footnote">
        {status?.stale && <>Showing the last available breakdown · updated {new Date(status.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. </>}
        Share of the weekly limit consumed each day, as reported by ChatGPT’s
        Codex usage dashboard.
      </p>
    </section>
  );
}
