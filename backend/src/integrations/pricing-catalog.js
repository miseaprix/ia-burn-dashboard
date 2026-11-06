import { getJson } from './http-json.js';
import { stateStore } from '../storage/state-store.js';
import { parsePriceCatalog, setPriceCatalogs } from '../domain/pricing.js';

export const PRICE_SOURCES = {
  litellm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
  modelsdev: 'https://models.dev/api.json',
};

// Runs in ingestion, never on dashboard reads. Each source retains its last
// valid snapshot independently. SQLite restores it before any network attempt.
export class PricingCatalog {
  constructor({ store = stateStore, request = getJson, now = Date.now,
    refreshMs = Number(process.env.PRICING_REFRESH_MS) || 21600000 } = {}) {
    this.store = store;
    this.request = request;
    this.now = now;
    this.refreshMs = Math.max(60000, refreshMs);
    this.pending = null;
  }
  refresh() {
    if (this.pending) return this.pending;
    this.pending = this.load().finally(() => { this.pending = null; });
    return this.pending;
  }
  async load() {
    const snapshots = {};
    for (const source of Object.keys(PRICE_SOURCES))
      snapshots[source] = this.store().collection(`pricing:${source}`);
    setPriceCatalogs(Object.fromEntries(Object.entries(snapshots)
      .map(([source, saved]) => [source, saved?.value || {}])));
    await Promise.all(Object.entries(PRICE_SOURCES).map(async ([source, url]) => {
      const saved = snapshots[source];
      if (saved?.nextAttempt > this.now()) return;
      this.store().saveCollection(`pricing:${source}`, { lastAttempt: this.now() });
      try {
        const raw = await this.request(url, { timeout: 8000, maxBytes: 16 * 1024 * 1024 });
        const value = parsePriceCatalog(raw, source);
        if (!Object.keys(value).length) throw new Error('Empty pricing catalog');
        this.store().saveCollection(`pricing:${source}`, { value, lastSuccess: this.now(),
          nextAttempt: this.now() + this.refreshMs, error: null });
      } catch {
        this.store().saveCollection(`pricing:${source}`, {
          nextAttempt: this.now() + 900000,
          error: 'Pricing refresh unavailable; retaining previous tariffs.',
        });
      }
    }));
    setPriceCatalogs(Object.fromEntries(Object.keys(PRICE_SOURCES)
      .map(source => [source, this.store().collection(`pricing:${source}`)?.value || {}])));
  }
}

const catalog = new PricingCatalog();
export const refreshPricing = () => catalog.refresh();

export function pricingStatus() {
  return Object.fromEntries(Object.entries(PRICE_SOURCES).map(([source, url]) => {
    const saved = stateStore().collection(`pricing:${source}`);
    return [source, { url, lastSuccess: saved?.lastSuccess ?? null,
      nextAttempt: saved?.nextAttempt ?? null, error: saved?.error ?? null,
      models: Object.keys(saved?.value || {}).length }];
  }));
}
