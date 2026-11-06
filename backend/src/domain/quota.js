import { consistentQuotaSamples } from './quota-history.js';
// Quota percentages are vendor readings, never inferred from token costs.
export function quotaWindow(raw, observedAt, now = Date.now(), history = []) {
  if (
    !raw ||
    typeof raw.usedPercent !== 'number' ||
    !Number.isFinite(raw.usedPercent)
  )
    return null;
  // Claude reports zero usage with no reset while the session is inactive.
  // Keep this explicit vendor state separate from missing or expired readings.
  if (raw.state === 'idle' && raw.usedPercent === 0 && raw.windowMinutes === 300 &&
      raw.resetsAt == null && Number.isFinite(Date.parse(observedAt)) && now >= Date.parse(observedAt))
    return { state: 'idle', windowMinutes: 300, usedPercent: 0,
      remainingPercent: 100, resetsAt: null, samples: [], forecast: null };
  let used = raw.usedPercent;
  const minutes = raw.windowMinutes;
  const reset = Date.parse(raw.resetsAt),
    duration = minutes * 60000,
    start = reset - duration;
  let observed = Date.parse(observedAt);
  if (
    used < 0 ||
    used > 100 ||
    !(duration > 0) ||
    !Number.isFinite(reset) ||
    !Number.isFinite(observed) ||
    !Number.isFinite(minutes) ||
    observed < start ||
    observed >= reset ||
    now >= reset ||
    now < observed
  )
    return null;
  const current = {
    t: observedAt,
    remaining: 100 - used,
    windowMinutes: minutes,
    resetsAt: raw.resetsAt,
  };
  const consistent = consistentQuotaSamples([
    ...history.filter(
      (s) =>
        s.windowMinutes === minutes &&
        Date.parse(s.t) <= observed &&
        Date.parse(s.t) >= start &&
        Math.abs(Date.parse(s.resetsAt) - reset) <= 300000,
    ),
    current,
  ]);
  const last = consistent.at(-1);
  if (!last) return null;
  used = 100 - last.remaining;
  observed = Date.parse(last.t);
  const remaining = 100 - used,
    elapsed = (observed - start) / duration;
  const ideal = 100 * (1 - elapsed),
    paceDelta = remaining - ideal;
  const projectedUse = elapsed > 0 && used > 0 ? used / elapsed : null;
  const projectedEnd =
    projectedUse > 100 ? start + (duration * 100) / projectedUse : reset;
  return {
    windowMinutes: minutes,
    usedPercent: used,
    remainingPercent: remaining,
    elapsedPercent: elapsed * 100,
    start: new Date(start).toISOString(),
    resetsAt: new Date(reset).toISOString(),
    resetsInLabel: durationLabel(reset - now),
    idealRemaining: ideal,
    paceDelta,
    paceLabel:
      Math.abs(paceDelta) < 0.05
        ? 'On pace'
        : `${Math.abs(paceDelta).toFixed(1)} pts ${paceDelta > 0 ? 'ahead' : 'behind'}`,
    dailyAllowancePercent:
      remaining / Math.max(1 / 1440, (reset - observed) / 86400000),
    samples: consistent
      .filter(
        (s, i) =>
          !i ||
          s.t !== consistent[i - 1].t ||
          s.remaining !== consistent[i - 1].remaining,
      )
      .map(({ t, remaining }) => ({ t, remaining })),
    forecast:
      projectedUse === null
        ? null
        : {
            projectedUsePercent: projectedUse,
            projectedRemaining: Math.max(0, 100 - projectedUse),
            projectedEnd: new Date(projectedEnd).toISOString(),
            runsOut: projectedEnd < reset,
            lockedOutSeconds: Math.max(0, (reset - projectedEnd) / 1000),
          },
  };
}
export function durationLabel(ms) {
  const minutes = Math.max(0, Math.ceil(ms / 60000)),
    days = Math.floor(minutes / 1440),
    hours = Math.floor(minutes / 60) % 24;
  return days
    ? `${days}d ${hours}h`
    : hours
      ? `${hours}h ${minutes % 60}m`
      : `${minutes}m`;
}
export function subscription(harness, detected, env = process.env) {
  const raw =
    detected ||
    env[harness === 'claude' ? 'CLAUDE_PLAN' : 'CODEX_PLAN'] ||
    (harness === 'claude' ? 'max5x' : 'plus');
  const value = String(raw).toLowerCase();
  let plan = String(raw),
    pricePerMonth = null;
  if (harness === 'claude') {
    if (value.includes('20x') || value === 'max20') {
      plan = 'Max 20×';
      pricePerMonth = 200;
    } else if (value.includes('max') || value.includes('5x')) {
      plan = 'Max 5×';
      pricePerMonth = 100;
    } else if (value.includes('pro')) {
      plan = 'Pro';
      pricePerMonth = 20;
    }
  } else if (value === 'plus' || value === 'pro') {
    plan = value === 'plus' ? 'Plus' : 'Pro';
    // The provider's generic 'pro' label does not identify its billing tier.
    pricePerMonth = value === 'plus' ? 20 : null;
  }
  const numeric = Number(value.replace(/^\$/, ''));
  if (Number.isFinite(numeric) && numeric > 0) {
    plan = 'Custom';
    pricePerMonth = numeric;
  }
  const configuredPrice = Number(env[harness === 'claude' ? 'CLAUDE_MONTHLY_PRICE' : 'CODEX_MONTHLY_PRICE']);
  if (Number.isFinite(configuredPrice) && configuredPrice > 0) pricePerMonth = configuredPrice;
  return {
    plan,
    pricePerMonth,
    planSource: detected
      ? 'detected'
      : env[harness === 'claude' ? 'CLAUDE_PLAN' : 'CODEX_PLAN']
        ? 'env'
        : 'default',
  };
}
export function claudeReading(body) {
  const limits = Array.isArray(body?.limits) ? body.limits : [];
  const window = (key, kind, minutes) => {
    const raw = body?.[key] || limits.find((x) => x.kind === kind);
    const used = raw?.utilization ?? raw?.percent;
    return raw && typeof used === 'number'
      ? { usedPercent: used, windowMinutes: minutes, resetsAt: raw.resets_at,
          ...(kind === 'session' && used === 0 && raw.resets_at === null && raw.is_active !== true
            ? { state: 'idle' } : {}) }
      : null;
  };
  const scoped = limits
    .filter((x) => x.kind === 'weekly_scoped')
    .map((x) => ({
      name:
        x.scope?.model?.display_name ||
        x.scope?.model?.id ||
        (typeof x.scope === 'string' ? x.scope : 'Model'),
      usedPercent: x.percent,
      remainingPercent: 100 - x.percent,
      resetsAt: x.resets_at,
    }))
    .filter((x) => Number.isFinite(x.usedPercent));
  for (const [key, name] of [
    ['seven_day_opus', 'Opus'],
    ['seven_day_sonnet', 'Sonnet'],
  ]) {
    const w = body?.[key];
    if (typeof w?.utilization === 'number')
      scoped.push({
        name,
        usedPercent: w.utilization,
        remainingPercent: 100 - w.utilization,
        resetsAt: w.resets_at,
      });
  }
  const extra = body?.extra_usage;
  return {
    session: window('five_hour', 'session', 300),
    weekly: window('seven_day', 'weekly_all', 10080),
    scoped,
    extraUsage: extra
      ? {
          enabled: extra.is_enabled === true,
          usedUSD:
            typeof extra.used_credits === 'number'
              ? extra.used_credits / 100
              : null,
          limitUSD:
            typeof extra.monthly_limit === 'number'
              ? extra.monthly_limit / 100
              : null,
          usedPercent: extra.utilization ?? null,
        }
      : null,
  };
}
export function codexReading(body, live = false) {
  if (!body || (!live && body.limit_id && body.limit_id !== 'codex'))
    return null;
  const raw = live ? body.rate_limit : body;
  if (!raw) return null;
  const windows = [
    live ? raw.primary_window : raw.primary,
    live ? raw.secondary_window : raw.secondary,
  ]
    .filter(Boolean)
    .map((w) => ({
      usedPercent: w.used_percent,
      windowMinutes: live ? w.limit_window_seconds / 60 : w.window_minutes,
      resetsAt:
        Number.isFinite(live ? w.reset_at : w.resets_at) &&
        Math.abs(live ? w.reset_at : w.resets_at) < 8640000000000
          ? new Date((live ? w.reset_at : w.resets_at) * 1000).toISOString()
          : null,
    }));
  const credits = body.rate_limit_reset_credits || body.rateLimitResetCredits;
  return {
    session:
      windows
        .filter((w) => w.windowMinutes < 1440)
        .sort((a, b) => a.windowMinutes - b.windowMinutes)[0] || null,
    weekly:
      windows
        .filter((w) => w.windowMinutes >= 2880)
        .sort((a, b) => b.windowMinutes - a.windowMinutes)[0] || null,
    plan: body.plan_type || null,
    resetCreditsAvailable: live
      ? (credits?.available_count ?? credits?.availableCount ?? null)
      : null,
  };
}
export function lowerCodexReading(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = { ...a };
  for (const key of ['session', 'weekly']) {
    const x = a[key],
      y = b[key];
    if (!x) out[key] = y;
    else if (
      y &&
      x.windowMinutes === y.windowMinutes &&
      Math.abs(Date.parse(x.resetsAt) - Date.parse(y.resetsAt)) <= 60000 &&
      y.usedPercent < x.usedPercent
    )
      out[key] = y;
  }
  return out;
}
const SURFACES = {
  cli: 'CLI',
  exec: 'Exec',
  desktop_app: 'Desktop app',
  work_desktop: 'Desktop app (work)',
  vscode: 'IDE extension',
  jetbrains: 'JetBrains',
  web: 'Cloud',
  work_web: 'Cloud (work)',
  mobile: 'Mobile',
  work_mobile: 'Mobile (work)',
  github: 'GitHub',
  github_code_review: 'Code review',
  slack: 'Slack',
  linear: 'Linear',
  sdk: 'SDK',
  agent_identity: 'Agent identity',
};
export function surfaceBreakdown(body) {
  if (body?.units !== 'percent' || !Array.isArray(body.data)) return null;
  const days = body.data
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    .map((d) => {
      const surfaces = Object.entries(d.product_surface_usage_values || {})
        .filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v > 0)
        .map(([surface, usedPercent]) => ({
          surface,
          label: SURFACES[surface] || 'Other',
          usedPercent,
        }))
        .sort((a, b) => b.usedPercent - a.usedPercent);
      const models = (Array.isArray(d.models) ? d.models : [])
        .filter(
          (m) =>
            typeof m.credits === 'number' &&
            Number.isFinite(m.credits) &&
            m.credits > 0,
        )
        .map((m) => ({
          model: m.model,
          speed: m.speed,
          usedPercent: m.credits,
        }))
        .sort((a, b) => b.usedPercent - a.usedPercent);
      return {
        date: d.date,
        usedPercent: (surfaces.length ? surfaces : models).reduce(
          (n, x) => n + x.usedPercent,
          0,
        ),
        surfaces,
        models,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  return days.length > 0
    ? { totalPercent: days.reduce((n, d) => n + d.usedPercent, 0), days }
    : null;
}
