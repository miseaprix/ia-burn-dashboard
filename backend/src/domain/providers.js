// Provider / harness mapping and range helpers.
// Pure functions, no I/O. Shared by both providers.

// Brand colors for API-mode "By provider" grouping.
export const PROVIDER_COLORS = {
  Anthropic: '#FF8533',
  OpenAI: '#10a37f',
  Google: '#0a84ff',
  Mistral: '#fa5010',
  Other: '#8a8f98',
};

// Harness (coding agent) colors for local-mode "By harness" grouping.
export const HARNESS_COLORS = {
  codex: '#34c759',
  claude: '#FF8533',
  cursor: '#af52de',
  opencode: '#5856d6',
};

const DEFAULT_COLOR = '#8a8f98';

// Classify a model id into a provider brand, by prefix/substring.
// Robust to new model versions.
export function providerOf(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (/claude/.test(id)) return 'Anthropic';
  if (/gpt/.test(id)) return 'OpenAI';
  if (/gemini|imagen/.test(id)) return 'Google';
  if (/mistral|pixtral/.test(id)) return 'Mistral';
  return 'Other';
}

export function providerColor(provider) {
  return PROVIDER_COLORS[provider] || DEFAULT_COLOR;
}

// Color for a harness name (claude, codex, cursor, opencode, …).
export function harnessColor(name) {
  const key = String(name || '').toLowerCase();
  return HARNESS_COLORS[key] || DEFAULT_COLOR;
}

// Format a Date as YYYY-MM-DD in local time.
function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Translate a range keyword into {start, end} YYYY-MM-DD.
// today | 7d | 30d | all. "all" starts at 2020-01-01.
export function rangeToDates(range, now = new Date(), resetStart = null) {
  const end = new Date(now);
  const start = new Date(now);
  switch (range) {
    case 'today':
      // start == end == today
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case 'wtd':
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      break;
    case 'rtd':
      if (resetStart)
        return { start: isoDate(new Date(resetStart)), end: isoDate(end) };
      return { start: null, end: isoDate(end) };
    case 'mtd':
      start.setDate(1);
      break;
    case 'ytd':
      start.setMonth(0, 1);
      break;
    case 'week':
    case '7d':
      start.setDate(start.getDate() - 6); // inclusive 7-day window
      break;
    case 'month':
    case '30d':
      start.setDate(start.getDate() - 29); // inclusive 30-day window
      break;
    case 'all':
    default:
      return { start: '2020-01-01', end: isoDate(end) };
  }
  return { start: isoDate(start), end: isoDate(end) };
}

// Human label for a range keyword (used in the header subtitle).
export function rangeLabel(range) {
  const labels = {
    custom: 'Custom dates',
    yesterday: 'Yesterday',
    rtd: 'Reset to date',
    wtd: 'Week to date',
    mtd: 'Month to date',
    ytd: 'Year to date',
    week: 'Last 7 days',
    month: 'Last 30 days',
  };
  if (labels[range]) return labels[range];
  switch (range) {
    case 'today':
      return 'Today';
    case '7d':
      return 'Last 7 days';
    case '30d':
      return 'Last 30 days';
    case 'all':
    default:
      return 'All time';
  }
}
