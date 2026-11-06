import { buildApp } from './app.js';
const app = await buildApp({logger: true, collect: true});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
try {
  await app.listen({port: Number(process.env.PORT) || 8080, host: '0.0.0.0'});
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
