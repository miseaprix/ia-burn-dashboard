// Compile-time switch: production never uses the synthetic transport.
export const DEMO = import.meta.env?.VITE_BURN_DEMO === 'true';
