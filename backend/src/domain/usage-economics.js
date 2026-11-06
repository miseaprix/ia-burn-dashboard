// Day aggregates cannot locate individual requests within the first day of a
// rolling window. Match Agent Burn's proportional first-day approximation.
export function costInWindow(rows, startMs, endMs = Date.now()) {
  return rows.reduce((sum, row) => {
    const date = new Date(`${row.period}T00:00:00`).getTime();
    const end = new Date(`${row.period}T00:00:00`);
    end.setDate(end.getDate() + 1);
    if (!Number.isFinite(date) || end.getTime() <= startMs || date > endMs)
      return sum;
    const fraction =
      date < startMs ? (end.getTime() - startMs) / (end.getTime() - date) : 1;
    if (sum === null || row.unknownTokens > 0) return null;
    return sum + row.cost * fraction;
  }, 0);
}
export function usageEconomics(rows, subscription, burndown, now = Date.now()) {
  const cost = costInWindow(rows, now - 30 * 86400000, now),
    price = subscription?.pricePerMonth;
  const economics = {
    apiEquivalent30d: cost,
    valueMultiple: cost != null && price > 0 ? cost / price : null,
    subsidy: cost != null && price > 0 ? cost - price : null,
    discountPercent:
      cost != null && price > 0 && cost > 0 ? Math.max(0, 1 - price / cost) * 100 : null,
    fullQuotaValue: null,
    monthlyValue: null,
    roughEstimate: null,
  };
  if (burndown)
    for (const w of [burndown.session, burndown.weekly].filter(Boolean)) {
      const spent = costInWindow(
        rows,
        Date.parse(w.start),
        Date.parse(burndown.observedAt),
      );
      w.apiEquivalentSpent = spent;
      w.dollarsPerPercent = spent != null && w.usedPercent > 0 ? spent / w.usedPercent : null;
      if (spent != null && w === burndown.weekly && w.usedPercent > 0 && w.elapsedPercent > 0) {
        economics.fullQuotaValue = spent / (w.usedPercent / 100);
        economics.monthlyValue =
          (economics.fullQuotaValue * 30.4375) / (w.windowMinutes / 1440);
        economics.roughEstimate = w.usedPercent < 3;
      }
    }
  return economics;
}

export function usageDetails(rows, harness, now = Date.now()) {
  const start = now - 30 * 86400000;
  const recent = rows.filter(row => {
    const end = new Date(`${row.period}T00:00:00`);
    end.setDate(end.getDate() + 1);
    return end.getTime() > start && new Date(`${row.period}T00:00:00`).getTime() <= now;
  });
  const fraction = row => {
    const a = new Date(`${row.period}T00:00:00`), b = new Date(a);
    b.setDate(b.getDate() + 1);
    return Math.min(1, (b.getTime() - start) / (b - a));
  };
  const mix = ['input', 'output', 'cacheWrite', 'cacheRead'].map(key => {
    const relevant = recent.filter(row => (row.breakdown?.[key] || 0) > 0);
    return { key, tokens: Math.round(relevant.reduce((n, row) => n + row.breakdown[key] * fraction(row), 0)),
      cost: relevant.some(row => row.tokenCosts?.[key] == null) ? null
        : relevant.reduce((n, row) => n + row.tokenCosts[key] * fraction(row), 0) };
  });
  const total = mix.every(m => m.cost != null) ? mix.reduce((n, m) => n + m.cost, 0) : null;
  for (const m of mix) m.costPercent = total > 0 && m.cost != null ? m.cost / total * 100 : null;
  const daily = recent.map(row => ({ date: row.period, spend: row.cost * fraction(row),
    costComplete: !(row.unknownTokens > 0), tokens: row.tokens,
    byGroup: { [harness]: row.cost * fraction(row) } }));
  const images = harness === 'codex' ? {
    count: recent.length && recent.every(row => row.imageCount != null)
      ? recent.reduce((n, row) => n + row.imageCount, 0) : null,
    pricePerImageEstimate: 0.15,
  } : null;
  if (images) images.estimatedCost = images.count == null ? null : images.count * images.pricePerImageEstimate;
  return { spendMix: mix, daily30d: daily, imageGenerations: images,
    period30d: { from: new Date(start).toISOString().slice(0, 10), to: new Date(now).toISOString().slice(0, 10) },
    basis: 'Observed logs; first day prorated for tokens and cost, image calls counted by day.' };
}
