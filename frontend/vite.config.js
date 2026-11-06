import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';

// base:'./' makes the built assets load from any path (SPA served by Fastify).
export default defineConfig({
  plugins: [react()],
  resolve: {alias: {'virtual:burn-api': fileURLToPath(new URL(process.env.VITE_BURN_DEMO === 'true' ? './src/demo/transport.js' : './src/lib/live-api.js', import.meta.url))}},
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    // During `vite dev`, proxy API calls to the backend.
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
