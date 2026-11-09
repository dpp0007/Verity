import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { ApiError } from '@/lib/errors';
import { registryOf } from './registry';
import { isOfficialUrl } from '@/lib/url';
import { detectChanges } from '@/lib/changes';
import { canTransition, targetStatus, type MonitorStatus } from '@/lib/monitorState';
import type { NormalizedRecord } from '@/lib/schemas';
import { TinyFishError } from '@/tinyfish/errors';
import { createPageMonitor, deleteMonitor, getMonitor, runMonitorNow, setMonitorStatus, type ProviderRun } from '@/tinyfish/monitor';
import { activity, newId } from './activity';
import { startJob, type StoredResult } from './verify';

const CRON = '0 6 * * *'; // daily, UTC
const RECHECK_COOLDOWN_MS = 10 * 60_000;

export interface RunInput {
  id: string;
  isBaseline?: boolean;
  /** Present on scheduled webhook deliveries only; "run now" responses carry no change judgement. */
  outcome?: 'baseline' | 'unchanged' | 'changed' | null;
  diff?: string | null;
  judgment?: { is_relevant?: boolean | null; error?: string | null; summary?: string | null } | null;
  results: Array<{ text?: unknown }>;
  errors: Array<{ url?: string; error: string }>;
}

const toStatus = (s: string): MonitorStatus => (s === 'cancelled' ? 'failed' : (s as MonitorStatus));
const hashText = (t: string) => createHash('sha256').update(t.replace(/\s+/g, ' ').trim()).digest('hex');
const pageText = (r: RunInput) => r.results.map((x) => (typeof x.text === 'string' ? x.text : '')).join('\n').trim();

function webhookUrl(): string | undefined {
  const e = env();
  if (!e.WEBHOOK_SECRET) return undefined;
  const u = new URL(e.APP_URL);
  if (u.protocol !== 'https:' || u.hostname === 'localhost' || /^[\d.]+$/.test(u.hostname)) return undefined; // unreachable from TinyFish
  return `${u.origin}/api/v1/webhooks/tinyfish?token=${encodeURIComponent(e.WEBHOOK_SECRET)}`;
}

export function purposeFor(fields: string[], name: string): string {
  return `Track changes to the official ${fields.join(', ')} for this specific registered subject (${name}). Report changes to these fields and distinguish them from page-layout, navigation or cookie-banner changes.`;
}

