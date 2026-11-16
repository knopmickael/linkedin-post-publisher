import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const { app } = await createApp(config);
await app.listen({ host: '127.0.0.1', port: config.port });
console.log(JSON.stringify({ event: 'listening', url: config.origin }));
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  if (closing) return; closing = true;
  const timer = setTimeout(() => process.exit(1), 25000).unref();
  void app.close().then(() => { clearTimeout(timer); process.exit(0); });
});
