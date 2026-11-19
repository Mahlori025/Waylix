import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.ts';
import { HazardService } from './service.ts';
import { Store } from './store.ts';

const port = Number(process.env.PORT ?? 8787);
const dbPath = process.env.WAYLIX_DB ?? './data/waylix.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });

const store = new Store(dbPath);
const t0 = Date.now();
const service = new HazardService(store);
console.log(`[waylix] replayed event log in ${Date.now() - t0} ms`, service.stats());

const server = createApp(service, {
  apiKeys: (process.env.WAYLIX_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  rateLimitPerMin: Number(process.env.WAYLIX_RATE_LIMIT ?? 240),
  ...(process.env.WAYLIX_CORS_ORIGIN ? { corsOrigin: process.env.WAYLIX_CORS_ORIGIN } : {}),
});

const sweeper = setInterval(() => {
  const n = service.sweep();
  if (n) console.log(`[waylix] decay sweep: ${n} hazards changed status`);
}, 5 * 60_000);
sweeper.unref();

server.listen(port, () => console.log(`[waylix] API listening on http://0.0.0.0:${port}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