export async function createMonitor(ownerId: string, verificationId: string) {
  const v = await db.verification.findFirst({ where: { id: verificationId, ownerId }, include: { candidates: true } });
  if (!v) throw new ApiError(404, 'not_found', 'Verification not found');
  const stored: StoredResult | null = v.resultJson ? JSON.parse(v.resultJson) : null;
  const reg = registryOf(v);
  if (v.state !== 'completed' || !stored?.record || !reg || !['verified', 'partially_verified'].includes(v.outcome ?? '')) {
    throw new ApiError(422, 'monitoring_unsupported', 'Only a completed verification that identified a record can be monitored.');
  }
  const src = stored.verification.source_url;
  if (!isOfficialUrl(src, reg.domains) || src === reg.searchEntry) {
    throw new ApiError(422, 'monitoring_unsupported', 'This record has no direct official record URL, so a page monitor cannot track it.');
  }
  const cand = v.candidates.find((c) => c.selected) ?? (v.candidates.length === 1 ? v.candidates[0] : null);
  if (!cand) throw new ApiError(422, 'monitoring_unsupported', 'The monitored record could not be identified unambiguously.');

  const dedupeKey = `${ownerId}:${verificationId}`;
  const fields = ['licence/registration status', ...(reg.availableFields.includes('expiry_date') ? ['expiry information'] : []), ...(reg.availableFields.includes('disciplinary_actions') ? ['disciplinary information'] : [])];
  const purpose = purposeFor(fields, v.name);
  const mid = newId('mon');
  try {
    await db.monitor.create({
      data: {
        id: mid, ownerId, verificationId, dedupeKey, status: 'creating', scheduleCron: CRON, configJson: '{}', purpose,
        subjectName: v.name, recordType: v.recordType, country: v.country, region: v.region, registryName: reg.name, sourceUrl: src,
        baselineJson: JSON.stringify(stored.record), currentStatus: stored.record.status,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const existing = await db.monitor.findUnique({ where: { dedupeKey } });
      throw new ApiError(409, 'monitor_exists', 'This record is already on the watchlist.', { monitor_id: existing?.id });
    }
    throw e;
  }

  const hook = webhookUrl();
  try {
    const { monitor, baseline } = await createPageMonitor({ name: `Verity: ${v.name} (${reg.id})`, url: src, scheduleCron: CRON, purpose, webhookUrl: hook });
    const baselineOk = baseline.errors.length === 0 && baseline.results.some((r) => typeof r.text === 'string' && r.text.trim());
    const text = baseline.results.map((x) => (typeof x.text === 'string' ? x.text : '')).join('\n');
    await db.monitor.update({
      where: { id: mid },
      data: {
        providerId: monitor.id, status: toStatus(monitor.status), webhookUrl: monitor.webhook_url ?? null, webhookActive: !!hook && !!monitor.webhook_url,
        configJson: JSON.stringify({ provider: monitor.config, candidate: JSON.parse(cand.dataJson), textHash: baselineOk ? hashText(text) : null }),
        lastCheckedAt: new Date(), lastSuccessAt: baselineOk ? new Date() : null, lastError: baselineOk ? null : `Baseline run reported: ${baseline.errors[0]?.error ?? 'empty content'}`,
      },
    });
    await db.monitorRun.create({ data: { id: newId('mrun'), monitorId: mid, providerRunId: baseline.id, source: 'baseline', outcome: baselineOk ? 'baseline' : 'error', ok: baselineOk, error: baselineOk ? null : baseline.errors[0]?.error ?? 'empty content' } });
    await activity(ownerId, 'monitor.created', `Monitor created for ${v.name}${hook ? '' : ' (webhook not configured: changes are detected only on manual checks)'}`, { verification_id: verificationId, monitor_id: mid, provider_id: monitor.id });
  } catch (e) {
    await db.monitor.delete({ where: { id: mid } }).catch(() => undefined);
    await activity(ownerId, 'monitor.create_failed', `Monitor creation failed: ${e instanceof Error ? e.message : 'error'}`, { verification_id: verificationId });
    log('error', 'monitor.create_failed', { verificationId, err: String(e) });
    if (e instanceof TinyFishError) {
      throw new ApiError(e.kind === 'billing' ? 402 : e.kind === 'auth' ? 502 : 502, `provider_${e.kind}`, `TinyFish could not create the monitor: ${e.message}`, { request_id: e.opts.requestId }, e.retryable);
    }
    throw e;
  }
  return monitorView((await db.monitor.findUniqueOrThrow({ where: { id: mid } })).id);
}

async function owned(ownerId: string, id: string) {
  const m = await db.monitor.findFirst({ where: { id, ownerId } });
  if (!m || m.status === 'removed') throw new ApiError(404, 'not_found', 'Monitor not found');
  return m;
}

export async function monitorView(id: string) {
  const m = await db.monitor.findUniqueOrThrow({ where: { id }, include: { alerts: { orderBy: { detectedAt: 'desc' }, take: 1 }, runs: { orderBy: { createdAt: 'desc' }, take: 10 } } });
  const a = m.alerts[0];
  return {
    id: m.id, verification_id: m.verificationId, provider_monitor_id: m.providerId, status: m.status as MonitorStatus,
    subject: { name: m.subjectName }, record_type: m.recordType, jurisdiction: { country: m.country, region: m.region },
    registry_name: m.registryName, source_url: m.sourceUrl, current_status: m.currentStatus,
    schedule_cron: m.scheduleCron, purpose: m.purpose, webhook_active: m.webhookActive,
    last_checked_at: m.lastCheckedAt?.toISOString() ?? null, last_success_at: m.lastSuccessAt?.toISOString() ?? null,
    last_change_at: m.lastChangeAt?.toISOString() ?? null, last_error: m.lastError, created_at: m.createdAt.toISOString(),
    latest_alert: a ? { id: a.id, field: a.field, previous: a.previous, next: a.next, detected_at: a.detectedAt.toISOString() } : null,
    runs: m.runs.map((r) => ({ id: r.id, provider_run_id: r.providerRunId, source: r.source, outcome: r.outcome, ok: r.ok, error: r.error, at: r.createdAt.toISOString() })),
  };
}

export async function listMonitors(ownerId: string) {
  const ms = await db.monitor.findMany({ where: { ownerId, status: { not: 'removed' } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  return Promise.all(ms.map((m) => monitorView(m.id)));
}

/** Reads one monitor and reconciles it with TinyFish (handles provider-side deletion). */
export async function getMonitorView(ownerId: string, id: string) {
  const m = await owned(ownerId, id);
  if (m.providerId) {
    try {
      const p = await getMonitor(m.providerId);
      await db.monitor.update({ where: { id }, data: { status: toStatus(p.status), lastError: p.last_error ?? m.lastError } });
    } catch (e) {
      if (e instanceof TinyFishError && e.kind === 'not_found') {
        await db.monitor.update({ where: { id }, data: { status: 'failed', lastError: 'This monitor no longer exists at TinyFish. Remove it and add the record again.' } });
      } // other errors: keep last known state, do not invent one
    }
  }
  return monitorView(id);
}

export async function changeStatus(ownerId: string, id: string, action: 'pause' | 'resume') {
  const m = await owned(ownerId, id);
  if (!m.providerId || !canTransition(m.status as MonitorStatus, action)) throw new ApiError(409, 'invalid_state', `Cannot ${action} a monitor that is ${m.status}.`);
  try {
    const p = await setMonitorStatus(m.providerId, targetStatus(action) === 'paused' ? 'paused' : 'active');
    await db.monitor.update({ where: { id }, data: { status: toStatus(p.status) } });
  } catch (e) { throw providerToApi(e); }
  await activity(ownerId, `monitor.${action}d`, `Monitor ${action}d for ${m.subjectName}`, { monitor_id: id });
  return monitorView(id);
}

export async function removeMonitor(ownerId: string, id: string) {
  const m = await owned(ownerId, id);
  if (!canTransition(m.status as MonitorStatus, 'remove')) throw new ApiError(409, 'invalid_state', 'Monitor cannot be removed in its current state.');
  try { if (m.providerId) await deleteMonitor(m.providerId); } catch (e) { throw providerToApi(e); }
  await db.monitor.update({ where: { id }, data: { status: 'removed', dedupeKey: null, providerId: null } });
  await activity(ownerId, 'monitor.removed', `Monitor removed for ${m.subjectName}`, { monitor_id: id });
}

export async function checkNow(ownerId: string, id: string) {
  const m = await owned(ownerId, id);
  if (!m.providerId || !canTransition(m.status as MonitorStatus, 'check')) throw new ApiError(409, 'invalid_state', `Cannot run a check while the monitor is ${m.status}.`);
  let run: ProviderRun;
  try { run = await runMonitorNow(m.providerId); } catch (e) {
    await db.monitorRun.create({ data: { id: newId('mrun'), monitorId: id, source: 'manual', outcome: 'error', ok: false, error: e instanceof Error ? e.message : 'error' } });
    await db.monitor.update({ where: { id }, data: { lastCheckedAt: new Date(), lastError: e instanceof Error ? e.message : 'Check failed' } });
    await activity(ownerId, 'monitor.check_failed', `Monitoring check failed for ${m.subjectName}`, { monitor_id: id });
    throw providerToApi(e);
  }
  await processRun(id, { id: run.id, isBaseline: run.is_baseline, results: run.results, errors: run.errors }, 'manual');
  return monitorView(id);
}

function providerToApi(e: unknown): unknown {
  if (e instanceof TinyFishError) return new ApiError(e.kind === 'billing' ? 402 : e.kind === 'not_found' ? 404 : 502, `provider_${e.kind}`, e.message, { request_id: e.opts.requestId }, e.retryable);
  return e;
}

/**
 * Single entry point for webhook deliveries and manual checks.
 * A page change alone never creates an alert: it only triggers a fresh verification of the record,
 * and alerts come from field-level differences in that verified result.
 */
export async function processRun(monitorId: string, r: RunInput, source: 'webhook' | 'manual') {
  const m = await db.monitor.findUniqueOrThrow({ where: { id: monitorId } });
  const now = new Date();
  const text = pageText(r);
  const cfg = JSON.parse(m.configJson);
  const mk = (outcome: string, ok: boolean, error?: string | null) =>
    db.monitorRun.create({ data: { id: newId('mrun'), monitorId, providerRunId: r.id, source, outcome, ok, error: error ?? null, diff: r.diff?.slice(0, 20_000) ?? null } });

  if (r.errors.length || !text) {
    const msg = r.errors[0] ? `${r.errors[0].error}${r.errors[0].url ? ` (${r.errors[0].url})` : ''}` : 'The page returned no content';
    await mk('error', false, msg);
    await db.monitor.update({ where: { id: monitorId }, data: { lastCheckedAt: now, lastError: msg } });
    await activity(m.ownerId, 'monitor.check_failed', `Monitoring check failed for ${m.subjectName}: ${msg}`, { monitor_id: monitorId, run_id: r.id });
    return { alert: false, outcome: 'error' };
  }

  const hash = hashText(text);
  const changed = r.outcome ? r.outcome === 'changed' : !r.isBaseline && !!cfg.textHash && cfg.textHash !== hash;
  await db.monitor.update({ where: { id: monitorId }, data: { lastCheckedAt: now, lastSuccessAt: now, lastError: null, configJson: JSON.stringify({ ...cfg, textHash: hash }) } });

  if (!changed) {
    await mk(r.isBaseline || r.outcome === 'baseline' ? 'baseline' : 'unchanged', true);
    await activity(m.ownerId, 'monitor.check_completed', `Monitoring check completed for ${m.subjectName}: no change`, { monitor_id: monitorId, run_id: r.id });
    return { alert: false, outcome: 'unchanged' };
  }
  if (r.judgment && r.judgment.is_relevant === false) {
    await mk('irrelevant_change', true);
    await activity(m.ownerId, 'monitor.check_completed', `Page changed for ${m.subjectName} but TinyFish judged it unrelated to the monitored fields`, { monitor_id: monitorId, run_id: r.id });
    return { alert: false, outcome: 'irrelevant_change' };
  }

  const recent = await db.verification.findFirst({ where: { monitorId, kind: 'recheck', createdAt: { gt: new Date(Date.now() - RECHECK_COOLDOWN_MS) } } });
  if (recent) {
    await mk('unchanged', true);
    return { alert: false, outcome: 'recheck_throttled' };
  }
  await mk('recheck_pending', true);
  const vid = newId('ver');
  const base = await db.verification.findUniqueOrThrow({ where: { id: m.verificationId } });
  await db.verification.create({
    data: {
      id: vid, ownerId: m.ownerId, kind: 'recheck', monitorId, parentId: base.id, subjectType: base.subjectType, name: base.name, recordType: base.recordType,
      country: base.country, region: base.region, licenseNumber: base.licenseNumber, sourceUrlInput: null, inputHash: base.inputHash, registryId: base.registryId, registryJson: base.registryJson, state: 'queued',
      candidates: { create: { id: newId('cand'), dataJson: JSON.stringify(cfg.candidate), selected: true } },
    },
  });
  await activity(m.ownerId, 'monitor.check_completed', `Page change detected for ${m.subjectName}; re-verifying the record`, { monitor_id: monitorId, run_id: r.id, verification_id: vid });
  startJob(vid);
  return { alert: false, outcome: 'recheck_started' };
}

/** Called when a re-verification started by a monitor finishes. */
export async function onRecheckFinished(verificationId: string) {
  const v = await db.verification.findUnique({ where: { id: verificationId } });
  if (!v?.monitorId) return;
  const m = await db.monitor.findUnique({ where: { id: v.monitorId } });
  if (!m || m.status === 'removed') return;
  const pending = await db.monitorRun.findFirst({ where: { monitorId: m.id, outcome: 'recheck_pending' }, orderBy: { createdAt: 'desc' } });
  const stored: StoredResult | null = v.resultJson ? JSON.parse(v.resultJson) : null;
  const next = stored?.record ?? null;

  if (v.state !== 'completed' || !next || !['verified', 'partially_verified'].includes(v.outcome ?? '')) {
    const msg = v.errorJson ? JSON.parse(v.errorJson).message : 'Re-verification was inconclusive';
    if (pending) await db.monitorRun.update({ where: { id: pending.id }, data: { outcome: 'error', ok: false, error: msg } });
    await db.monitor.update({ where: { id: m.id }, data: { lastError: msg } });
    await activity(m.ownerId, 'monitor.check_failed', `Re-verification failed for ${m.subjectName}; no change recorded`, { monitor_id: m.id, verification_id: v.id });
    return;
  }
  const prev: NormalizedRecord = JSON.parse(m.baselineJson);
  const changes = detectChanges(prev, next);
  if (pending) await db.monitorRun.update({ where: { id: pending.id }, data: { outcome: changes.length ? 'changed' : 'unchanged' } });
  if (!changes.length) {
    await db.monitor.update({ where: { id: m.id }, data: { lastError: null } });
    return;
  }
  const evidence = JSON.stringify({ verification_id: v.id, confidence: stored!.verification.confidence, excerpts: stored!.verification.evidence, diff: pending ? (await db.monitorRun.findUnique({ where: { id: pending.id } }))?.diff ?? null : null });
  for (const c of changes) {
    await db.alert.create({ data: { id: newId('alert'), monitorId: m.id, ownerId: m.ownerId, field: c.field, previous: c.previous, next: c.next, sourceUrl: stored!.verification.source_url, evidenceJson: evidence, runId: pending?.providerRunId ?? null } });
    await activity(m.ownerId, 'status_change.detected', `${m.subjectName}: ${c.field} changed ${c.previous ?? '—'} → ${c.next ?? '—'}`, { monitor_id: m.id, verification_id: v.id, run_id: pending?.providerRunId });
  }
  await db.monitor.update({ where: { id: m.id }, data: { baselineJson: JSON.stringify(next), currentStatus: next.status, lastChangeAt: new Date(), lastError: null } });
}

export async function listAlerts(ownerId: string, limit = 50) {
  const rows = await db.alert.findMany({ where: { ownerId }, orderBy: { detectedAt: 'desc' }, take: limit, include: { monitor: { select: { subjectName: true } } } });
  return rows.map((a) => ({
    id: a.id, monitor_id: a.monitorId, subject: a.monitor.subjectName, field: a.field, previous: a.previous, next: a.next,
    source_url: a.sourceUrl, detected_at: a.detectedAt.toISOString(), run_id: a.runId, evidence: JSON.parse(a.evidenceJson),
  }));
}
