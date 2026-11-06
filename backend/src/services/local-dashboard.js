import { stateStore } from '../storage/state-store.js';
import { historyDataset } from '../config/datasets.js';
import { harnessColor, providerOf, rangeToDates, rangeLabel } from '../domain/providers.js';
import { buildUnified, money, contract } from '../domain/shape.js';
import { usageEconomics, usageDetails } from '../domain/usage-economics.js';
export function getYearlyHistory(source = 'local') {
  return { source, basis: 'observed local logs', years: stateStore().yearly(historyDataset(source)) };
}
const inRange = (date, start, end) => !start || (date >= start && date <= end);
// ------------------------------------------------------------------ summary

function costCoverage(value) {
  return { costComplete: !(value.unknownTokens > 0), unknownTokens: value.unknownTokens || 0 };
}

// Collapse per-day/per-agent rows into totals, agents, models and days (Summary::from_rows).
function summarize(rows) {
  let totalCost = 0;
  let totalTokens = 0, unknownTokens = 0;
  const days = new Map();
  const agents = new Map();
  const models = new Map();
  for (const row of rows) {
    totalCost += row.cost;
    totalTokens += row.tokens;
    unknownTokens += row.unknownTokens || 0;
    const day = days.get(row.period) || {
      date: row.period,
      cost: 0,
      unknownTokens: 0,
      tokens: 0,
    };
    day.cost += row.cost;
    day.unknownTokens += row.unknownTokens || 0;
    day.tokens += row.tokens;
    days.set(row.period, day);

    const agent = agents.get(row.agent) || {
      agent: row.agent,
      cost: 0,
      unknownTokens: 0,
      tokens: 0,
    };
    agent.cost += row.cost;
    agent.unknownTokens += row.unknownTokens || 0;
    agent.tokens += row.tokens;
    agents.set(row.agent, agent);

    for (const [name, m] of row.models) {
      const model = models.get(name) || { model: name, cost: 0, tokens: 0, unknownTokens: 0 };
      model.cost += m.cost;
      model.unknownTokens += m.unknownTokens || 0;
      model.tokens += m.tokens;
      models.set(name, model);
    }
  }
  const byCost = (a, b) => b.cost - a.cost || b.tokens - a.tokens;
  return {
    totalCost,
    totalTokens,
    unknownTokens,
    days: [...days.values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    ),
    agents: [...agents.values()].sort(byCost),
    models: [...models.values()].sort(byCost),
  };
}

