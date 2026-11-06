// Helpers to build and validate the UNIFIED dashboard object.
// Both providers (local, enterprise) must return exactly this shape so the
// frontend can render either source with the same components.

// Build a UNIFIED object, filling defaults for any missing field.
function coverage(value) {
  return value.costComplete === undefined ? {} : {
    costComplete: value.costComplete, unknownTokens: value.unknownTokens,
    ...(value.knownSpend === undefined ? {} : { knownSpend: value.knownSpend }),
  };
}
export function buildUnified({
  source,
  period = { from: null, to: null, label: '' },
  capabilities = { tokens: false, groups: 'provider', budget: false },
  totals = {},
  daily = [],
  groups = [],
  models = [],
  budget = null,
  budgetBurndown = null,
  updatedAt = new Date().toISOString(),
}) {
  const out = {
    source,
    period: {
      from: period.from ?? null,
      to: period.to ?? null,
      label: period.label ?? '',
    },
    capabilities: {
      tokens: Boolean(capabilities.tokens),
      groups: capabilities.groups === 'harness' ? 'harness' : 'provider',
      budget: Boolean(capabilities.budget),
    },
    totals: {
      spend: Number(totals.spend ?? 0),
      ...coverage(totals),
      tokens:
        totals.tokens === null || totals.tokens === undefined
          ? null
          : Number(totals.tokens),
      days: Number(totals.days ?? 0),
      models: Number(totals.models ?? 0),
      requests:
        totals.requests === null || totals.requests === undefined
          ? null
          : Number(totals.requests),
    },
    daily: daily.map((d) => ({
      date: d.date,
      requests: d.requests ?? null,
      spend: d.spend === null ? null : Number(d.spend ?? 0),
      ...coverage(d),
      tokens:
        d.tokens === null || d.tokens === undefined ? null : Number(d.tokens),
    })),
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      color: g.color,
      spend: g.spend === null ? null : Number(g.spend ?? 0),
      ...coverage(g),
      tokens:
        g.tokens === null || g.tokens === undefined ? null : Number(g.tokens),
    })),
    models: models.map((m) => ({
      model: m.model,
      provider: m.provider,
      spend: m.spend === null ? null : Number(m.spend ?? 0),
      ...coverage(m),
      tokens:
        m.tokens === null || m.tokens === undefined ? null : Number(m.tokens),
      share: Number(m.share ?? 0),
    })),
    budget:
      budget == null
        ? null
        : {
            limit: Number(budget.limit ?? 0),
            spent: Number(budget.spent ?? 0),
            remaining: Number(budget.remaining ?? 0),
            pctRemaining: Number(budget.pctRemaining ?? 0),
            // Optional monthly-window fields (enterprise only).
            ...(budget.monthStart
              ? {
                  currency: budget.currency ?? 'USD',
                  monthStart: budget.monthStart,
                  monthEnd: budget.monthEnd,
                  resetsAt: budget.resetsAt,
                }
              : {}),
          },
    updatedAt,
  };
  // Top-level (non-breaking): the unified shape has no `harnesses` structure, so
  // `budgetBurndown` sits next to `budget`. Present only when provided, so the
  // local view keeps its exact existing shape.
  if (budgetBurndown) out.budgetBurndown = budgetBurndown;
  return out;
}

// Round a currency value to 2 decimals (number, not string).
export function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Contract v2 keeps spend/byGroup aliases for existing components.
export function contract(out, range, requested) {
  out.contractVersion = 2;
  out.generatedAt = out.updatedAt;
  out.range = range;
  out.requested = requested;
  out.period = {
    ...out.period,
    from: out.daily[0]?.date ?? null,
    to: out.daily.at(-1)?.date ?? null,
  };
  const decorate = (view) => {
    view.totals.cost = view.totals.spend;
    view.totals.avgTokensPerDollar =
      view.totals.costComplete !== false && view.totals.tokens > 0 && view.totals.spend > 0
        ? view.totals.tokens / view.totals.spend
        : null;
    view.avgTokensPerDollar = view.totals.avgTokensPerDollar;
    for (const d of view.daily) {
      d.cost = d.spend;
      if (d.byGroup) d.byHarness = d.byGroup;
    }
    for (const m of view.models) {
      m.cost = m.spend;
      m.share = view.totals.costComplete === false || m.spend == null ? null :
        view.totals.spend > 0
          ? Math.min(1, Math.max(0, m.spend / view.totals.spend))
          : 0;
    }
  };
  decorate(out);
  for (const h of Object.values(out.harnesses || {})) decorate(h);
  out.byHarness =
    out.capabilities.groups === 'harness'
      ? out.groups.map((g) => ({
          ...g,
          name: ({claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode'})[g.key] || g.label,
          cost: g.spend,
          active: true,
        }))
      : [];
  out.activeCount = out.byHarness.length;
  out.subscriptions = Object.entries(out.harnesses || {})
    .filter(([, h]) => h.subscription && (h.totals.spend > 0 || h.totals.tokens > 0))
    .map(([harness, h]) => ({
      harness,
      ...h.subscription,
      periodUsage: h.totals.spend,
    }));
  out.footnote =
    out.source === 'local'
      ? 'Spend is API-equivalent usage, not your subscription bill.'
      : out.source === 'enterprise-local'
        ? 'Observed enterprise usage on this workstation. Costs are API-equivalent estimates, not the corporate invoice or total key usage.'
        : 'Spend reported by the enterprise gateway.';
  const span =
    (Date.parse(requested.to) - Date.parse(requested.from)) / 86400000 + 1;
  out.granularityDefault =
    span > 182 ? 'monthly' : span > 62 ? 'weekly' : 'daily';
  return out;
}
