import React from 'react';
import DailySpendChart from './DailySpendChart.jsx';
import { fmtUsd, fmtCompact } from '../lib/format.js';
const labels = { input: 'Input', output: 'Output', cacheWrite: 'Cache write', cacheRead: 'Cached input' };
const multiple = n => n == null ? '—' : `${n.toFixed(2)}×`;
const percent = n => n == null ? '—' : `${n.toFixed(1)}%`;
export default function SubscriptionEconomics({ data, harness }) {
  const e = data.economics || {}, usage = data.usageDetails || {};
  const weekly = data.burndown?.weekly;
  const price = data.subscription?.pricePerMonth;
  const daily = usage.daily30d || [];
  const groups = [{ key: harness, label: harness === 'codex' ? 'Codex' : 'Claude Code' }];
  const caps = { tokens: true, groups: 'harness' };
  return <details className="card economics-panel" open>
    <summary>Subscription economics, token costs and weekly trends</summary>
    <p className="group-sub">Past 30 days · {usage.period30d?.from} – {usage.period30d?.to} · API-equivalent estimates</p>
    <div className="economics-kpis">
      <div><span>Past 30 days</span><strong>{fmtUsd(e.apiEquivalent30d)}</strong></div>
      <div><span>Monthly plan</span><strong>{fmtUsd(price)}</strong></div>
      <div><span>Subscription value</span><strong>{multiple(e.valueMultiple)}</strong></div>
    </div>
    <DailySpendChart daily={daily} groups={groups} capabilities={caps} defaultMode="daily" period={usage.period30d} />
    <section className="economics-section">
      <div className="chart-head"><h3>Spend by token type</h3><span className="chart-unit push-right">Past 30 days</span></div>
      <table className="economics-table"><thead><tr><th>Type</th><th>Tokens</th><th>Cost share</th><th>Spend</th></tr></thead>
        <tbody>{(usage.spendMix || []).map(m => <tr key={m.key}><td>{labels[m.key]}</td><td>{fmtCompact(m.tokens)}</td>
          <td>{percent(m.costPercent)}</td><td>{fmtUsd(m.cost)}</td></tr>)}</tbody></table>
      {(usage.spendMix || []).some(m => m.cost == null) && <p className="group-sub">Reported totals without a token cost breakdown remain unallocated. Missing tariffs remain unknown.</p>}
    </section>
    <DailySpendChart title="Weekly trend" daily={daily} groups={groups} capabilities={caps} defaultMode="weekly" showGranularity={false} period={usage.period30d} />
    <section className="economics-section">
      <div className="chart-head"><h3>Quota value estimate</h3><span className="chart-unit push-right">Based on current cycle</span></div>
      <dl className="economics-rows">
        <div><dt>Full quota value</dt><dd>{fmtUsd(e.fullQuotaValue)}</dd></div>
        <div><dt>Average $ / %</dt><dd>{fmtUsd(weekly?.dollarsPerPercent)} / %</dd></div>
        <div><dt>Monthly quota value</dt><dd>{fmtUsd(e.monthlyValue)}</dd></div>
        <div><dt>Projected quota consumption</dt><dd>{percent(weekly?.forecast?.projectedUsePercent)}</dd></div>
        <div><dt>Quota value / plan price</dt><dd>{multiple(e.monthlyValue != null && price > 0 ? e.monthlyValue / price : null)}</dd></div>
      </dl>
      {!weekly && <p className="group-sub">Requires an available current weekly quota reading.</p>}
      {e.roughEstimate && <p className="group-sub">Early-cycle estimate: little quota usage has been observed.</p>}
    </section>
    {harness === 'codex' && <section className="economics-section">
      <div className="chart-head"><h3>Image generations</h3><span className="chart-unit push-right">Past 30 days</span></div>
      <dl className="economics-rows"><div><dt>Generated image calls</dt><dd>{usage.imageGenerations?.count ?? '—'}</dd></div>
        <div><dt>Estimated image cost</dt><dd>{fmtUsd(usage.imageGenerations?.estimatedCost)}</dd></div></dl>
      <p className="group-sub">{fmtUsd(usage.imageGenerations?.pricePerImageEstimate)} per image call estimate. Separate from token usage; observed logs only.</p>
    </section>}
  </details>;
}
