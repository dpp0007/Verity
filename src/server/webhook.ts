import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { log } from '@/lib/log';
import { safeEqual } from './api';
import { processRun } from './monitoring';

const Payload = z.object({
  fetch_monitor_id: z.string(),
  id: z.string(),
  is_baseline: z.boolean().optional(),
  outcome: z.enum(['changed', 'unchanged', 'baseline']).nullable().optional(),
  diff: z.string().nullable().optional(),
  judgment: z.object({ is_relevant: z.boolean().nullable().optional(), error: z.string().nullable().optional(), summary: z.string().nullable().optional() }).nullable().optional(),
  results: z.array(z.object({ text: z.unknown().optional() }).passthrough()).default([]),
  errors: z.array(z.object({ url: z.string().optional(), error: z.string() }).passthrough()).default([]),
});

export async function handleMonitorWebhook(token: string | null, rawBody: string): Promise<{ status: number; body: object }> {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || !token || !safeEqual(secret, token)) throw new ApiError(401, 'invalid_webhook_token', 'Webhook token missing or invalid.');
  if (rawBody.length > 2_000_000) throw new ApiError(413, 'payload_too_large', 'Webhook body too large.');
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { throw new ApiError(400, 'invalid_json', 'Webhook body is not valid JSON.'); }
  if (json && typeof json === 'object' && 'search_monitor_id' in json) return { status: 202, body: { received: true, ignored: 'topic monitor events are not used' } };
  const p = Payload.parse(json);

  const monitor = await db.monitor.findUnique({ where: { providerId: p.fetch_monitor_id } });
  if (!monitor || monitor.status === 'removed') throw new ApiError(404, 'unknown_monitor', 'No monitor with that provider id.');

  const dedupeKey = `${p.fetch_monitor_id}:${p.id}`;
  try {
    await db.webhookEvent.create({ data: { dedupeKey } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { status: 200, body: { received: true, duplicate: true } };
    throw e;
  }
  try {
    const r = await processRun(monitor.id, { id: p.id, isBaseline: p.is_baseline, outcome: p.outcome, diff: p.diff, judgment: p.judgment, results: p.results, errors: p.errors }, 'webhook');
    return { status: 200, body: { received: true, outcome: r.outcome } };
  } catch (e) {
    await db.webhookEvent.delete({ where: { dedupeKey } }).catch(() => undefined); // let TinyFish's retry reprocess it
    log('error', 'webhook.failed', { dedupeKey, err: String(e) });
    throw e;
  }
}
