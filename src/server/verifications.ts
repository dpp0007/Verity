import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { KNOWN_BLOCKED, findRegistry, isOfficialRegistryUrl, supportMessage } from '@/lib/registries';
import { isOfficialUrl } from '@/lib/url';
import type { CreateVerificationInput } from '@/lib/schemas';
import { activity, newId } from './activity';
import { startJob } from './verify';

const inputHash = (i: CreateVerificationInput) =>
  createHash('sha256').update(JSON.stringify([i.name.toLowerCase().replace(/\s+/g, ' '), i.subject_type, i.record_type, i.country, i.region, i.license_number, i.source_url])).digest('hex');

export async function createVerification(ownerId: string, input: CreateVerificationInput, opts: { idempotencyKey?: string | null; parentId?: string } = {}) {
  const reg = findRegistry(input.country, input.region, input.record_type);
  // Company registers are supported worldwide: with no configured registry the job discovers the country's official one.
  const dynamic = !reg && input.record_type === 'company_registration';
  const blocked = KNOWN_BLOCKED[`${input.country}:${input.record_type}`];
  if (!reg && blocked) throw new ApiError(422, 'unsupported_jurisdiction', blocked);
  if (!reg && !dynamic) {
    const types = ['medical_license', 'contractor_license', 'company_registration'];
    throw new ApiError(422, types.includes(input.record_type) ? 'unsupported_jurisdiction' : 'unsupported_record_type', supportMessage(input.country, input.region, input.record_type));
  }
  if (reg?.blocked && process.env.VERITY_IGNORE_BLOCKED_REGISTRIES !== '1' && !(input.license_number && reg.profileUrl?.(input.license_number))) throw new ApiError(422, 'registry_unavailable', reg.blocked);
  if (reg?.requiresEnv?.some((k) => !process.env[k])) {
    throw new ApiError(422, 'registry_not_configured', `${reg.name} needs a licensed data-provider account: set ${reg.requiresEnv.join(' and ')} in the server environment.`);
  }
  const subjectType = reg ? reg.subjectType : 'business';
  if (subjectType !== input.subject_type) throw new ApiError(422, 'validation_error', `${input.record_type} records are held for a ${subjectType}, not a ${input.subject_type}.`);
  if (input.source_url && !(reg ? isOfficialUrl(input.source_url, reg.domains) : isOfficialRegistryUrl(input.source_url))) {
    throw new ApiError(422, 'invalid_source_url', reg ? `The source URL must be an https URL on an approved official domain for this registry (${reg.domains.join(', ')}).` : 'The source URL must be an https URL on a government or recognised official register domain.');
  }
  const hash = inputHash(input);

  if (opts.idempotencyKey) {
    const dup = await db.verification.findUnique({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: opts.idempotencyKey } } });
    if (dup) return dup.id;
  }
  // Same search already in flight: return it instead of paying for a duplicate agent run.
  const inflight = await db.verification.findFirst({ where: { ownerId, inputHash: hash, kind: 'verify', state: { in: ['queued', 'running'] } } });
  if (inflight) return inflight.id;

  const id = newId('ver');
  try {
    await db.verification.create({
      data: {
        id, ownerId, parentId: opts.parentId, subjectType: input.subject_type, name: input.name, recordType: input.record_type, country: input.country, region: input.region,
        licenseNumber: input.license_number, sourceUrlInput: input.source_url, inputHash: hash, idempotencyKey: opts.idempotencyKey ?? null, registryId: reg ? reg.id : `dyn-${input.country}`, state: 'queued',
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && opts.idempotencyKey) {
      const dup = await db.verification.findUniqueOrThrow({ where: { ownerId_idempotencyKey: { ownerId, idempotencyKey: opts.idempotencyKey } } });
      return dup.id;
    }
    throw e;
  }
  await activity(ownerId, 'verification.requested', `Verification requested for ${input.name} (${reg ? reg.name : 'registry to be discovered'})`, { verification_id: id, registry_id: reg ? reg.id : `dyn-${input.country}` });
  startJob(id);
  return id;
}

export async function retryVerification(ownerId: string, id: string) {
  const v = await db.verification.findFirst({ where: { id, ownerId, kind: 'verify' } });
  if (!v) throw new ApiError(404, 'not_found', 'Verification not found');
  if (['queued', 'running'].includes(v.state)) throw new ApiError(409, 'invalid_state', 'This verification is still running.');
  return createVerification(ownerId, {
    name: v.name, subject_type: v.subjectType as 'person' | 'business', record_type: v.recordType as CreateVerificationInput['record_type'],
    country: v.country, region: v.region, license_number: v.licenseNumber, source_url: v.sourceUrlInput,
  }, { parentId: v.id });
}

export async function selectCandidate(ownerId: string, id: string, candidateId: string) {
  const v = await db.verification.findFirst({ where: { id, ownerId }, include: { candidates: true } });
  if (!v) throw new ApiError(404, 'not_found', 'Verification not found');
  if (v.state !== 'awaiting_selection') throw new ApiError(409, 'invalid_state', 'This verification is not waiting for a selection.');
  const c = v.candidates.find((x) => x.id === candidateId);
  if (!c) throw new ApiError(404, 'candidate_not_found', 'Candidate does not belong to this verification.');
  // Atomic claim so a double-click cannot start two detail runs.
  const claimed = await db.verification.updateMany({ where: { id, state: 'awaiting_selection' }, data: { state: 'queued', outcome: null, resultJson: null } });
  if (claimed.count === 0) throw new ApiError(409, 'invalid_state', 'A selection was already made.');
  await db.candidate.update({ where: { id: c.id }, data: { selected: true } });
  await activity(ownerId, 'candidate.selected', `Candidate selected: ${JSON.parse(c.dataJson).full_name}`, { verification_id: id, candidate_id: c.id });
  startJob(id);
}
