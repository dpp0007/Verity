/**
 * Background worker. The web process already runs jobs in-process; this worker re-drives jobs that were
 * queued but never started (e.g. after a restart or on serverless hosts) and fails jobs that died mid-run.
 *   npm run worker
 */
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { sweepStale } from '@/server/serialize';
import { settleJobs, startJob } from '@/server/verify';

const EVERY_MS = 5000;

async function tick() {
  await sweepStale();
  const queued = await db.verification.findMany({ where: { state: 'queued', createdAt: { lt: new Date(Date.now() - 10_000) } }, select: { id: true }, take: 10 });
  for (const q of queued) startJob(q.id); // runVerification claims atomically, so a double start is a no-op
  await settleJobs();
}

async function main() {
  log('info', 'worker.started');
  for (;;) {
    try { await tick(); } catch (e) { log('error', 'worker.tick_failed', { err: String(e) }); }
    await new Promise((r) => setTimeout(r, EVERY_MS));
  }
}
main();
