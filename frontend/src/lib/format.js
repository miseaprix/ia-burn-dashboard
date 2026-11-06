import {DEMO} from './demo-mode.js';
// Shared formatting + date helpers (native Intl only).
const usd = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: DEMO ? 0 : 2,
  maximumFractionDigits: DEMO ? 0 : 2,
});

export function fmtUsd(n) {
  return n == null ? '—' : `$${usd.format(Number(n) || 0)}`;
}

export function fmtSpend(value) {
  if (value.costComplete === false && !(value.spend > 0)) return '—';
  return fmtUsd(value.spend) + (value.costComplete === false ? ' + unknown' : '');
}

export function fmtInt(n) {
  return Number(n || 0).toLocaleString('en-US');
}

// 10.24B / 3.1M / 12.5K
export function fmtCompact(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
}

// 'YYYY-MM-DD' (or ISO) -> UTC Date
export function parseDay(s) {
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function shortDate(s) {
  const d = parseDay(s);
  if (!d) return String(s ?? '');
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// "4d 19h" / "5h 12m" / "now"
export function fmtCountdown(targetIso, now = Date.now()) {
  const t = new Date(targetIso).getTime();
  if (Number.isNaN(t)) return '—';
  let mins = Math.floor((t - now) / 60000);
  if (mins <= 0) return 'now';
  const d = Math.floor(mins / 1440);
  mins -= d * 1440;
  const h = Math.floor(mins / 60);
  const m = mins - h * 60;
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m}m`;
}

// Group daily rows by Monday-week or month. Returns [{date,label,spend,tokens,byGroup}]
export function bucketDaily(daily, mode) {
  const rows = Array.isArray(daily) ? daily : [];
  if (mode === 'daily')
    return rows.map((d) => ({ ...d, label: shortDate(d.date) }));
  const map = new Map();
  for (const d of rows) {
    const dt = parseDay(d.date);
    if (!dt) continue;
    let key;
    let label;
    if (mode === 'weekly') {
      const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
      const mon = new Date(dt.getTime() - dow * 86400000);
      key = mon.toISOString().slice(0, 10);
      label = `Wk ${shortDate(key)}`;
    } else {
      key = dt.toISOString().slice(0, 7) + '-01';
      label = dt.toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      });
    }
    let b = map.get(key);
    if (!b) {
      b = { date: key, label, spend: 0, tokens: null, byGroup: null, costComplete: true, unknownTokens: 0 };
      map.set(key, b);
    }
    b.spend += Number(d.spend) || 0;
    if (d.costComplete === false) b.costComplete = false;
    b.unknownTokens += d.unknownTokens || 0;
    if (d.tokens != null) b.tokens = (b.tokens || 0) + Number(d.tokens);
    const bg = groupMap(d.byGroup);
    if (bg) {
      b.byGroup = b.byGroup || {};
      for (const [k, v] of Object.entries(bg))
        b.byGroup[k] = (b.byGroup[k] || 0) + v;
    }
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// byGroup may be {key: spend}, [{key, spend}] or null -> {key: spend} | null
export function groupMap(bg) {
  if (!bg) return null;
  if (Array.isArray(bg)) {
    const o = {};
    for (const g of bg) o[g.key ?? g.label] = Number(g.spend) || 0;
    return Object.keys(o).length ? o : null;
  }
  if (typeof bg === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(bg)) {
      o[k] = Number(typeof v === 'object' && v ? v.spend : v) || 0;
    }
    return Object.keys(o).length ? o : null;
  }
  return null;
}
