import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getDashboard } from '../src/integrations/enterprise.js';
function intercept(t, respond) {
  t.mock.method(https, 'get', (url, options, cb) => {
    const req = new EventEmitter();
    req.destroy = () => req.emit('close');
    queueMicrotask(() => {
      const r = new EventEmitter(),
        result = respond(url, options);
      r.statusCode = result.status || 200;
      r.headers = result.headers || {};
      r.resume = () => queueMicrotask(() => req.emit('close'));
      r.destroy = req.destroy;
      cb(r);
      if (r.statusCode === 200) {
        r.emit('data', Buffer.from(JSON.stringify(result.body)));
        r.emit('end');
        req.emit('close');
      }
    });
    return req;
  });
}
test('corporate provider keeps range total distinct from monthly budget and isolates TLS', async (t) => {
  process.env.ANTHROPIC_AUTH_TOKEN = 'corporate-fixture';
  process.env.ENTERPRISE_INSECURE_TLS = '1';
  process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.test';
  let monthlyFailure = false;
  const calls = [];
  intercept(t, (url, opts) => {
    calls.push({ url, opts });
    assert.equal(opts.headers.Authorization, 'Bearer corporate-fixture');
    if (url.pathname === '/spend/logs') return { status: 500 };
    const today = new Date();
    const monthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const monthly = url.searchParams.get('start_date') === monthStart;
    if (monthly && monthlyFailure) return { status: 503 };
    return {
      body: {
        metadata: { total_spend: monthly ? 25 : 7 },
        results: [
          {
            date: new Date().toISOString().slice(0, 10),
            metrics: { spend: monthly ? 25 : 7, api_requests: 2 },
          },
        ],
      },
    };
  });
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const result = await getDashboard({ range: 'all' });
  assert.equal(result.totals.spend, 7);
  assert.equal(result.budget.spent, 25);
  assert.deepEqual(Object.keys(result.harnesses), ['enterprise']);
  assert.equal(result.capabilities.tokens, false);
  assert.equal(result.models.length, 0);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, previous);
  assert.ok(calls.every((c) => c.opts.rejectUnauthorized === false));
  monthlyFailure = true;
  const failed = await getDashboard({ range: 'all' });
  assert.equal(failed.budget, null);
  assert.equal(failed.budgetBurndown, null);
  assert.ok(failed.warnings.length);
  assert.equal(failed.totals.spend, 7);
});
test('personal calls use personal tokens, fixed endpoints, shared cache and account fallback', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-live-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  process.env.STATE_DIR = path.join(root, 'state');
  process.env.CLAUDE_ACCOUNT_FILE = path.join(root, 'account.json');
  process.env.ANTHROPIC_AUTH_TOKEN = 'corporate-fixture';
  await mkdir(process.env.CLAUDE_CONFIG_DIR);
  await mkdir(process.env.CODEX_HOME);
  await writeFile(
    path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: { accessToken: 'claude-personal-fixture' },
    }),
  );
  await writeFile(
    path.join(process.env.CODEX_HOME, 'auth.json'),
    JSON.stringify({
      tokens: {
        access_token: 'codex-personal-fixture',
        account_id: 'account-a',
      },
    }),
  );
  await writeFile(
    process.env.CLAUDE_ACCOUNT_FILE,
    JSON.stringify({
      oauthAccount: {
        accountUuid: 'account-a',
        userRateLimitTier: 'default_claude_max_20x',
      },
    }),
  );
  let count = 0;
  intercept(t, (url, opts) => {
    count++;
    assert.equal(opts.rejectUnauthorized, true);
    assert.notEqual(opts.headers.Authorization, 'Bearer corporate-fixture');
    if (url.hostname === 'api.anthropic.com') {
      assert.equal(
        opts.headers.Authorization,
        'Bearer claude-personal-fixture',
      );
      return {
        body: {
          five_hour: {
            utilization: 10,
            resets_at: new Date(Date.now() + 3600000).toISOString(),
          },
          seven_day: {
            utilization: 20,
            resets_at: new Date(Date.now() + 86400000).toISOString(),
          },
        },
      };
    }
    assert.equal(url.hostname, 'chatgpt.com');
    assert.equal(opts.headers.Authorization, 'Bearer codex-personal-fixture');
    if (url.pathname.endsWith('daily-token-usage-breakdown'))
      return { body: { units: 'percent', data: [] } };
    return {
      body: {
        plan_type: 'plus',
        rate_limit: {
          secondary_window: {
            used_percent: 20,
            limit_window_seconds: 604800,
            reset_at: Math.floor(Date.now() / 1000) + 86400,
          },
        },
        rate_limit_reset_credits: { available_count: 2 },
      },
    };
  });
  const { getPersonal } = await import('../src/integrations/personal.js');
  const [a, b] = await Promise.all([getPersonal(), getPersonal()]);
  assert.equal(a, b);
  assert.equal(a.claude.subscription.pricePerMonth, 200);
  assert.equal(a.codex.burndown.resetCreditsAvailable, 2);
  assert.equal(a.claude.burndown.source, 'live');
  const initial = count;
  await getPersonal();
  assert.equal(count, initial);
  // An account switch with no live token must not reuse the old account's snapshot.
  await writeFile(
    path.join(process.env.CLAUDE_CONFIG_DIR, '.credentials.json'),
    '{}',
  );
  await writeFile(
    process.env.CLAUDE_ACCOUNT_FILE,
    JSON.stringify({
      oauthAccount: { accountUuid: 'account-b' },
      cachedUsageUtilization: {
        accountUuid: 'account-a',
        fetchedAtMs: Date.now(),
        utilization: {},
      },
    }),
  );
  assert.equal((await getPersonal()).claude.burndown, null);
});

