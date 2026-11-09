import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';

/** Fresh SQLite file per run, built by applying the real migrations (also exercises `migrate deploy`). */
export default function setup() {
  for (const f of ['test.db', 'test.db-journal']) rmSync(`prisma/${f}`, { force: true });
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: 'file:./test.db' }, stdio: 'pipe' });
}
