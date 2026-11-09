/**
 * Applies each prisma/migrations folder's migration.sql to the hosted libSQL (Turso) database, in order, once each.
 * `prisma migrate deploy` cannot run through a driver adapter, so production uses this instead:
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run db:migrate:turso
 * Also accepts a local file URL (file:./x.db), which is how it is tested.
 */
import './loadEnv';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';

(async () => {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) { console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for a remote database).'); process.exit(2); }
  const c = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  await c.execute('CREATE TABLE IF NOT EXISTS _verity_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((await c.execute('SELECT name FROM _verity_migrations')).rows.map((r) => String(r.name)));
  const dir = join(process.cwd(), 'prisma', 'migrations');
  let n = 0;
  for (const name of readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    if (done.has(name)) continue;
    await c.executeMultiple(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
    await c.execute({ sql: 'INSERT INTO _verity_migrations (name, applied_at) VALUES (?, ?)', args: [name, new Date().toISOString()] });
    console.log('applied', name); n++;
  }
  console.log(n ? `${n} migration(s) applied` : 'database is up to date');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