test('mounted corporate shell file is read as literals without executing exports', async () => {
  const { parseCorporateEnv, corporateConfig } = await import(
    '../src/config/corporate-config.js'
  );
  const input =
    'export ANTHROPIC_AUTH_TOKEN="fixture-token"\nexport ANTHROPIC_BASE_URL="https://example.invalid"\nexport NO_PROXY="$NO_PROXY"\nexport ENTERPRISE_BUDGET=450\n';
  assert.deepEqual(parseCorporateEnv(input), {
    ANTHROPIC_AUTH_TOKEN: 'fixture-token',
    ANTHROPIC_BASE_URL: 'https://example.invalid',
    ENTERPRISE_BUDGET: '450',
  });
  assert.deepEqual(
    parseCorporateEnv('export ANTHROPIC_AUTH_TOKEN="$(touch forbidden)"'),
    {},
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-env-'));
  const file = path.join(root, 'corporate.env');
  await writeFile(file, input);
  const config = await corporateConfig({ ENTERPRISE_ENV_FILE: file });
  assert.equal(config.token, 'fixture-token');
  assert.equal(config.budget, '450');
  assert.equal(
    (
      await corporateConfig({
        ENTERPRISE_ENV_FILE: file,
        ANTHROPIC_AUTH_TOKEN: 'override',
      })
    ).token,
    'override',
  );
});

test('native Claude cache enables Docker quotas without an OAuth token and follows atomic replacements', async (t) => {
  const { getPersonal, nativeClaudeCache } = await import(
    '../src/integrations/personal.js'
  );
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-native-'));
  const now = Date.now();
  const makeCache = (used, fetchedAt = now) => ({
    fetchedAt,
    body: JSON.stringify({
      five_hour: {
        utilization: 1,
        resets_at: new Date(now + 4 * 3600000).toISOString(),
      },
      seven_day: {
        utilization: used,
        resets_at: new Date(now + 3 * 86400000).toISOString(),
      },
    }),
  });
  assert.equal(nativeClaudeCache(makeCache(63, now - 900001), now), null);
  assert.equal(nativeClaudeCache(makeCache(63, now + 1), now), null);
  assert.equal(
    nativeClaudeCache({ fetchedAt: now, body: 'broken' }, now),
    null,
  );
  assert.equal(nativeClaudeCache({ fetchedAt: now, body: '{}' }, now), null);
  assert.equal(
    nativeClaudeCache(makeCache(63), now).reading.weekly.usedPercent,
    63,
  );
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'missing-claude');
  process.env.CODEX_HOME = path.join(root, 'missing-codex');
  process.env.STATE_DIR = path.join(root, 'state');
  process.env.CLAUDE_ACCOUNT_FILE = path.join(root, 'account.json');
  process.env.CLAUDE_USAGE_CACHE_FILE = path.join(root, 'claude-usage.json');
  await writeFile(
    process.env.CLAUDE_ACCOUNT_FILE,
    JSON.stringify({ oauthAccount: { accountUuid: 'native-fixture' } }),
  );
  await writeFile(
    process.env.CLAUDE_USAGE_CACHE_FILE,
    JSON.stringify(makeCache(63, now - 1000)),
  );
  let calls = 0;
  intercept(t, () => {
    calls++;
    return { status: 503 };
  });
  const first = await getPersonal();
  assert.equal(first.claude.burndown.source, 'agent-burn-cache');
  assert.equal(first.claude.burndown.weekly.remainingPercent, 37);
  assert.equal(first.claude.burndown.session.remainingPercent, 99);
  assert.equal(first.claude.burndown.historyPersisted, true);
  const replacement = path.join(root, 'replacement.json');
  await writeFile(replacement, JSON.stringify(makeCache(64, now)));
  const { rename } = await import('node:fs/promises');
  await rename(replacement, process.env.CLAUDE_USAGE_CACHE_FILE);
  assert.equal(
    (await getPersonal()).claude.burndown.weekly.remainingPercent,
    36,
  );
  assert.equal(calls, 0);
  delete process.env.CLAUDE_USAGE_CACHE_FILE;
});

