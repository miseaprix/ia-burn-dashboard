import React from 'react';
import BrandIcon from './BrandIcon.jsx';
import { fmtCompact } from '../lib/format.js';
const categories = [
  ['input', 'Input', '#009dff'], ['output', 'Output', '#ff9f43'],
  ['cacheWrite', 'Cache write', '#bf5af2'], ['cacheRead', 'Cache read', '#13cad4'],
];
export default function TokenBreakdown({ data }) {
  const total = categories.reduce((n, [key]) => n + (data[key] || 0), 0);
  return <section className="card token-panel">
    <div className="chart-head"><h2 className="card-title"><BrandIcon name="tokens" />Token breakdown</h2>
      <span className="chart-unit push-right">Available source data</span></div>
    <div className="token-mix-bar" aria-hidden="true">{categories.map(([key, , color]) =>
      <span key={key} style={{ width: `${total ? (data[key] || 0) / total * 100 : 0}%`, background: color }} />)}</div>
    <div className="token-mix-grid">{categories.map(([key, label, color]) => <div key={key}>
      <span className="group-sub"><i className="group-dot" style={{ background: color }} /> {label}</span>
      <strong>{data[key] == null ? '—' : fmtCompact(data[key])}</strong>
      <small>{total ? ((data[key] || 0) / total * 100).toFixed(1) : '0.0'}%</small>
    </div>)}</div>
  </section>;
}
