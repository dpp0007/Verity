import { db } from '@/lib/db';
import { sweepStale } from './serialize';
import { startJob } from './verify';
import { runScheduledRechecks } from './monitoring';

/**
 * Periodic upkeep, called by the Vercel cron (vercel.json): fails jobs that died with their function, re-drives jobs
 * that were queued but never started, and starts the scheduled re-checks of monitored records.
 */
export async function maintenance() {
  await sweepStale();
  const queued = await db.verification.findMany({ where: { state: 'queued', createdAt: { lt: new Date(Date.now() - 60_000) } }, select: { id: true }, take: 10 });
  for (const q of queued) startJob(q.id); // runVerification claims atomically, so a double start is a no-op
  return { requeued: queued.length, rechecks_started: await runScheduledRechecks() };
}
