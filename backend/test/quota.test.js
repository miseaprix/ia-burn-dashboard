import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  quotaWindow,
  claudeReading,
  codexReading,
  lowerCodexReading,
  subscription,
  surfaceBreakdown,
} from '../src/domain/quota.js';
import { rangeToDates } from '../src/domain/providers.js';
const now = Date.parse('2026-10-09T12:00:00Z'),
  observed = new Date(now).toISOString();
test('rolling quota forecast, unknown/expired readings and zero usage', () => {
  const raw = {
      usedPercent: 60,
      windowMinutes: 300,
      resetsAt: '2026-10-09T15:00:00Z',
    },
    q = quotaWindow(raw, observed, now);
  assert.equal(q.remainingPercent, 40);
  assert.equal(q.elapsedPercent, 40);
  assert.equal(q.paceDelta, -20);
  assert.equal(q.forecast.projectedUsePercent, 150);
  assert.equal(q.forecast.runsOut, true);
  assert.equal(quotaWindow({ ...raw, usedPercent: null }, observed, now), null);
  assert.equal(quotaWindow({ ...raw, usedPercent: 101 }, observed, now), null);
  assert.equal(quotaWindow(raw, observed, Date.parse(raw.resetsAt)), null);
  assert.equal(
    quotaWindow({ ...raw, usedPercent: 0 }, observed, now).forecast,
    null,
  );
});
test('quota history excludes other cycles and clears corrected counts', () => {
  const raw = {
    usedPercent: 20,
    windowMinutes: 300,
    resetsAt: '2026-10-09T15:00:00Z',
  };
  const history = [
    { t: '2026-10-09T11:00:00Z', remaining: 50, ...raw },
    { t: '2026-10-09T11:30:00Z', remaining: 80, ...raw },
  ];
  const q = quotaWindow(raw, observed, now, history);
  assert.equal(q.samples.length, 2);
  assert.equal(q.samples[0].remaining, 80);
});
test('vendor normalization uses actual windows and rejects other Codex limits', () => {
  const c = claudeReading({
    limits: [
      { kind: 'weekly_all', percent: 15, resets_at: '2026-10-12T12:00:00Z' },
      {
        kind: 'weekly_scoped',
        percent: 17,
        scope: { model: { display_name: 'Fable' } },
      },
    ],
    extra_usage: {
      used_credits: 2500,
      monthly_limit: 100000,
      is_enabled: true,
    },
  });
  assert.equal(c.weekly.windowMinutes, 10080);
  assert.equal(c.scoped[0].remainingPercent, 83);
  assert.equal(c.extraUsage.usedUSD, 25);
  const live = codexReading(
    {
      plan_type: 'plus',
      rate_limit: {
        primary_window: {
          used_percent: 30,
          limit_window_seconds: 18000,
          reset_at: now / 1000 + 1000,
        },
      },
      rate_limit_reset_credits: { available_count: 3 },
    },
    true,
  );
  assert.equal(live.weekly, null);
  assert.equal(live.session.windowMinutes, 300);
  assert.equal(live.resetCreditsAvailable, 3);
  assert.equal(codexReading({ limit_id: 'other', primary: {} }), null);
  const low = { ...live, session: { ...live.session, usedPercent: 10 } };
  assert.equal(lowerCodexReading(live, low).session.usedPercent, 10);
});
test('detected plans take precedence and unknown prices remain null', () => {
  assert.equal(
    subscription('claude', 'default_claude_max_20x', { CLAUDE_PLAN: 'pro' })
      .pricePerMonth,
    200,
  );
  assert.equal(subscription('codex', 'business', {}).pricePerMonth, null);
  assert.equal(
    subscription('codex', null, { CODEX_PLAN: '150' }).pricePerMonth,
    150,
  );
});
test('surface breakdown is percent-only and never inferred from logs', () => {
  assert.equal(surfaceBreakdown({ units: 'tokens', data: [] }), null);
  const x = surfaceBreakdown({
    units: 'percent',
    data: [
      {
        date: '2026-10-09',
        product_surface_usage_values: { cli: 20, work_mobile: 5 },
        models: [{ model: 'gpt-6', credits: 25 }],
      },
    ],
  });
  assert.equal(x.totalPercent, 25);
  assert.equal(x.days[0].surfaces[1].label, 'Mobile (work)');
});
test('month/week/yesterday ranges and unavailable reset', () => {
  const date = new Date('2026-10-09T12:00:00');
  assert.equal(rangeToDates('mtd', date).start, '2026-10-01');
  assert.equal(rangeToDates('wtd', date).start, '2026-10-05');
  assert.equal(rangeToDates('yesterday', date).end, '2026-10-08');
  assert.equal(rangeToDates('rtd', date).start, null);
});
test('local aggregation, Codex offline fallback, persisted state without tokens', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-test-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  process.env.CLAUDE_ACCOUNT_FILE = path.join(root, 'absent.json');
  process.env.STATE_DIR = path.join(root, 'state');
  await mkdir(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'), {
    recursive: true,
  });
  await mkdir(path.join(process.env.CODEX_HOME, 'sessions'), {
    recursive: true,
  });
  const t = new Date().toISOString();
  const message = {
    timestamp: t,
    message: {
      id: 'a',
      model: 'claude-sonnet-4',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 10,
        cache_creation_input_tokens: 5,
      },
    },
    requestId: 'r',
    costUSD: 1,
  };
  await writeFile(
    path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'a.jsonl'),
    JSON.stringify(message) + '\n' + JSON.stringify(message) + '\n',
  );
  const reset = Math.floor(Date.now() / 1000) + 3600;
  await writeFile(
    path.join(process.env.CODEX_HOME, 'sessions', 'a.jsonl'),
    JSON.stringify({
      timestamp: t,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          limit_id: 'codex',
          plan_type: 'plus',
          primary: { used_percent: 20, window_minutes: 300, resets_at: reset },
          secondary: {
            used_percent: 30,
            window_minutes: 10080,
            resets_at: reset + 86400,
          },
        },
      },
    }) + '\n',
  );
  const { getDashboard } = await import('../src/services/local-dashboard.js');
  await (await import('../src/integrations/local.js')).collectLocal();
  const personal = await (await import('../src/integrations/personal.js')).getPersonal();
  (await import('../src/storage/state-store.js')).stateStore().saveCollection('personal', { value: personal, lastSuccess: Date.now() });
  const result = await getDashboard({ range: 'all' });
  assert.equal(result.totals.spend, 1);
  assert.equal(result.totals.tokens, 165);
  assert.equal(result.daily[0].byHarness.claude, 1);
  assert.equal(result.models[0].share, 1);
  assert.equal(result.harnesses.codex.burndown.source, 'logs');
  assert.equal(result.harnesses.claude.burndown, null);
  assert.deepEqual(result.harnesses.claude.tokenBreakdown, {
    input: 100,
    output: 50,
    cacheWrite: 5,
    cacheRead: 10,
  });
  assert.equal(result.subscriptions.length, 1);
  const { readdir } = await import('node:fs/promises');
  const state = await readdir(process.env.STATE_DIR);
  const content = (
    await Promise.all(
      state
        .filter((f) => f.endsWith('.json'))
        .map((f) => readFile(path.join(process.env.STATE_DIR, f), 'utf8')),
    )
  ).join('');
  assert.ok(!content.includes('Bearer'));
  assert.ok(!content.includes('access_token'));
  assert.ok(!content.includes('message'));
});

