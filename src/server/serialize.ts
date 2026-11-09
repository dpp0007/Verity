import { db } from '@/lib/db';
import { VerificationResultSchema, type VerificationResult } from '@/lib/schemas';
import { registryOf } from './registry';
import type { StoredCandidate, StoredResult } from './verify';

const STALE_MS = 8 * 60_000; // routes allow 300 s (Vercel maxDuration), so a 'running' job older than this has died

/** Jobs that died with their process are surfaced as failed (retryable) instead of spinning forever. */
export async function sweepStale(id?: string) {
  const cutoff = new Date(Date.now() - STALE_MS);
  const stale = await db.verification.findMany({ where: { ...(id ? { id } : {}), state: 'running', updatedAt: { lt: cutoff } }, select: { id: true, ownerId: true } });
  for (const s of stale) {
    await db.verification.update({ where: { id: s.id }, data: { state: 'failed', outcome: 'failed', errorJson: JSON.stringify({ code: 'interrupted', message: 'The verification was interrupted before it finished. Retry to run it again.', retryable: true }) } });
  }
}

export async function toResult(id: string): Promise<VerificationResult | null> {
  await sweepStale(id);
  const v = await db.verification.findUnique({ where: { id }, include: { candidates: { orderBy: { createdAt: 'asc' } } } });
  if (!v) return null;
  const stored: StoredResult | null = v.resultJson ? JSON.parse(v.resultJson) : null;
  const reg = registryOf(v);
  const events = await db.activityEvent.findMany({ where: { ownerId: v.ownerId, refsJson: { contains: `"verification_id":"${v.id}"` } }, orderBy: { createdAt: 'asc' } });
  const mon = await db.monitor.findFirst({ where: { verificationId: v.id, ownerId: v.ownerId, status: { not: 'removed' } } });
  const out: VerificationResult = {
    id: v.id,
    state: v.state as VerificationResult['state'],
    stage: (v.stage as VerificationResult['stage']) ?? null,
    subject: { type: v.subjectType as 'person' | 'business', name: v.name },
    record: stored?.record ?? null,
    jurisdiction: { country: v.country, region: v.region },
    verification: {
      outcome: (v.outcome as VerificationResult['verification']['outcome']) ?? null,
      confidence: stored?.verification.confidence ?? null,
      confidence_reasons: stored?.verification.confidence_reasons ?? [],
      checked_at: stored?.verification.checked_at ?? null,
      source_name: stored?.verification.source_name ?? reg?.name ?? null,
      source_url: stored?.verification.source_url || null,
      evidence: stored?.verification.evidence ?? [],
      limitations: stored?.verification.limitations ?? [],
      matched_name: stored?.verification.matched_name ?? null,
    },
    candidates: v.state === 'awaiting_selection' || v.candidates.length > 1
      ? v.candidates.map((c) => { const d: StoredCandidate = JSON.parse(c.dataJson); return { id: c.id, ...d }; })
      : [],
    history: events.map((e) => ({ at: e.createdAt.toISOString(), type: e.type, message: e.message })),
    error: v.errorJson ? JSON.parse(v.errorJson) : null,
    monitoring: mon
      ? { enabled: mon.status === 'active', monitor_id: mon.id, status: (mon.status === 'removed' ? 'not_configured' : mon.status) as VerificationResult['monitoring']['status'] }
      : { enabled: false, monitor_id: null, status: 'not_configured' },
  };
  // Validate before returning; a malformed internal state must not leak out as a success.
  return VerificationResultSchema.parse(out);
}
