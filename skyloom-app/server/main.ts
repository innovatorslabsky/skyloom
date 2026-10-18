import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createAuth } from './auth.ts';
import { createWebServer } from './app.ts';

const env = process.env;
const secret = env.SKYLOOM_SECRET ?? '';
const dataDir = resolve(env.DATA_DIR ?? './data');
const staticDir = resolve(env.STATIC_DIR ?? join(dirname(process.argv[1] ?? '.'), '..', 'renderer'));
const port = Number(env.PORT ?? 3000);

let auth: ReturnType<typeof createAuth>;
try {
  auth = createAuth({
    user: env.SKYLOOM_USER ?? 'admin',
    ...(env.SKYLOOM_PASSWORD_HASH ? { passwordHash: env.SKYLOOM_PASSWORD_HASH } : {}),
    ...(env.SKYLOOM_PASSWORD ? { password: env.SKYLOOM_PASSWORD } : {}),
    secret,
  });
} catch (e) {
  console.error(`Cannot start: ${(e as Error).message}`);
  process.exit(1);
}
async function main(): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const { server } = createWebServer({ dataDir, staticDir, auth, secret });
  server.listen(port, '0.0.0.0', () => console.log(`Skyloom web listening on :${port} (data: ${dataDir})`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
main().catch((e: Error) => { console.error(`Cannot start: ${e.message}`); process.exit(1); });
