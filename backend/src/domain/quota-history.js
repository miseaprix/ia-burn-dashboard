// Port of Agent Burn QuotaHistory.cycleConsistentReadings/current (Swift).
// Keep genuine cycles, discard superseded-cycle replays and provider over-counts.
export function consistentQuotaSamples(rows) {
  const kept = [],
    starts = [];
  for (const row of [...rows].sort(
    (a, b) => Date.parse(a.t) - Date.parse(b.t),
  )) {
    const t = Date.parse(row.t),
      reset = Date.parse(row.resetsAt);
    const start = reset - row.windowMinutes * 60000;
    if (
      !Number.isFinite(t) ||
      !Number.isFinite(start) ||
      !Number.isFinite(row.remaining) ||
      row.remaining < 0 ||
      row.remaining > 100 ||
      !(row.windowMinutes > 0)
    )
      continue;
    const last = starts.at(-1);
    if (last != null && Math.abs(start - last) <= 300000) {
      kept.push({ row, segment: starts.length - 1 });
    } else if (!starts.some((s) => Math.abs(start - s) <= 300000)) {
      starts.push(start);
      kept.push({ row, segment: starts.length - 1 });
    }
  }
  const floors = new Map(),
    out = [];
  for (const { row, segment } of kept.reverse()) {
    const used = 100 - row.remaining,
      floor = floors.get(segment);
    if (floor != null && used > floor + 1) continue;
    floors.set(segment, Math.min(used, floor ?? used));
    out.push(row);
  }
  out.reverse();
  const newest = out.at(-1);
  if (newest && newest.windowMinutes >= 2880) {
    const start = Date.parse(newest.resetsAt) - newest.windowMinutes * 60000;
    const recent = out.filter(
      (r) =>
        Date.parse(newest.t) - Date.parse(r.t) <= 1800000 &&
        Math.abs(Date.parse(r.resetsAt) - r.windowMinutes * 60000 - start) <=
          300000,
    );
    const floor = Math.min(...recent.map((r) => 100 - r.remaining));
    while (out.length && 100 - out.at(-1).remaining > floor * 1.5 + 3)
      out.pop();
  }
  return out;
}
