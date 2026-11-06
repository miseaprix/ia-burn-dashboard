// Model pricing lookup, ported from agent-burn's `pricing.rs` / `cost.rs`.
// Primary table = built-in prices overridden by live/persisted LiteLLM.
// Fallback = live/persisted models.dev, then its embedded snapshot.
// All prices below are stored in USD PER TOKEN.

import { readFileSync } from 'node:fs';

const M = 1e-6;
const MODEL_DATE_SUFFIX_DIGITS = 8;
const TIER_THRESHOLD = 200_000;
const CACHE_CREATE_1H_INPUT_MULTIPLIER = 2.0;

// Build a Pricing record from per-million-token prices.
function price(input, output, cacheCreate, cacheRead, extra = {}) {
  return {
    input: input * M,
    output: output * M,
    cacheCreate: cacheCreate * M,
    cacheRead: cacheRead * M,
    cacheReadExplicit: true,
    inputAbove200k: extra.inputAbove200k != null ? extra.inputAbove200k * M : null,
    outputAbove200k: extra.outputAbove200k != null ? extra.outputAbove200k * M : null,
    cacheCreateAbove200k: extra.cacheCreateAbove200k != null ? extra.cacheCreateAbove200k * M : null,
    cacheReadAbove200k: extra.cacheReadAbove200k != null ? extra.cacheReadAbove200k * M : null,
    fastMultiplier: extra.fast ?? 1.0,
  };
}

// Built-in table (agent-burn `put_builtin_pricing`), fast multipliers from
// `fast-multiplier-overrides.json`.
const opus5 = (fast = 1.0) => price(5, 25, 6.25, 0.5, { fast });
const gpt51 = price(1.25, 10, 1.25, 0.125);
const gpt52 = price(1.75, 14, 1.75, 0.175);
const haiku35 = price(0.8, 4, 1.0, 0.08);

const BUILTIN = new Map([
  ['claude-opus-4-5', opus5()],
  ['claude-opus-4-6', opus5(6.0)],
  ['claude-opus-4-7', opus5(6.0)],
  ['claude-opus-4-8', opus5(2.0)],
  ['claude-haiku-4-5', price(1, 5, 1.25, 0.1)],
  ['claude-opus-4', price(15, 75, 18.75, 1.5)],
  ['claude-sonnet-4-6', price(3, 15, 3.75, 0.3)],
  [
    'claude-sonnet-4',
    price(3, 15, 3.75, 0.3, {
      inputAbove200k: 6,
      outputAbove200k: 22.5,
      cacheCreateAbove200k: 7.5,
      cacheReadAbove200k: 0.6,
    }),
  ],
  ['claude-3-5-haiku', haiku35],
  ['claude-3-5-haiku-20241022', haiku35],
  ['claude-3-opus', price(15, 75, 18.75, 1.5)],
  ['claude-3-sonnet', price(3, 15, 3.75, 0.3)],
  ['claude-3-haiku', price(0.25, 1.25, 0.3, 0.03)],
  ['gpt-5', price(1.25, 10, 1.25, 0.125)],
  ['gpt-5.5', price(5, 30, 5, 0.5, { fast: 2.5 })],
  ['gpt-5.1', gpt51],
  ['gpt-5.1-codex', gpt51],
  ['gpt-5.2', gpt52],
  ['gpt-5.2-codex', gpt52],
  ['gpt-5.3-codex', price(1.75, 14, 1.75, 0.175, { fast: 2.0 })],
  ['gpt-5.4', price(2.5, 15, 2.5, 0.25, { fast: 2.0 })],
  ['gpt-5.4-mini', price(0.75, 4.5, 0.75, 0.075)],
  ['gpt-5.4-nano', price(0.2, 1.25, 0.2, 0.02)],
]);

// Codex log labels that upstream pricing sources do not publish.
const ALIASES = { 'gpt-5.3-spark': 'gpt-5.3-codex-spark' };

// models.dev snapshot -> Pricing records (only models absent from BUILTIN).
function loadModelsDev() {
  const map = new Map();
  try {
    const raw = JSON.parse(
      readFileSync(new URL('../data/models-dev-pricing.json', import.meta.url), 'utf8'),
    );
    for (const [key, model] of Object.entries(raw)) {
      const id = model?.id || key;
      const cost = model?.cost;
      if (!cost || typeof cost.input !== 'number' || typeof cost.output !== 'number') continue;
      if (BUILTIN.has(id) || map.has(id)) continue;
      const input = cost.input * M;
      map.set(id, {
        input,
        output: cost.output * M,
        cacheCreate: typeof cost.cache_write === 'number' ? cost.cache_write * M : input * 1.25,
        cacheRead: typeof cost.cache_read === 'number' ? cost.cache_read * M : input * 0.1,
        cacheReadExplicit: typeof cost.cache_read === 'number',
        inputAbove200k: null,
        outputAbove200k: null,
        cacheCreateAbove200k: null,
        cacheReadAbove200k: null,
        fastMultiplier: 1.0,
      });
    }
  } catch {
    // Snapshot unreadable: fall back to the built-in table only.
  }
  return map;
}

