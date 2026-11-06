import {
  readFile,
  readdir,
  stat,
  open,
  mkdir,
  writeFile,
  rename,
} from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getJson } from './http-json.js';
import { collectSurface } from './codex-surface.js';
import { nativeQuotaHistory } from './native-history.js';
import { ParsedFileCache } from '../storage/file-cache.js';
const codexQuotaCache = new ParsedFileCache('codex-quota-tail-v1');
const archiveFileCache = new ParsedFileCache('native-quota-archive', {
  persistent: false,
  limit: 4,
});
import {
  claudeReading,
  codexReading,
  lowerCodexReading,
  quotaWindow,
  subscription,
} from '../domain/quota.js';
const FRESH = 55000,
  STALE = 900000;
const caches = new Map();
async function json(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}
async function files(dir, out = []) {
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await files(p, out);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  } catch {}
  return out;
}
export async function codexLogs(home) {
  const all = await files(path.join(home, 'sessions'));
  await files(path.join(home, 'archived_sessions'), all);
  const sorted = await Promise.all(
    all.map(async (file) => ({
      file,
      mtime: (await stat(file).catch(() => ({ mtimeMs: 0 }))).mtimeMs,
    })),
  );
  const events = [];
  for (const { file } of sorted
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 24)) {
    const cachedEvents = await codexQuotaCache.get(file, async (file) => {
      const parsed = [];
      let handle;
      try {
        handle = await open(file, 'r');
        const { size } = await handle.stat();
        const offset = Math.max(0, size - 65536),
          buffer = Buffer.alloc(Math.min(size, 65536));
        await handle.read(buffer, 0, buffer.length, offset);
        const lines = buffer.toString('utf8').split('\n');
        if (offset) lines.shift();
        for (const line of lines) {
          if (!line.includes('rate_limits')) continue;
          try {
            const e = JSON.parse(line);
            if (e.type !== 'event_msg' || e.payload?.type !== 'token_count')
              continue;
            const reading = codexReading(e.payload.rate_limits);
            const t = Date.parse(e.timestamp);
            if (reading && Number.isFinite(t))
              parsed.push({ reading, observedAt: new Date(t).toISOString() });
          } catch {}
        }
      } catch {
      } finally {
        await handle?.close();
      }
      return parsed;
    });
    events.push(...(cachedEvents || []));
  }
  return events.sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
  );
}
const accountKey = (value) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
function cachedClaude(config, now) {
  const c = config?.cachedUsageUtilization;
  const id = config?.oauthAccount?.accountUuid;
  if (
    !id ||
    c?.accountUuid !== id ||
    !c.utilization ||
    !Number.isFinite(c.fetchedAtMs) ||
    now - c.fetchedAtMs > STALE ||
    now < c.fetchedAtMs
  )
    return null;
  return {
    reading: claudeReading(c.utilization),
    observedAt: new Date(c.fetchedAtMs).toISOString(),
    source: 'claude-cache',
  };
}
// Agent Burn's host-side cache contains a quota response, never credentials.
// Mount its directory because the native app replaces the file atomically.
export function nativeClaudeCache(cache, now = Date.now()) {
  if (
    !Number.isFinite(cache?.fetchedAt) ||
    now < cache.fetchedAt ||
    now - cache.fetchedAt > STALE ||
    typeof cache.body !== 'string' ||
    cache.body.length > 1048576
  )
    return null;
  try {
    const reading = claudeReading(JSON.parse(cache.body));
    if (
      !quotaWindow(
        reading.session,
        new Date(cache.fetchedAt).toISOString(),
        now,
      ) &&
      !quotaWindow(reading.weekly, new Date(cache.fetchedAt).toISOString(), now)
    )
      return null;
    return {
      reading,
      observedAt: new Date(cache.fetchedAt).toISOString(),
      source: 'agent-burn-cache',
    };
  } catch {
    return null;
  }
}
function newerReading(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a.observedAt) >= Date.parse(b.observedAt) ? a : b;
}
async function snapshot(key, token, fetchReading, fallback, now) {
  let cache = caches.get(key);
  if (!cache) {
    cache = { next: 0, value: null, pending: null };
    caches.set(key, cache);
  }
  if (cache.pending) return cache.pending;
  cache.value = newerReading(cache.value, fallback);
  // Reuse the native app's fresh response instead of polling Anthropic twice.
  if (cache.value && now - Date.parse(cache.value.observedAt) <= FRESH)
    return cache.value;
  if (now < cache.next)
    return cache.value && now - Date.parse(cache.value.observedAt) <= STALE
      ? cache.value
      : fallback;
  cache.pending = (async () => {
    cache.next = now + 60000;
    if (token)
      try {
        cache.value = {
          ...(await fetchReading()),
          observedAt: new Date(now).toISOString(),
          source: 'live',
        };
        cache.next = now + FRESH;
      } catch (e) {
        if (e.status === 429) {
          const numeric = Number(e.retryAfter);
          const wait = Number.isFinite(numeric)
            ? numeric * 1000
            : Date.parse(e.retryAfter) - now;
          cache.next = now + Math.max(60000, Math.min(STALE, wait || 60000));
        }
      }
    if (cache.value && now - Date.parse(cache.value.observedAt) <= STALE)
      return cache.value;
    return fallback;
  })().finally(() => {
    cache.pending = null;
  });
  return cache.pending;
}
async function record(key, snapshot, seed, now) {
  const dir = process.env.STATE_DIR || '/data/state',
    file = path.join(dir, `${key}.json`);
  const stored = await json(file);
  let rows = Array.isArray(stored) ? stored : [];
  rows = rows.filter((s) => Date.parse(s.t) >= now - 8 * 86400000);
  const sampleKey = (s) =>
    `${s.t}|${s.windowMinutes}|${Math.round(Date.parse(s.resetsAt) / 1000)}`;
  const seen = new Set(rows.map(sampleKey));
  for (const s of [...seed, ...(snapshot ? [snapshot] : [])])
    for (const kind of ['session', 'weekly']) {
      const w = s.reading[kind];
      if (
        Date.parse(s.observedAt) < now - 8 * 86400000 ||
        !w || w.state === 'idle' ||
        !quotaWindow(w, s.observedAt, Date.parse(s.observedAt))
      )
        continue;
      const sample = {
        t: s.observedAt,
        remaining: 100 - w.usedPercent,
        resetsAt: w.resetsAt,
        windowMinutes: w.windowMinutes,
      };
      const fingerprint = sampleKey(sample);
      if (!seen.has(fingerprint)) {
        rows.push(sample);
        seen.add(fingerprint);
      }
    }
  rows.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  rows = rows.slice(-24000);
  let persisted = true;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, JSON.stringify(rows), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  } catch {
    persisted = false;
  }
  return { rows, persisted };
}
function build(snapshot, history, now, harness) {
  if (!snapshot) return null;
  const observed = Date.parse(snapshot.observedAt),
    age = now - observed;
  const session = quotaWindow(
      snapshot.reading.session,
      snapshot.observedAt,
      now,
      history.rows,
    ),
    weekly = quotaWindow(
      snapshot.reading.weekly,
      snapshot.observedAt,
      now,
      history.rows,
    );
  if (!session && !weekly) return null;
  const risk = (harness === 'codex' ? [weekly] : [session, weekly]).find(
    (w) => w?.remainingPercent === 0 || w?.forecast?.runsOut,
  );
  return {
    observedAt: snapshot.observedAt,
    source: snapshot.source,
    fresh: age <= 90000,
    stale: age > 90000,
    historyPersisted: history.persisted,
    session,
    weekly,
    scoped: snapshot.reading.scoped || [],
    extraUsage: snapshot.reading.extraUsage || null,
    resetCreditsAvailable: snapshot.reading.resetCreditsAvailable ?? null,
    verdict: {
      atRisk: !!risk,
      headline: risk
        ? risk.remainingPercent === 0
          ? 'Limit reached.'
          : 'Limit runs out before reset.'
        : 'On track.',
      detail: risk
        ? `Resets ${risk.resetsAt}`
        : 'At this pace the limits last until they reset.',
    },
  };
}
let pending;
// One collector shared by requests and the timer, preventing concurrent state writes.
export function getPersonal() {
  if (pending) return pending;
  pending = collect().finally(() => {
    pending = null;
  });
  return pending;
}
async function collect() {
  const now = Date.now(),
    claudeDir = (process.env.CLAUDE_CONFIG_DIR || '/data/claude').split(',')[0],
    home = process.env.CODEX_HOME || '/data/codex';
  const [config, creds, auth, logs, nativeCache, nativeArchive] =
    await Promise.all([
      json(process.env.CLAUDE_ACCOUNT_FILE || '/data/claude-account.json'),
      json(
        process.env.CLAUDE_CREDENTIALS_FILE ||
          path.join(claudeDir, '.credentials.json'),
      ),
      json(path.join(home, 'auth.json')),
      codexLogs(home),
      json(
        process.env.CLAUDE_USAGE_CACHE_FILE ||
          '/data/agent-burn-cache/claude-usage.json',
      ),
      archiveFileCache.get(
        process.env.AGENT_BURN_HISTORY_FILE ||
          '/data/agent-burn-history/quota-archive.json',
        json,
      ),
    ]);
  const nativeHistory = nativeQuotaHistory(
    nativeArchive,
    process.env.AGENT_BURN_HISTORY_SOURCE,
    now,
  );
  const ct = creds?.claudeAiOauth?.accessToken,
    xt = auth?.tokens?.access_token;
  const ck = `claude-${accountKey(config?.oauthAccount?.accountUuid || ct || claudeDir)}`,
    xk = `codex-${accountKey(auth?.tokens?.account_id || xt || home)}`;
  const headers = (token) => ({
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'ia-burn/0.1',
  });
  const [claude, codex, surface] = await Promise.all([
    snapshot(
      ck,
      ct,
      async () => ({
        reading: claudeReading(
          await getJson('https://api.anthropic.com/api/oauth/usage', {
            headers: { ...headers(ct), 'anthropic-beta': 'oauth-2025-04-20' },
          }),
        ),
      }),
      newerReading(
        cachedClaude(config, now),
        nativeClaudeCache(nativeCache, now),
      ),
      now,
    ),
    snapshot(
      xk,
      xt,
      async () => {
        const readings = await Promise.allSettled(
          Array.from({ length: 3 }, () =>
            getJson('https://chatgpt.com/backend-api/wham/usage', {
              headers: headers(xt),
            }).then((x) => codexReading(x, true)),
          ),
        );
        let reading = readings
          .filter((x) => x.status === 'fulfilled')
          .reduce((a, x) => lowerCodexReading(a, x.value), null);
        if (!reading)
          throw (
            readings.find((x) => x.status === 'rejected')?.reason ||
            new Error('Unavailable')
          );
        const latest = logs.at(-1);
        if (latest && now - Date.parse(latest.observedAt) < 600000)
          for (const kind of ['session', 'weekly']) {
            const live = reading[kind],
              log = latest.reading[kind];
            if (
              live &&
              log &&
              live.windowMinutes === log.windowMinutes &&
              Math.abs(Date.parse(live.resetsAt) - Date.parse(log.resetsAt)) <=
                60000 &&
              live.usedPercent > log.usedPercent * 1.5 + 3
            )
              reading = { ...reading, [kind]: log };
          }
        return { reading };
      },
      logs.at(-1) ? { ...logs.at(-1), source: 'logs' } : null,
      now,
    ),
    collectSurface(xk, xt, () => getJson(
      'https://chatgpt.com/backend-api/wham/usage/daily-token-usage-breakdown',
      { headers: headers(xt) },
    ), now),
  ]);
  const [ch, xh] = await Promise.all([
    record(ck, claude, nativeHistory.claude, now),
    record(xk, codex, [...nativeHistory.codex, ...logs], now),
  ]);
  const account = config?.oauthAccount;
  const tier =
    account?.userRateLimitTier ||
    account?.organizationRateLimitTier ||
    account?.organizationType;
  return {
    claude: {
      subscription: subscription('claude', tier),
      burndown: build(claude, ch, now, 'claude'),
    },
    codex: {
      subscription: subscription('codex', codex?.reading.plan),
      burndown: build(codex, xh, now, 'codex'),
      surfaceBreakdown: surface.data,
      surfaceStatus: surface.status,
    },
  };
}
