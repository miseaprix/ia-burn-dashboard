import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { monitorRoutes } from './routes/monitor.js';
import { adminRoutes } from './routes/admin.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { ModelCalibration } from './services/model-calibration.js';
import { Collector } from './services/collector.js';
import { closeStateStores } from './storage/state-store.js';

function distDirectory() {
  if (process.env.FRONTEND_DIST) return process.env.FRONTEND_DIST;
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return [path.resolve(dir, '..', 'frontend', 'dist'),
    path.resolve(dir, '..', '..', 'frontend', 'dist')].find(existsSync);
}
export async function buildApp({ collector = new Collector(), logger = false, collect = false, calibration = new ModelCalibration() } = {}) {
  const app = Fastify({logger});
  await app.register(dashboardRoutes, {collector});
  await app.register(adminRoutes, {collector,calibration});
  await app.register(monitorRoutes);
  const dist = distDirectory();
  if (dist) {
    await app.register(fastifyStatic, {root: dist, prefix: '/'});
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({error: {message: 'Not found'}});
    });
  }
  app.addHook('onReady', async () => { if (collect) collector.start(); });
  app.addHook('onClose', async () => { await calibration.stop(); await collector.stop(); closeStateStores(); });
  return app;
}
