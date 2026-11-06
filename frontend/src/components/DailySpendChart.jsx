import React, { useState, useMemo } from 'react';
import { bucketDaily, groupMap, fmtUsd, fmtSpend, shortDate } from '../lib/format.js';
import {
  ChartHitArea,
  ChartReadout,
  useChartCursor,
} from './ChartInteraction.jsx';
import BrandIcon from './BrandIcon.jsx';
const colors = { claude: '#ff9f43', codex: '#35cf60' },
  fallback = ['#0a84ff', '#bf5af2', '#ffd60a'];
export default function DailySpendChart({
  daily,
  groups,
  models,
  capabilities,
  defaultMode = 'daily',
  period,
  title,
  showGranularity = true,
}) {
  const [mode, setMode] = useState(defaultMode);
  const [breakdown, setBreakdown] = useState('total');
  const modelKeys = useMemo(() => [...(models || [])].filter(m => m.spend > 0)
    .sort((a,b) => b.spend - a.spend || a.model.localeCompare(b.model)).slice(0,5).map(m=>m.model), [models]);
  const modelColors = ['#0a84ff', '#35cf60', '#ff9f43', '#bf5af2', '#ffd60a', '#8e8e93'];
  const cursor = useChartCursor({
    width: 1100,
    left: 30,
    right: 8,
    steps: Math.max(1, (daily?.length || 1) - 1),
  });
  const data = useMemo(() => {
    let rows = daily || [];
    if (models && breakdown === 'model') rows = rows.map(d => {
      const byGroup = Object.fromEntries(modelKeys.map(k => [k, d.byModel?.[k] || 0]));
      byGroup.Other = Math.max(0, d.spend - Object.values(byGroup).reduce((a,b)=>a+b,0));
      return {...d, byGroup};
    });
    if (mode === 'daily' && period?.from && period?.to) {
      const map = new Map(rows.map((d) => [d.date, d]));
      const span =
        Math.round(
          (Date.parse(period.to) - Date.parse(period.from)) / 86400000,
        ) + 1;
      if (span > 0 && span <= 730)
        rows = Array.from({ length: span }, (_, i) => {
          const date = new Date(Date.parse(period.from) + i * 86400000)
            .toISOString()
            .slice(0, 10);
          return map.get(date) || { date, spend: 0, tokens: 0 };
        });
    }
    return bucketDaily(rows, mode);
  }, [daily, mode, period, models, breakdown, modelKeys]);
  const keys = useMemo(
    () =>
      models && breakdown === 'model' ? [...modelKeys, 'Other'] : capabilities?.groups === 'harness'
        ? (groups || []).map((g) => g.key)
        : [],
    [groups, capabilities, models, breakdown, modelKeys],
  );
  const color = (k, i) =>
    (models && breakdown === 'model' ? modelColors[i % modelColors.length] : null) || colors[k] ||
    (groups || []).find((g) => g.key === k)?.color ||
    fallback[i % fallback.length];
  const W = 1100,
    H = keys.length === 1 ? 200 : 255,
    L = 30,
    R = 8,
    T = 10,
    B = 28,
    PW = W - L - R,
    PH = H - T - B,
    n = data.length || 1,
    slot = PW / n,
    barW = Math.max(1, Math.min(24, slot * 0.68));
  const rawMax = Math.max(0.01, ...data.map((d) => d.spend));
  const magnitude = 10 ** Math.floor(Math.log10(rawMax / 3));
  const normalized = rawMax / 3 / magnitude;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    magnitude;
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from(
    { length: Math.round(max / step) + 1 },
    (_, i) => i * step,
  );
  const y = (v) => T + PH * (1 - v / max),
    tickEvery = Math.max(1, Math.ceil(n / 6));
  const selectedIndex =
    cursor.fraction == null
      ? null
      : Math.min(data.length - 1, Math.floor(cursor.fraction * n));
  const selected = selectedIndex == null ? null : data[selectedIndex];
  const selectedX =
    selectedIndex == null ? 0 : L + (selectedIndex + 0.5) * slot;
  const selectedGroups = selected ? groupMap(selected.byGroup) : null;
  return (
    <section className="card spend-chart">
      {(daily || []).some((d) => d.costComplete === false) &&
        <p className="group-sub">Known spend only · usage without pricing is excluded.</p>}
      <div className="chart-head">
        <h2 className="card-title">
          <BrandIcon name="spend" />
          {title || `${mode === 'daily' ? 'Daily' : mode === 'weekly' ? 'Weekly' : 'Monthly'} spend`}
        </h2>
        {showGranularity && <div
          className="segmented small"
          role="group"
          aria-label="Spend granularity"
        >
          {[
            ['daily', 'Daily'],
            ['weekly', 'Weekly'],
            ['monthly', 'Monthly'],
          ].map(([k, label]) => (
            <button
              key={k}
              className={mode === k ? 'active' : ''}
              onClick={() => setMode(k)}
            >
              {label}
            </button>
          ))}
        </div>}
        {models && <div className="segmented small" role="group" aria-label="Spend breakdown">
          {['total','model'].map(k => <button key={k} className={breakdown === k ? 'active' : ''} onClick={()=>setBreakdown(k)}>{k === 'total' ? 'Total' : 'Model'}</button>)}
        </div>}
        <ChartReadout label="Selected spend values">
          {selected ? <>
            <span>{selected.label}</span><span>{fmtSpend(selected)}</span>
            {selectedGroups && keys.filter(k => selectedGroups[k] > 0).map(k =>
              <span key={k}><i className="group-dot" style={{ background: color(k, keys.indexOf(k)) }} />
                {k === 'claude' ? 'Claude Code' : k === 'codex' ? 'Codex' : k === 'opencode' ? 'OpenCode' : k} {fmtUsd(selectedGroups[k])}
              </span>)}
          </> : <span>USD</span>}
        </ChartReadout>
      </div>
      {data.length ? (
        <div className="chart-wrap">
          <svg
            className="chart-svg"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Spend by date"
          >
            {ticks.map((value) => (
              <g key={value}>
                <line
                  x1={L}
                  x2={W - R}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="var(--line)"
                />
                <text
                  x={L - 8}
                  y={y(value) + 4}
                  className="axis-text"
                  textAnchor="end"
                >
                  {max < 1 ? value.toFixed(2) : Math.round(value)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const bg = groupMap(d.byGroup),
                segs =
                  keys.length && bg
                    ? keys.map((k, ki) => [k, bg[k] || 0, color(k, ki)])
                    : [
                        [
                          null,
                          d.spend,
                          keys.length === 1
                            ? color(keys[0], 0)
                            : 'var(--flame)',
                        ],
                      ];
              let acc = 0;
              return (
                <g key={d.date}>
                  <rect
                    x={L + i * slot}
                    y={T}
                    width={slot}
                    height={PH}
                    fill="transparent"
                  />
                  {segs.map(([k, v, c], j) => {
                    const h = (v / max) * PH,
                      yy = T + PH - acc - h;
                    acc += h;
                    return (
                      <rect
                        key={k || j}
                        x={L + i * slot + (slot - barW) / 2}
                        y={yy}
                        width={barW}
                        height={Math.max(0, h)}
                        rx={j === segs.length - 1 ? 1.5 : 0}
                        fill={c}
                      />
                    );
                  })}
                  {i % tickEvery === 0 && (
                    <text
                      x={L + (i + 0.5) * slot}
                      y={H - 7}
                      textAnchor="middle"
                      className="axis-text"
                    >
                      {mode === 'daily' ? shortDate(d.date) : d.label}
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
              label="Inspect spend by date"
            />
          </svg>

        </div>
      ) : (
        <div className="empty">No spend recorded for this period.</div>
      )}
      {models && breakdown === 'model' && <p className="group-sub">Top 5 models by spend over the selected period · Other includes remaining models and unallocated spend.</p>}
      {keys.length > 1 && (
        <div className="legend">
          {keys.map((k, i) => (
            <span key={k} className="legend-item">
              <i className="group-dot" style={{ background: color(k, i) }} />
              {k === 'claude' ? 'Claude Code' : k === 'codex' ? 'Codex' : k === 'opencode' ? 'OpenCode' : k}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
