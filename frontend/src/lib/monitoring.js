export const datasetLabels = { personal: 'Perso', enterprise: 'Enterprise', unclassified: 'Non classé' };
export const hourMs = 60 * 60 * 1000;

export function monitoringOffset(params, key) {
  const value = Number(params.get(key) ?? 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function monitoringUrl(page, changes = {}) {
  const params = new URLSearchParams(window.location.search);
  params.set('page', page);
  for (const [key, value] of Object.entries(changes)) {
    if (value == null || value === 0) params.delete(key);
    else params.set(key, value);
  }
  return `?${params}`;
}

export function monitoringListUrl(changes = {}) {
  return monitoringUrl('monitoring', {
    monitorSource: null, session: null, eventsOffset: null, modelOffset: null, ...changes,
  });
}

export function measuredSessionsUrl() {
  return monitoringListUrl({
    modelOnly: 1, monitorWindow: 'all', monitorFrom: null, monitorTo: null,
    sessionsOffset: null, requestsOffset: null,
  }) + '#monitor-sessions';
}
