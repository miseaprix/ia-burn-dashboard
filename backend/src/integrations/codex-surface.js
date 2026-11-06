import { stateStore } from '../storage/state-store.js';
import { surfaceBreakdown } from '../domain/quota.js';

export const SURFACE_MAX_AGE = 900000;

export function surfaceView(saved, now = Date.now()) {
  const age = saved?.lastSuccess == null ? Infinity : now - saved.lastSuccess;
  const data = age <= SURFACE_MAX_AGE ? saved?.value || null : null;
  return { data, status: { observedAt: saved?.lastSuccess == null ? null
    : new Date(saved.lastSuccess).toISOString(),
    stale: !!data && (age > 90000 || !!saved?.error),
    unavailable: !data, error: saved?.error || null } };
}

// Independent of quota snapshots: newer rate-limit logs contain no surfaces.
// Persist only normalized percent breakdowns, scoped to the account identity.
export async function collectSurface(key, token, fetchSurface, now = Date.now(), store = stateStore()) {
  const source = `surface:${key}`;
  let saved = store.collection(source);
  if (token && !(saved?.nextAttempt > now)) {
    store.saveCollection(source, { lastAttempt: now, nextAttempt: now + 60000 });
    try {
      const body = await fetchSurface();
      if (body?.units !== 'percent' || !Array.isArray(body.data))
        throw new Error('Invalid surface response');
      const data = surfaceBreakdown(body);
      // A valid empty response differs from a failed/unsupported response.
      if (body.data.length && !data) throw new Error('Invalid surface data');
      store.saveCollection(source, { value: data, lastSuccess: now, error: null });
    } catch {
      store.saveCollection(source, { error: 'Daily usage breakdown temporarily unavailable.' });
    }
    saved = store.collection(source);
  }
  return surfaceView(saved, now);
}
