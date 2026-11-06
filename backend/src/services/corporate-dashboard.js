import { stateStore } from '../storage/state-store.js';
import { corporateDataset } from '../config/datasets.js';
import { rangeToDates, rangeLabel, providerOf, providerColor } from '../domain/providers.js';
import { buildUnified, contract, money } from '../domain/shape.js';
export async function getDashboard({ range, from, to }) {
  if (range === 'rtd') return { error: { message: 'Reset to date is available for personal quotas only.' } };
  const bounds = rangeToDates(range);
  const start = range === 'custom' ? from : bounds.start;
  const end = range === 'custom' ? to : bounds.end;
  const store = stateStore(), state = store.collection('enterprise');
  const dataset = await corporateDataset();
  const rows = store.dailyRows(dataset, start, end);
  if (!rows.length && !state?.lastSuccess || (!rows.length && state?.value?.dataset !== dataset))
    return { error: { message: 'Corporate data is not available yet. Check collection status and VPN/DNS.' } };
  const snapshot = state?.value?.dataset === dataset ? state.value : null;
  const current = start <= bounds.end && end >= bounds.end;
  const perModel = new Map();
  for (const r of rows) for (const [name,m] of r.models) {
    const item = perModel.get(name) || {model:name,provider:providerOf(name),spend:0,tokens:0};
    item.spend += m.cost; item.tokens += m.tokens;
    perModel.set(name,item);
  }
  const models = [...perModel.values()].map(m=>({...m,spend:money(m.spend)})).sort((a,b)=>b.spend-a.spend);
  const providers = new Map();
  for (const m of models) {
    const g = providers.get(m.provider) || {key:m.provider,label:m.provider,color:providerColor(m.provider),spend:0,tokens:0};
    g.spend += m.spend; g.tokens += m.tokens; providers.set(m.provider,g);
  }
  const hasTokens = rows.length > 0 && rows.every(r=>r.tokens != null);
  const totals = { spend: money(rows.reduce((n,r) => n + r.cost, 0)), tokens: hasTokens ? rows.reduce((n,r)=>n+r.tokens,0) : null,
    days: rows.length, models: models.length,
    requests: rows.some(r => r.requests == null) ? null : rows.reduce((n,r) => n + r.requests, 0) };
  const result = buildUnified({ source: 'enterprise', totals,
    period: { from: start, to: end, label: rangeLabel(range) },
    capabilities: { tokens: hasTokens, groups: 'provider', budget: true },
    daily: rows.map(r => ({date: r.period, spend: money(r.cost), tokens: r.tokens, requests: r.requests})),
    models, groups: [...providers.values()],
    budget: current ? snapshot?.budget : null,
    budgetBurndown: current ? snapshot?.budgetBurndown : null });
  for (const day of result.daily) {
    const row = rows.find(r => r.period === day.date);
    day.byModel = Object.fromEntries([...row.models].map(([name,m]) => [name,m.cost]));
  }
  result.harnesses = { enterprise: {totals: {...totals}, daily: result.daily, models: result.models,
    groups: result.groups, subscription: null, budget: result.budget, budgetBurndown: result.budgetBurndown} };
  result.warnings = [...(current ? snapshot?.warnings || [] : []),
    ...(rows.some(r=>!r.models.size && r.cost > 0) ? ['Model breakdown is unavailable for some stored days.'] : [])];
  result.yearlyHistory = {source: 'enterprise', basis: 'observed API daily activity', years: store.yearly(await corporateDataset())};
  return contract(result, range, {from: range === 'all' ? rows[0]?.period ?? null : start, to: end});
}
