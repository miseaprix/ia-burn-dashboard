// Server supplies local-calendar midnight; browser timezone may differ.
export function refreshDelay(refresh, now = Date.now()) {
  const midnight = refresh?.relative && refresh.nextBoundary
    ? Math.max(100, Date.parse(refresh.nextBoundary) - now + 100) : Infinity;
  const live = refresh?.includesToday ? refresh.intervalMs || 60000 : Infinity;
  return Math.min(midnight, live);
}
export function refreshOnReturn(refresh, now = Date.now()) {
  return !refresh || refresh.includesToday ||
    (refresh.relative && Date.parse(refresh.nextBoundary) <= now);
}
