import {createContext, useContext} from 'react';

// Display label of the enterprise API source, served by GET /api/config.
export const DEFAULT_ENTERPRISE_LABEL = 'Enterprise';
export const EnterpriseContext = createContext(DEFAULT_ENTERPRISE_LABEL);
export function useEnterpriseLabel() {
  return useContext(EnterpriseContext) || DEFAULT_ENTERPRISE_LABEL;
}

// Data sources offered in the UI. Enterprise sources are hidden when
// GET /api/config reports enterprise.enabled === false (no gateway URL).
export const ALL_SOURCES = ['local', 'enterprise-local', 'enterprise'];
export function isEnterpriseEnabled(config) {
  return config?.enterprise?.enabled !== false;
}
export function availableSources(enabled) {
  return enabled ? ALL_SOURCES : ['local'];
}
export function resolveSource(source, enabled) {
  return availableSources(enabled).includes(source) ? source : 'local';
}
