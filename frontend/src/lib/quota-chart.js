// Port of macOS Usage.swift: drawn samples, recorded/forecast reading, pace crossings.
export function drawnQuotaSamples(window) {
  const actual = [...(window.samples || [])].sort(
    (a, b) => Date.parse(a.t) - Date.parse(b.t),
  );
  if (!actual.length) return [];
  if (Date.parse(actual[0].t) > Date.parse(window.start) + 90000)
    actual.unshift({ t: window.start, remaining: 100 });
  let previous = actual[0];
  const collapsed = [previous];
  for (const point of actual.slice(1)) {
    if (Math.abs(point.remaining - previous.remaining) >= 0.05) {
      if (collapsed.at(-1) !== previous) collapsed.push(previous);
      collapsed.push(point);
    }
    previous = point;
  }
  if (collapsed.at(-1) !== actual.at(-1)) collapsed.push(actual.at(-1));
  previous = collapsed[0];
  const drawn = [previous];
  for (const point of collapsed.slice(1)) {
    if (
      Date.parse(point.t) - Date.parse(previous.t) <= 7200000 &&
      Math.abs(point.remaining - previous.remaining) >= 0.05
    )
      drawn.push({ t: point.t, remaining: previous.remaining });
    drawn.push(point);
    previous = point;
  }
  return drawn;
}
export function interpolate(points, t) {
  if (!points.length) return null;
  if (t <= Date.parse(points[0].t)) return points[0].remaining;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      at = Date.parse(a.t),
      bt = Date.parse(b.t);
    if (t < bt)
      return a.remaining + ((b.remaining - a.remaining) * (t - at)) / (bt - at);
    if (t === bt) {
      let j = i;
      while (j + 1 < points.length && Date.parse(points[j + 1].t) === bt) j++;
      return points[j].remaining;
    }
  }
  return points.at(-1).remaining;
}
export function idealRemaining(window, t) {
  return Math.max(
    0,
    Math.min(
      100,
      100 *
        (1 -
          (t - Date.parse(window.start)) /
            (Date.parse(window.resetsAt) - Date.parse(window.start))),
    ),
  );
}
export function quotaReading(window, points, t, range = 'rte') {
  const last = window.samples.at(-1),
    observed = Date.parse(last?.t),
    projected = t > observed;
  const recorded = interpolate(points, t),
    f = window.forecast;
  let forecast = null;
  if (range === 'rte' && f && t >= observed) {
    const end = Date.parse(f.projectedEnd);
    forecast =
      t >= end
        ? f.projectedRemaining
        : last.remaining +
          ((f.projectedRemaining - last.remaining) * (t - observed)) /
            (end - observed);
  }
  const value = projected ? (forecast ?? recorded) : recorded;
  const ideal = idealRemaining(window, t);
  return {
    value,
    recorded,
    forecast,
    ideal,
    projected,
    delta: value == null ? null : value - ideal,
  };
}
export function quotaDeltaPoints(window, points) {
  const out = [];
  for (const p of points) {
    const point = { ...p, ideal: idealRemaining(window, Date.parse(p.t)) };
    point.delta = point.remaining - point.ideal;
    const a = out.at(-1);
    if (a && a.delta * point.delta < 0) {
      const t =
        Date.parse(a.t) +
        ((Date.parse(point.t) - Date.parse(a.t)) * a.delta) /
          (a.delta - point.delta);
      const v = idealRemaining(window, t);
      out.push({
        t: new Date(t).toISOString(),
        remaining: v,
        ideal: v,
        delta: 0,
      });
    }
    out.push(point);
  }
  return out;
}
