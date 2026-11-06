import { rangeToDates } from './providers.js';
export const RANGES = new Set(['today','yesterday','rtd','wtd','mtd','week','month','ytd','7d','30d','all','custom']);
function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function periodRequest(query, now = new Date()) {
  const range = RANGES.has(query.range) ? query.range : 'mtd';
  const today = rangeToDates('today', now).end;
  if (range === 'custom') {
    if (!validDate(query.from) || !validDate(query.to) || query.from > query.to || query.to > today)
      throw new Error('Choose valid past or current dates, with From before To.');
    return { range, from: query.from, to: query.to };
  }
  return { range };
}
