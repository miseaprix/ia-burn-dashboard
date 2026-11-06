import { consistentQuotaSamples } from '../domain/quota-history.js';
// Native app: Library/Application Support/Agent Burn/quota-archive.json.
// The archive groups readings by cliPath|codexHomes; never merge different sources.
export function nativeQuotaHistory(archive, source, now = Date.now()) {
  const empty = { claude: [], codex: [], source: null };
  if (
    archive?.version !== 1 ||
    !archive.readings ||
    typeof archive.readings !== 'object'
  )
    return empty;
  const keys = Object.keys(archive.readings);
  const key = source || (keys.length === 1 ? keys[0] : null);
  const agents = key && archive.readings[key];
  if (!agents) return empty;
  const out = { claude: [], codex: [], source: key };
  for (const [agent, harness, kind] of [
    ['claude', 'claude', 'weekly'],
    ['claude-session', 'claude', 'session'],
    ['codex', 'codex', 'weekly'],
  ]) {
    const rows = [];
    for (const r of Array.isArray(agents[agent]) ? agents[agent] : []) {
      const w = r?.window,
        t = r?.observedAt;
      if (
        !Number.isFinite(t) ||
        t > now ||
        t < now - 8 * 86400000 ||
        !Number.isFinite(w?.windowMinutes) ||
        !(w.windowMinutes > 0) ||
        !Number.isFinite(w.usedPercent) ||
        w.usedPercent < 0 ||
        w.usedPercent > 100 ||
        !Number.isFinite(w.elapsedPercent) ||
        w.elapsedPercent < 0 ||
        w.elapsedPercent > 100
      )
        continue;
      if (
        (agent === 'claude-session' && w.windowMinutes !== 300) ||
        (agent !== 'claude-session' && w.windowMinutes < 2880)
      )
        continue;
      const reset = t + (1 - w.elapsedPercent / 100) * w.windowMinutes * 60000;
      rows.push({
        t: new Date(t).toISOString(),
        remaining: 100 - w.usedPercent,
        windowMinutes: w.windowMinutes,
        resetsAt: new Date(reset).toISOString(),
      });
    }
    out[harness].push(
      ...consistentQuotaSamples(rows).map((r) => ({
        observedAt: r.t,
        reading: {
          [kind]: {
            usedPercent: 100 - r.remaining,
            windowMinutes: r.windowMinutes,
            resetsAt: r.resetsAt,
          },
        },
      })),
    );
  }
  return out;
}