const MODELS_DEV = loadModelsDev();

const isAlnum = (ch) => /[A-Za-z0-9]/.test(ch);
const isBoundary = (ch) => !isAlnum(ch);

function normalizedKey(value) {
  return /[.@]/.test(value) ? value.replace(/[.@]/g, '-') : value;
}

// True when `suffix` starts a numeric version continuation (but not an 8-digit date).
function suffixStartsWithNumericVersion(key, suffix) {
  if (!/\d$/.test(key)) return false;
  if (suffix[0] !== '-' && suffix[0] !== '.') return false;
  const rest = suffix.slice(1);
  const digits = /^\d*/.exec(rest)[0].length;
  if (digits === 0) return false;
  const after = rest[digits];
  return !(digits === MODEL_DATE_SUFFIX_DIGITS && (after === undefined || isBoundary(after)));
}

function suffixAllowsMatch(key, suffix) {
  if (suffix.length === 0) return true;
  if (!isBoundary(suffix[0])) return false;
  return !suffixStartsWithNumericVersion(key, suffix);
}

// Find `key` inside `value` only on non-alphanumeric boundaries.
function containsKey(value, key) {
  if (!key) return false;
  let from = 0;
  for (;;) {
    const idx = value.indexOf(key, from);
    if (idx === -1) return false;
    const before = idx === 0 ? undefined : value[idx - 1];
    if ((before === undefined || isBoundary(before)) && suffixAllowsMatch(key, value.slice(idx + key.length))) {
      return true;
    }
    from = idx + 1;
  }
}

function keyMatches(candidate, model, normalizedModel) {
  if (containsKey(model, candidate) || containsKey(candidate, model)) return true;
  const normalizedCandidate = normalizedKey(candidate);
  return (
    containsKey(normalizedModel, normalizedCandidate) ||
    containsKey(normalizedCandidate, normalizedModel)
  );
}

function findEntry(table, model) {
  const exact = table.get(model);
  if (exact) return exact;
  const normalizedModel = normalizedKey(model);
  let bestKey = null;
  for (const candidate of table.keys()) {
    if (!keyMatches(candidate, model, normalizedModel)) continue;
    // Longest key wins; ties go to the lexicographically smaller key.
    if (
      bestKey === null ||
      candidate.length > bestKey.length ||
      (candidate.length === bestKey.length && candidate < bestKey)
    ) {
      bestKey = candidate;
    }
  }
  return bestKey === null ? null : table.get(bestKey);
}

function findEntryOrAlias(table, model) {
  return findEntry(table, model) || (ALIASES[model] ? findEntry(table, ALIASES[model]) : null);
}

let primaryCatalog = new Map(BUILTIN);
let remoteModelsDev = new Map();
const cache = new Map();
const rate = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

// Catalog prices are USD per token for LiteLLM, per million for models.dev.
export function parsePriceCatalog(raw, source) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = {};
  const entries = source === 'modelsdev'
    ? Object.entries(raw).sort(([a], [b]) =>
      Number(['anthropic', 'openai'].includes(b)) - Number(['anthropic', 'openai'].includes(a)))
      .flatMap(([, provider]) => Object.entries(provider?.models || {}))
    : Object.entries(raw);
  for (const [key, value] of entries) {
    if (key === 'sample_spec') continue;
    const model = source === 'modelsdev' ? value?.id || key : key;
    if (Object.hasOwn(result, model)) continue;
    const c = source === 'modelsdev' ? value?.cost : value;
    const factor = source === 'modelsdev' ? M : 1;
    const input = source === 'modelsdev' ? c?.input : c?.input_cost_per_token;
    const output = source === 'modelsdev' ? c?.output : c?.output_cost_per_token;
    if (!rate(input) || !rate(output)) continue;
    const read = source === 'modelsdev' ? c.cache_read : c.cache_read_input_token_cost;
    const write = source === 'modelsdev' ? c.cache_write : c.cache_creation_input_token_cost;
    const optional = key => rate(c[key]) ? c[key] * factor : null;
    result[model] = {
      input: input * factor, output: output * factor,
      cacheCreate: rate(write) ? write * factor : input * factor * 1.25,
      cacheRead: rate(read) ? read * factor : input * factor * 0.1,
      cacheReadExplicit: rate(read),
      inputAbove200k: optional('input_cost_per_token_above_200k_tokens'),
      outputAbove200k: optional('output_cost_per_token_above_200k_tokens'),
      cacheCreateAbove200k: optional('cache_creation_input_token_cost_above_200k_tokens'),
      cacheReadAbove200k: optional('cache_read_input_token_cost_above_200k_tokens'),
      fastMultiplier: rate(c.provider_specific_entry?.fast) && c.provider_specific_entry.fast > 0
        ? c.provider_specific_entry.fast : BUILTIN.get(model)?.fastMultiplier || 1,
    };
  }
  return result;
}

