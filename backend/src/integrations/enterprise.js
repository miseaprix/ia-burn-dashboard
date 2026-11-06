// Enterprise gateway provider (label configured by ENTERPRISE_LABEL).
// Reads paginated daily spend, requests, tokens and model metrics from the gateway.

import {
  providerOf,
  providerColor,
  rangeToDates,
  rangeLabel,
} from '../domain/providers.js';
import { buildUnified, money, contract } from '../domain/shape.js';
import {
  computeBudgetBurndown,
  cumulativeFromDaily,
  localIsoDate,
  monthBounds,
} from '../domain/burndown.js';

import { corporateConfig } from '../config/corporate-config.js';
import { ENTERPRISE, enterpriseEnv } from '../config/enterprise.js';

// TLS is isolated to this provider; personal endpoints always verify certificates.
import { getJson as requestJson } from './http-json.js';
async function getJson(baseUrl, route, token) {
  return requestJson(`${baseUrl.replace(/\/+$/, '')}${route}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    insecure: enterpriseEnv('ENTERPRISE_INSECURE_TLS') === '1',
    timeout: 15000,
    maxBytes: 16 * 1024 * 1024,
  });
}

// Read the monthly budget limit from env (default 300).
function budgetLimit(value) {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? raw : 300;
}

export async function getDashboard({ range }) {
  const config = await corporateConfig();
  const token = config.token;
  if (!token) {
    return {
      error: {
        message:
          'ANTHROPIC_AUTH_TOKEN is not set — cannot reach the enterprise API.',
      },
    };
  }
  const baseUrl = config.baseUrl;
  if (!baseUrl)
    return {
      disabled: true,
      error: {
        message:
          'The enterprise gateway is not configured: set ENTERPRISE_BASE_URL or ANTHROPIC_BASE_URL.',
      },
    };
  if (range === 'rtd')
    return {
      error: {
        message: 'Reset to date is available for personal quotas only.',
      },
    };
  const { start, end } = rangeToDates(range);

  try {
    return await (async () => {
      const activity = await getActivity(baseUrl, start, end, token);
      // Model metrics are supplied by daily activity itself; spend/logs has a
      // different aggregate format on the gateway and is not needed here.

      // 3) Month-to-date failure means unknown budget usage, never zero spend.
      const now = new Date();
      const { monthStart } = monthBounds(now);
      let monthRows = null;
      try {
        const m = await getActivity(baseUrl, localIsoDate(monthStart), localIsoDate(now), token);
        if (!Array.isArray(m?.results))
          throw new Error('Invalid monthly activity');
        monthRows = m.results.map((r) => ({
          date: r?.date,
          spend: r?.metrics?.spend,
        }));
      } catch {
        monthRows = null;
      }

      return mapToUnified({
        activity,
        start,
        end,
        range,
        monthRows,
        now,
        budgetValue: config.budget,
      });
    })();
  } catch (err) {
    // Surface a readable message; the route returns HTTP 200 with {error}.
    return { error: { message: err?.message || 'Enterprise request failed' } };
  }
}

// Pagination can split one day across pages. Merge metrics before persistence.
async function getActivity(baseUrl, start, end, token) {
  const days = new Map();
  const add = (to, from) => {
    for (const [key, value] of Object.entries(from || {})) {
      if (typeof value === 'number' && Number.isFinite(value)) to[key] = (to[key] || 0) + value;
    }
  };
  for (let page = 1; page <= 1000; page++) {
    const response = await getJson(baseUrl,
      `/user/daily/activity?start_date=${start}&end_date=${end}&page_size=100&page=${page}`, token);
    if (!Array.isArray(response?.results)) throw new Error('Invalid corporate activity');
    for (const row of response.results) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !Number.isFinite(row.metrics?.spend))
        throw new Error('Invalid corporate daily metrics');
      if (!days.has(row.date)) days.set(row.date, {date:row.date, metrics:{}, breakdown:{models:{}}});
      const day = days.get(row.date);
      add(day.metrics, row.metrics);
      for (const [model, value] of Object.entries(row.breakdown?.models || {})) {
        const item = day.breakdown.models[model] ||= {metrics:{}};
        add(item.metrics, value.metrics);
      }
    }
    if (!response.metadata?.has_more && !(response.metadata?.total_pages > page)) {
      const results = [...days.values()];
      return {results, metadata:{total_spend:results.reduce((n,r)=>n+r.metrics.spend,0)}};
    }
    if (!response.results.length || (response.metadata?.page != null && response.metadata.page !== page))
      throw new Error('Invalid corporate pagination');
  }
  throw new Error('Corporate pagination limit exceeded');
}

function mapToUnified({activity, start, end, range, monthRows = null, now = new Date(), budgetValue}) {
  const results = activity.results;
  const count = m => Number.isFinite(m.total_tokens) ? m.total_tokens : null;
  const daily = results.map(r => ({date:r.date, spend:money(r.metrics.spend),
    tokens:count(r.metrics), requests:r.metrics.api_requests ?? null,
    models:Object.fromEntries(Object.entries(r.breakdown.models).map(([name, v]) =>
      [name, {tokens:count(v.metrics), cost:v.metrics.spend || 0}]))
  })).sort((a,b)=>a.date.localeCompare(b.date));
  const totalSpend = activity.metadata.total_spend;
  const totalRequests = daily.some(d=>d.requests == null) ? null : daily.reduce((n,d)=>n+d.requests,0);
  const tokens = daily.some(d=>d.tokens == null) ? null : daily.reduce((n,d)=>n+d.tokens,0);
  const perModel = new Map();
  for (const d of daily) for (const [name,m] of Object.entries(d.models)) {
    const item = perModel.get(name) || {model:name, provider:providerOf(name), spend:0, tokens:0};
    item.spend += m.cost;
    item.tokens = item.tokens == null || m.tokens == null ? null : item.tokens + m.tokens;
    perModel.set(name,item);
  }
  const models = [...perModel.values()].map(m=>({...m,spend:money(m.spend)})).sort((a,b)=>b.spend-a.spend);
  const perProvider = new Map();
  for (const m of models) {
    const g = perProvider.get(m.provider) || {key:m.provider,label:m.provider,color:providerColor(m.provider),spend:0,tokens:0};
    g.spend += m.spend; g.tokens = g.tokens == null || m.tokens == null ? null : g.tokens + m.tokens;
    perProvider.set(m.provider,g);
  }
  const groups = [...perProvider.values()];

  // Budget: monthly limit vs month-to-date spend (sum of daily spend this month).
  const limit = budgetLimit(budgetValue);
  const { monthStart, monthEnd } = monthBounds(now);
  const dailyCumulative = cumulativeFromDaily(monthRows || [], monthStart, now);
  const spent = money(
    dailyCumulative.length
      ? dailyCumulative[dailyCumulative.length - 1].cumSpend
      : 0,
  );
  const burndown = computeBudgetBurndown({
    spent,
    limit,
    now,
    monthStart,
    monthEnd,
    dailyCumulative,
  });
  const remaining = money(Math.max(limit - spent, 0));
  const pctRemaining = limit > 0 ? Math.round((remaining / limit) * 100) : 0;

  const out = buildUnified({
    source: ENTERPRISE,
    period: { from: start, to: end, label: rangeLabel(range) },
    capabilities: { tokens: tokens != null, groups: 'provider', budget: true },
    totals: {
      spend: money(totalSpend),
      tokens,
      days: daily.length,
      models: models.length,
      requests: totalRequests,
    },
    daily,
    groups,
    models,
    budget: {
      limit,
      spent,
      remaining,
      pctRemaining,
      currency: 'USD',
      monthStart: localIsoDate(monthStart),
      monthEnd: localIsoDate(monthEnd),
      resetsAt: monthEnd.toISOString(),
    },
    budgetBurndown: burndown,
    updatedAt: new Date().toISOString(),
  });
  for (const day of out.daily) {
    const raw = results.find(r => r.date === day.date);
    day.models = daily.find(d => d.date === day.date).models;
    day.reportedSpend = raw.metrics.spend;
  }
  if (monthRows === null) {
    out.budget = null;
    out.budgetBurndown = null;
    out.warnings = ['Monthly budget usage is unavailable.'];
  }
  out.harnesses = {
    [ENTERPRISE]: {
      subscription: null,
      burndown: null,
      totals: out.totals,
      daily: out.daily,
      models: out.models,
      groups: out.groups,
      byProvider: out.groups,
      budget: out.budget,
      budgetBurndown: out.budgetBurndown,
    },
  };
  out.capabilities = {
    ...out.capabilities,
    harnesses: [ENTERPRISE],
    burndown: false,
    surfaceBreakdown: false,
  };
  return contract(out, range, { from: start, to: end });
}