test('fresh Codex quota logs do not skip independent daily breakdown collection', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'burn-surface-logs-'));
  process.env.CLAUDE_CONFIG_DIR = path.join(root, 'claude');
  process.env.CODEX_HOME = path.join(root, 'codex');
  process.env.STATE_DIR = path.join(root, 'state');
  process.env.CLAUDE_ACCOUNT_FILE = path.join(root, 'missing');
  await mkdir(path.join(process.env.CODEX_HOME, 'sessions'), { recursive: true });
  await writeFile(path.join(process.env.CODEX_HOME, 'auth.json'), JSON.stringify({
    tokens: { access_token: 'surface-fixture', account_id: 'surface-account' },
  }));
  await writeFile(path.join(process.env.CODEX_HOME, 'sessions', 'quota.jsonl'), JSON.stringify({
    type: 'event_msg', timestamp: new Date().toISOString(), payload: {
      type: 'token_count', rate_limits: { limit_id: 'codex', plan_type: 'plus',
        secondary: { used_percent: 30, window_minutes: 10080,
          resets_at: Math.floor(Date.now() / 1000) + 86400 } },
    },
  }));
  const calls = [];
  intercept(t, (url) => {
    calls.push(url.pathname);
    return { body: { units: 'percent', data: [{ date: '2026-10-10',
      product_surface_usage_values: { cli: 12 } }] } };
  });
  const { getPersonal } = await import('../src/integrations/personal.js');
  const result = await getPersonal();
  assert.equal(result.codex.burndown.source, 'logs');
  assert.equal(result.codex.surfaceBreakdown.totalPercent, 12);
  assert.deepEqual(calls, ['/backend-api/wham/usage/daily-token-usage-breakdown']);
});

test('corporate pagination merges split days and models, sums actual tokens, and rejects partial pages', async (t) => {
  process.env.ANTHROPIC_AUTH_TOKEN = 'corporate-fixture';
  let failSecond = false;
  const pages = [];
  intercept(t, url => {
    const page = Number(url.searchParams.get('page'));
    pages.push(page);
    if (page === 2 && failSecond) return {status:503};
    const metrics = {spend:page === 1 ? 2 : 3, total_tokens:page === 1 ? 100 : 200, api_requests:page};
    return {body:{metadata:{page,total_pages:2,has_more:page===1},results:[{
      date:new Date().toISOString().slice(0,10),metrics,
      breakdown:{models:{'claude-test':{metrics}}}
    }]}};
  });
  const result = await getDashboard({range:'all'});
  assert.equal(result.totals.spend,5);
  assert.equal(result.totals.tokens,300);
  assert.equal(result.daily.length,1);
  assert.equal(result.daily[0].requests,3);
  assert.equal(result.daily[0].models['claude-test'].tokens,300);
  assert.equal(result.daily[0].reportedSpend,5);
  assert.equal(result.models[0].spend,5);
  assert.equal(result.models[0].tokens,300);
  assert.equal(result.groups[0].label,'Anthropic');
  assert.equal(result.budget.spent,5);
  assert.deepEqual(pages,[1,2,1,2]);
  failSecond = true;
  assert.ok((await getDashboard({range:'all'})).error);
});
