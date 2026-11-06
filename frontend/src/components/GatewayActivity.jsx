import {useEnterpriseLabel} from '../lib/enterprise.js';
import {DEMO} from '../lib/demo-mode.js';
import React from 'react';
import BrandIcon from './BrandIcon.jsx';
import { fmtCompact, fmtInt, fmtUsd } from '../lib/format.js';

const averageCost = (spend, requests) => requests > 0 && Number.isFinite(spend)
  ? DEMO ? `$${Number((spend/requests).toFixed(2))}` : `$${(spend / requests).toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })}` : '—';
const averageTokens = (tokens, requests) => requests > 0 && Number.isFinite(tokens)
  ? fmtInt(Math.round(tokens / requests)) : '—';

export default function GatewayActivity({ totals = {}, daily = [] }) {
  const label=useEnterpriseLabel();
  const items = [
    ['Requests', totals.requests == null ? '—' : fmtInt(totals.requests), 'Reported API requests', 'tokens'],
    ['Avg cost / request', averageCost(totals.spend, totals.requests), 'Spend ÷ requests', 'spend'],
    ['Avg tokens / request', averageTokens(totals.tokens, totals.requests), 'Tokens ÷ requests · includes cache', 'ratio'],
    ['Days recorded', fmtInt(totals.days), 'Days returned by the gateway', 'models'],
  ];
  return <>
    <section className="card statstrip" aria-label="Gateway activity summary">
      {items.map(([label, value, sub, icon]) => <div className="kpi-card" key={label}>
        <div className="kpi-head"><BrandIcon name={icon} /><span className="stat-label">{label}</span></div>
        <div className="kpi-number">{value}</div><div className="kpi-sub">{sub}</div>
      </div>)}
    </section>
    <details className="card gateway-activity">
      <summary>Daily API activity · requests, tokens and average costs</summary>
      <p className="group-sub">Selected period · unavailable metrics appear as —. Harness breakdown is available in {label} local; its coverage differs from the gateway.</p>
      <div className="gateway-table-wrap"><table className="economics-table">
        <thead><tr><th scope="col">Date</th><th scope="col">Requests</th><th scope="col">Tokens</th><th scope="col">Spend</th><th scope="col">Cost / request</th><th scope="col">Tokens / request</th></tr></thead>
        <tbody>{[...daily].sort((a,b)=>b.date.localeCompare(a.date)).map(d => <tr key={d.date}>
          <th scope="row">{d.date}</th><td>{d.requests == null ? '—' : fmtInt(d.requests)}</td>
          <td>{d.tokens == null ? '—' : fmtCompact(d.tokens)}</td><td>{fmtUsd(d.spend)}</td>
          <td>{averageCost(d.spend, d.requests)}</td><td>{averageTokens(d.tokens, d.requests)}</td>
        </tr>)}</tbody>
      </table></div>
      {!daily.length && <p className="group-sub">No activity recorded for this period.</p>}
    </details>
  </>;
}
