import { pricingStatus } from '../integrations/pricing-catalog.js';
import * as local from '../services/local-dashboard.js';
import * as corporate from '../services/corporate-dashboard.js';
import { periodRequest } from '../domain/period.js';
import { rangeToDates } from '../domain/providers.js';
import { corporateDataset } from '../config/datasets.js';
import { stateStore } from '../storage/state-store.js';
import { corporateConfig } from '../config/corporate-config.js';
import { ENTERPRISE, ENTERPRISE_LOCAL, enterpriseLabel, normalizeSource } from '../config/enterprise.js';

export async function dashboardRoutes(app, { collector }) {
  app.get('/api/pricing/status', async () => pricingStatus());
  app.get('/api/health', async () => ({ok: true}));
  // Public display configuration: never exposes the key or the gateway URL.
  app.get('/api/config', async () => ({enterprise: {label: enterpriseLabel(), enabled: !!(await corporateConfig()).baseUrl}}));
  app.get('/api/collection/status', async () => Object.fromEntries(
    ['local', 'personal', ENTERPRISE, ENTERPRISE_LOCAL].map(s => [s, collector.status(s)])));
  app.get('/api/history/yearly', async (request, reply) => {
    try {
      const requested = normalizeSource(request.query.source);
      return requested === ENTERPRISE
        ? {source: ENTERPRISE, basis: 'observed API daily activity', years: stateStore().yearly(await corporateDataset())}
        : local.getYearlyHistory(requested === ENTERPRISE_LOCAL ? ENTERPRISE_LOCAL : 'local');
    } catch {
      return reply.code(503).send({error: {message: 'Historical database is unavailable'}});
    }
  });
  app.get('/api/dashboard', async (request, reply) => {
    const requested = normalizeSource(request.query.source);
    const source = [ENTERPRISE, ENTERPRISE_LOCAL].includes(requested) ? requested : 'local';
    let period;
    try { period = periodRequest(request.query); }
    catch (error) { return reply.code(400).send({error: {message: error.message}}); }
    try {
      const result = await (source === ENTERPRISE ? corporate : local).getDashboard({...period, source});
      const today = rangeToDates('today').end;
      const nextDay = new Date();
      nextDay.setHours(24,0,0,0);
      const includesToday = !result.error && result.requested?.from <= today && result.requested?.to >= today;
      result.refresh = {includesToday, intervalMs: includesToday ? 60000 : null,
        relative: period.range !== 'custom', today, nextBoundary: nextDay.toISOString()};
      result.collection = {usage: collector.status(source),
        ...(source === 'local' ? {quotas: collector.status('personal')} : {})};
      if (!result.error) {
        result.coverage = {observedDays: result.daily.length, firstDay: result.daily[0]?.date ?? null,
          lastDay: result.daily.at(-1)?.date ?? null, basis: 'observed data; completeness is not guaranteed'};
        const status = result.collection.usage;
        if (status.error || !status.lastSuccess || Date.now() - status.lastSuccess > status.intervalMs * 2)
          result.warnings = [...(result.warnings || []), 'Collection is delayed or unavailable. Showing recorded metrics.'];
      }
      return result;
    } catch {
      return reply.code(503).send({error: {message: 'Historical metrics are unavailable'}});
    }
  });
}
