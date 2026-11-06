import { readSettings } from '../config/admin-settings.js';
import { stateStore } from '../storage/state-store.js';
import { collectLocal } from '../integrations/local.js';
import { refreshPricing } from '../integrations/pricing-catalog.js';
import { getPersonal } from '../integrations/personal.js';
import { getDashboard as fetchCorporate } from '../integrations/enterprise.js';
import { corporateConfig } from '../config/corporate-config.js';
import { ENTERPRISE, ENTERPRISE_LOCAL } from '../config/enterprise.js';
import { corporateDataset } from '../config/datasets.js';

function interval(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1000 ? n : fallback;
}
// A single scheduler owns ingestion; dashboard reads never start collection.
export class Collector {
  constructor({ store = stateStore, tasks, now = Date.now, intervals } = {}) {
    this.store = store;
    this.now = now;
    this.intervals = intervals || {
      local: interval(process.env.LOCAL_COLLECT_MS, 60000),
      [ENTERPRISE_LOCAL]: interval(process.env.LOCAL_COLLECT_MS, 60000),
      personal: interval(process.env.QUOTA_COLLECT_MS, 60000),
      [ENTERPRISE]: interval(process.env.CORPORATE_COLLECT_MS, 300000),
    };
    this.customIntervals = !!intervals;
    this.applySettings();
    this.tasks = tasks || {
      local: async () => { await refreshPricing(); return collectLocal(); },
      [ENTERPRISE_LOCAL]: async () => { await refreshPricing(); return collectLocal(ENTERPRISE_LOCAL); },
      personal: getPersonal,
      [ENTERPRISE]: async () => {
        // Without a gateway base URL the enterprise source is disabled, not failing.
        if (!(await corporateConfig()).baseUrl) return { disabled: true };
        // Reconcile recent days and month budget, including month boundaries.
        const recent = await fetchCorporate({ range: 'month' });
        if (recent.error) throw new Error('Corporate collection unavailable');
        recent.dataset = await corporateDataset();
        this.store().saveDaily(recent.dataset, recent.daily.map(d => ({
          period: d.date, agent: ENTERPRISE, tokens: d.tokens, cost: d.reportedSpend ?? d.spend, requests: d.requests,
          models: new Map(Object.entries(d.models || {}).map(([name,m]) => [name,{...m,tokens:m.tokens ?? 0}])),
        })));
        return recent;
      },
    };
    this.pending = new Map();
    this.failures = new Map();
    this.stopped = true;
    this.timers = new Map();
  }
  applySettings() {
    if (this.customIntervals) return;
    const settings = readSettings();
    this.intervals.local = this.intervals[ENTERPRISE_LOCAL] = (settings.localSeconds ?? interval(process.env.LOCAL_COLLECT_MS,60000)/1000)*1000;
    this.intervals.personal = (settings.quotaSeconds ?? interval(process.env.QUOTA_COLLECT_MS,60000)/1000)*1000;
    this.intervals[ENTERPRISE] = (settings.corporateSeconds ?? interval(process.env.CORPORATE_COLLECT_MS,300000)/1000)*1000;
  }
  async reconfigure() {
    const running = !this.stopped;
    await this.stop();
    this.applySettings();
    if (running) this.start();
  }
  run(source, force = false) {
    if (!this.tasks[source]) return Promise.reject(new Error('Unknown collector'));
    if (this.pending.has(source)) return this.pending.get(source);
    const previous = this.store().collection(source);
    if (!force && previous?.nextAttempt > this.now()) return Promise.resolve(previous);
    const task = (async () => {
      this.store().saveCollection(source, { lastAttempt: this.now() });
      try {
        const value = await this.tasks[source]();
        this.failures.set(source, 0);
        this.store().saveCollection(source, { value, lastSuccess: this.now(),
          nextAttempt: this.now() + this.intervals[source], error: null });
      } catch {
        const failures = (this.failures.get(source) || 0) + 1;
        this.failures.set(source, failures);
        this.store().saveCollection(source, { error: 'Collection unavailable; retaining previous data.',
          nextAttempt: this.now() + Math.min(900000, this.intervals[source] * 2 ** Math.min(failures - 1, 4)) });
      }
      return this.store().collection(source);
    })().finally(() => this.pending.delete(source));
    this.pending.set(source, task);
    return task;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async (source, force = false) => {
      try { await this.run(source, force); } catch {}
      if (!this.stopped) {
        let next;
        try { next = this.store().collection(source)?.nextAttempt; } catch {}
        const delay = Math.max(1000, (next || this.now() + this.intervals[source]) - this.now());
        const timer = setTimeout(() => tick(source), delay);
        timer.unref();
        this.timers.set(source, timer);
      }
    };
    // Independent per-source loops: a slow vendor cannot delay log ingestion.
    for (const source of Object.keys(this.tasks)) tick(source, true);
  }
  async stop() {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    await Promise.allSettled([...this.pending.values()]);
  }
  status(source) {
    const state = this.store().collection(source);
    return { lastSuccess: state?.lastSuccess ?? null, lastAttempt: state?.lastAttempt ?? null,
      nextAttempt: state?.nextAttempt ?? null, error: state?.error ?? null,
      running: this.pending.has(source), intervalMs: this.intervals[source] };
  }
}
