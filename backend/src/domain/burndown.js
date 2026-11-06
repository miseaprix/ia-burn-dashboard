// Monthly budget burn-down: pure math, no I/O. Used by the enterprise provider.

const DAY_MS = 86400000;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

// Local-time YYYY-MM-DD (same bucketing as providers.js / local.js).
export function localIsoDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Calendar month bounds in the process timezone.
export function monthBounds(now = new Date()) {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0);
  return { monthStart, monthEnd };
}

// Build [{date, cumSpend}] for every day from monthStart to `now` (inclusive),
// from raw activity rows [{date, spend}]. Missing/invalid days count as 0.
export function cumulativeFromDaily(rows, monthStart, now) {
  const perDay = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const spend = Number(r?.spend);
    if (typeof r?.date === 'string' && Number.isFinite(spend)) {
      const key = r.date.slice(0, 10);
      perDay.set(key, (perDay.get(key) || 0) + spend);
    }
  }
  const out = [];
  let cum = 0;
  const d = new Date(monthStart);
  while (d <= now) {
    cum += perDay.get(localIsoDate(d)) || 0;
    out.push({ date: localIsoDate(d), cumSpend: cum });
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function computeBudgetBurndown({ spent, limit, now, monthStart, monthEnd, dailyCumulative = [] }) {
  const spentN = Number(spent) || 0;
  const limitN = Number(limit) > 0 ? Number(limit) : 0;
  const total = monthEnd.getTime() - monthStart.getTime();
  const elapsed = Math.min(Math.max(now.getTime() - monthStart.getTime(), 0), total);
  const elapsedFrac = total > 0 ? elapsed / total : 0;

  const usedPct = limitN > 0 ? (spentN / limitN) * 100 : 0; // unbounded
  const idealPctNow = 100 * elapsedFrac;
  const pacePts = usedPct - idealPctNow;
  const projectedSpend = elapsedFrac > 0 ? spentN / elapsedFrac : 0;
  const willExceed = limitN > 0 && projectedSpend > limitN;

  // Date the cumulative spend reaches the limit at the current rate ($/ms = spent/elapsed).
  let projectedEndDate = null;
  if (willExceed && spentN > 0 && elapsed > 0) {
    projectedEndDate = new Date(monthStart.getTime() + (limitN * elapsed) / spentN).toISOString();
  }

  const pct = (v) => (limitN > 0 ? r1((v / limitN) * 100) : 0);
  const actual = dailyCumulative.map((p) => ({
    date: p.date,
    cumSpend: r2(p.cumSpend),
    cumPct: pct(p.cumSpend),
  }));
  const forecast = [
    { date: now.toISOString(), cumSpend: r2(spentN), cumPct: pct(spentN) },
    { date: monthEnd.toISOString(), cumSpend: r2(projectedSpend), cumPct: pct(projectedSpend) },
  ];

  return {
    usedPct: r1(usedPct),
    remainingPct: r1(100 - usedPct),
    idealPctNow: r1(idealPctNow),
    pacePts: r1(pacePts),
    paceAbsPts: r1(Math.abs(pacePts)),
    status: pacePts > 0 ? 'over_pace' : 'under_pace',
    projectedSpend: r2(projectedSpend),
    willExceed,
    projectedEndDate,
    daysElapsed: r1(elapsed / DAY_MS),
    daysInMonth: Math.round(total / DAY_MS),
    actual,
    forecast,
  };
}