export async function getDashboard({ range, from: customFrom, to: customTo, source = 'local' }) {
  try {
    let { start, end } = rangeToDates(range);
    const filtered = range !== 'all';
    if (range === 'custom') { start = customFrom; end = customTo; }

    const allRows = stateStore().dailyRows(historyDataset(source));
    const personal = structuredClone((source === 'local' ? stateStore().collection('personal')?.value : null) || {
      claude: { burndown: null }, codex: { burndown: null },
    });
    if (personal.codex.surfaceStatus?.observedAt)
      personal.codex.surfaceStatus.stale = !!personal.codex.surfaceBreakdown &&
        (Date.now() - Date.parse(personal.codex.surfaceStatus.observedAt) > 90000 ||
          !!personal.codex.surfaceStatus.error);
    if (personal.codex.surfaceStatus?.observedAt &&
      Date.now() - Date.parse(personal.codex.surfaceStatus.observedAt) > 900000) {
      personal.codex.surfaceBreakdown = null;
      personal.codex.surfaceStatus.unavailable = true;
    }
    for (const harness of Object.values(personal)) {
      if (harness.burndown) {
        const age = Date.now() - Date.parse(harness.burndown.observedAt);
        harness.burndown.fresh = age <= 90000;
        harness.burndown.stale = age > 90000;
        if (age > 900000) harness.burndown = null;
      }
    }
    const cycleStarts = Object.values(personal)
      .map((h) => h.burndown?.weekly?.start)
      .filter(Boolean)
      .sort();
    if (range === 'rtd') {
      ({ start, end } = rangeToDates(range, new Date(), cycleStarts[0]));
      if (!start)
        return {
          error: { message: 'Reset to date requires a current quota reading.' },
        };
    }
    if (end < rangeToDates('today').end) {
      for (const harness of Object.values(personal)) {
        harness.burndown = null;
        harness.surfaceBreakdown = null;
      }
    }
    // Day-level range filter; rows without any token are dropped (summary_rows).
    const rows = allRows.filter(
      (r) => r.tokens > 0 && (!filtered || inRange(r.period, start, end)),
    );
    const s = summarize(rows);

    const daily = s.days.map((d) => ({
      date: d.date,
      spend: money(d.cost),
      ...costCoverage(d),
      tokens: d.tokens,
    }));
    const groups = s.agents.map((a) => ({
      key: a.agent,
      label: ({claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode'})[a.agent] || a.agent,
      color: harnessColor(a.agent),
      spend: money(a.cost),
      ...costCoverage(a),
      tokens: a.tokens,
    }));
    const models = s.models.map((m) => ({
      model: m.model,
      provider: providerOf(m.model),
      spend: m.unknownTokens > 0 ? null : money(m.cost),
      knownSpend: money(m.cost),
      ...costCoverage(m),
      tokens: m.tokens,
      share: s.totalCost > 0 ? (m.cost / s.totalCost) * 100 : 0,
    }));

    const from = filtered ? start : (daily[0]?.date ?? null);
    const to = filtered ? end : (daily[daily.length - 1]?.date ?? null);

    const result = buildUnified({
      source,
      period: { from, to, label: rangeLabel(range) },
      capabilities: { tokens: true, groups: 'harness', budget: false },
      totals: {
        spend: money(s.totalCost),
        ...costCoverage(s),
        tokens: s.totalTokens,
        days: daily.length,
        models: models.length,
        requests: null,
      },
      daily,
      groups,
      models,
      budget: null,
      updatedAt: new Date().toISOString(),
    });
    if (s.unknownTokens > 0) result.warnings = [
      'Spend is incomplete: models without pricing are excluded from spend charts and totals. Token counts include all usage.'
    ];
    for (const day of result.daily) {
      day.byGroup = Object.fromEntries(
        rows
          .filter((r) => r.period === day.date)
          .map((r) => [r.agent, money(r.cost)]),
      );
    }
    result.harnesses = {};
    for (const key of (source === 'enterprise-local' ? ['claude', 'codex', 'opencode'] : ['claude', 'codex'])) {
      const summary = summarize(rows.filter((r) => r.agent === key));
      result.harnesses[key] = {
        ...personal[key],
        totals: {
          spend: money(summary.totalCost),
          ...costCoverage(summary),
          tokens: summary.totalTokens,
          days: summary.days.length,
          models: summary.models.length,
          requests: null,
        },
        daily: summary.days.map((d) => ({
          date: d.date,
          spend: money(d.cost),
          ...costCoverage(d),
          tokens: d.tokens,
          byGroup: { [key]: money(d.cost) },
        })),
        groups: groups.filter((g) => g.key === key),
        tokenBreakdown: Object.fromEntries(
          ['input', 'output', 'cacheWrite', 'cacheRead'].map((k) => [
            k,
            rows
              .filter((r) => r.agent === key)
              .reduce((n, r) => n + (r.breakdown?.[k] || 0), 0),
          ]),
        ),
        models: summary.models.map((m) => ({
          model: m.model,
          provider: providerOf(m.model),
          spend: m.unknownTokens > 0 ? null : money(m.cost),
          knownSpend: money(m.cost),
          ...costCoverage(m),
          tokens: m.tokens,
          share: summary.totalCost > 0 ? (m.cost / summary.totalCost) * 100 : 0,
        })),
      };
    }
    for (const [key, harness] of Object.entries(result.harnesses)) {
      const economics = usageEconomics(
        allRows.filter((r) => r.agent === key),
        harness.subscription,
        harness.burndown,
      );
      harness.economics = economics;
      harness.usageDetails = usageDetails(
        allRows.filter(r => r.agent === key), key);
      if (harness.burndown) harness.burndown.economics = economics;
      harness.subscription = {
        ...harness.subscription,
        valueMultiple: economics.valueMultiple,
      };
    }
    if (source === 'enterprise-local') {
      result.subscriptions = [];
      result.footnote = 'Observed enterprise usage on this workstation. Costs are API-equivalent estimates, not the corporate invoice or total key usage.';
      for (const h of Object.values(result.harnesses)) { delete h.subscription; delete h.economics; }
    }
    result.yearlyHistory = getYearlyHistory(source);
    result.capabilities = {
      ...result.capabilities,
      harnesses: Object.keys(result.harnesses),
      burndown: Object.values(personal).some((h) => h.burndown),
      liveClaude: personal.claude.burndown?.source === 'live',
      liveCodex: personal.codex.burndown?.source === 'live',
      surfaceBreakdown: !!personal.codex.surfaceBreakdown,
    };
    return contract(result, range, {
      from: filtered ? start : (daily[0]?.date ?? null),
      to: end,
    });
  } catch (e) {
    return {
      error: { message: `Historical metrics are unavailable` },
    };
  }
}