test('rolling-window economics prorate the first day and leave unknown prices null', async () => {
  const { costInWindow, usageEconomics } = await import(
    '../src/domain/usage-economics.js'
  );
  const start = new Date('2026-10-01T12:00:00').getTime(),
    end = new Date('2026-10-03T12:00:00').getTime();
  const rows = [
    { period: '2026-10-01', cost: 20 },
    { period: '2026-10-02', cost: 10 },
    { period: '2026-10-04', cost: 99 },
  ];
  assert.equal(costInWindow(rows, start, end), 20);
  assert.equal(
    usageEconomics(rows, { pricePerMonth: null }, null, end).valueMultiple,
    null,
  );
  const b = {
    observedAt: new Date(end).toISOString(),
    session: null,
    weekly: {
      start: new Date(start).toISOString(),
      usedPercent: 20,
      elapsedPercent: 30,
      windowMinutes: 10080,
    },
  };
  const e = usageEconomics(rows, { pricePerMonth: 20 }, b, end);
  assert.equal(b.weekly.dollarsPerPercent, 1);
  assert.equal(e.fullQuotaValue, 100);
});


test('Claude inactive zero session is reset, missing or expired readings stay unknown', () => {
  const reading = claudeReading({ five_hour: { utilization: 0, resets_at: null } });
  const idle = quotaWindow(reading.session, observed, now);
  assert.equal(idle.state, 'idle');
  assert.equal(idle.remainingPercent, 100);
  assert.equal(idle.resetsAt, null);
  assert.equal(idle.forecast, null);
  assert.deepEqual(idle.samples, []);
  assert.equal(quotaWindow(claudeReading({}).session, observed, now), null);
  assert.equal(quotaWindow(claudeReading({five_hour:{utilization:12,resets_at:null}}).session, observed, now), null);
  assert.equal(quotaWindow(claudeReading({five_hour:{utilization:0,resets_at:'2026-10-09T11:00:00Z'}}).session, observed, now), null);
  assert.equal(quotaWindow(reading.session, new Date(now+1000).toISOString(), now), null);
});

test('Codex missing session windows and ambiguous Pro billing remain unknown', () => {
  const r = codexReading({plan_type:'pro', rate_limit:{secondary_window:{used_percent:12,limit_window_seconds:604800,reset_at:1791712800}}}, true);
  assert.equal(r.session,null);
  assert.equal(r.weekly.windowMinutes,10080);
  assert.equal(subscription('codex',r.plan,{}).pricePerMonth,null);
  for (const price of [100,200,500])
    assert.equal(subscription('codex','pro',{CODEX_MONTHLY_PRICE:String(price)}).pricePerMonth,price);
});
