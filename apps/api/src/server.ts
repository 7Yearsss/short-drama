import 'dotenv/config';
import { buildApp } from './app.js';
import { ensureAdminExists } from './lib/seed-admin.js';

const app = buildApp();
const port = Number(process.env.PORT ?? 3001);

async function start() {
  await ensureAdminExists(app.prisma);
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`API listening on :${port}`);
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