export function setPriceCatalogs({ litellm = {}, modelsdev = {} } = {}) {
  primaryCatalog = new Map([...BUILTIN, ...Object.entries(litellm)]);
  remoteModelsDev = new Map(Object.entries(modelsdev));
  cache.clear();
}

// Resolve the Pricing record of a model id, or null when unknown.
export function findPricing(model) {
  if (typeof model !== 'string' || !model) return null;
  if (cache.has(model)) return cache.get(model);
  // Live/cached LiteLLM overrides embedded tariffs, as in agent-burn.
  const found = findEntryOrAlias(primaryCatalog, model) || findEntryOrAlias(remoteModelsDev, model)
    || findEntryOrAlias(MODELS_DEV, model) || null;
  cache.set(model, found);
  return found;
}

function tieredCost(tokens, base, above) {
  if (!tokens) return 0;
  if (above != null && tokens > TIER_THRESHOLD) {
    return TIER_THRESHOLD * base + (tokens - TIER_THRESHOLD) * above;
  }
  return tokens * base;
}

// Cost of one Claude usage block computed from tokens (cost.rs `calculate_cost_from_tokens`).
// `usage` is the raw `message.usage` object.
export function claudeCostFromTokens(model, usage) {
  const p = findPricing(model);
  if (!p) return null;
  const multiplier = usage.speed === 'fast' ? p.fastMultiplier : 1.0;
  let cc5m;
  let cc1h;
  if (usage.cache_creation && typeof usage.cache_creation === 'object') {
    cc5m = Number(usage.cache_creation.ephemeral_5m_input_tokens) || 0;
    cc1h = Number(usage.cache_creation.ephemeral_1h_input_tokens) || 0;
  } else {
    cc5m = Number(usage.cache_creation_input_tokens) || 0;
    cc1h = 0;
  }
  const cc1hCost = p.input * CACHE_CREATE_1H_INPUT_MULTIPLIER;
  const cc1hAbove =
    p.inputAbove200k != null ? p.inputAbove200k * CACHE_CREATE_1H_INPUT_MULTIPLIER : null;
  return (
    (tieredCost(usage.input_tokens, p.input, p.inputAbove200k) +
      tieredCost(usage.output_tokens, p.output, p.outputAbove200k) +
      tieredCost(cc5m, p.cacheCreate, p.cacheCreateAbove200k) +
      tieredCost(cc1h, cc1hCost, cc1hAbove) +
      tieredCost(usage.cache_read_input_tokens, p.cacheRead, p.cacheReadAbove200k)) *
    multiplier
  );
}

// Cost of one Codex model bucket (report.rs `calculate_codex_model_cost`, standard speed).
export function codexModelCost(model, usage) {
  const p = findPricing(model);
  if (!p) return null;
  const nonCached = Math.max(0, usage.input - usage.cached);
  const cacheRate = p.cacheReadExplicit ? p.cacheRead : p.input;
  return nonCached * p.input + usage.cached * cacheRate + usage.output * p.output;
}

// Allocate only computed token costs. Reported totals do not imply a known mix.
export function claudeTokenCosts(model, usage) {
  const base = { input_tokens: 0, output_tokens: 0, speed: usage.speed };
  return {
    input: claudeCostFromTokens(model, { ...base, input_tokens: usage.input_tokens }),
    output: claudeCostFromTokens(model, { ...base, output_tokens: usage.output_tokens }),
    cacheWrite: claudeCostFromTokens(model, { ...base,
      cache_creation: usage.cache_creation, cache_creation_input_tokens: usage.cache_creation_input_tokens }),
    cacheRead: claudeCostFromTokens(model, { ...base, cache_read_input_tokens: usage.cache_read_input_tokens }),
  };
}
export function codexTokenCosts(model, usage) {
  const p = findPricing(model);
  return p ? { input: Math.max(0, usage.input - usage.cached) * p.input,
    output: usage.output * p.output,
    cacheWrite: 0, cacheRead: usage.cached * (p.cacheReadExplicit ? p.cacheRead : p.input) }
    : { input: null, output: null, cacheWrite: 0, cacheRead: null };
}
