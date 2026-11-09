import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { CreateVerificationBody } from '@/lib/schemas';
import { getOwner, handle, rateLimit, readJson } from '@/server/api';
import { createVerification } from '@/server/verifications';
import { toResult } from '@/server/serialize';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // seconds: the verification runs after the response (see startJob)

export const POST = handle(async (req) => {
  const owner = await getOwner(req);
  await rateLimit('verify', owner);
  const body = await readJson(req, CreateVerificationBody);
  const id = await createVerification(owner, body, { idempotencyKey: req.headers.get('idempotency-key')?.slice(0, 100) || null });
  return NextResponse.json(await toResult(id), { status: 202 });
});

export const GET = handle(async (req) => {
  const owner = await getOwner(req);
  const rows = await db.verification.findMany({ where: { ownerId: owner, kind: 'verify' }, orderBy: { createdAt: 'desc' }, take: 50 });
  return {
    verifications: rows.map((v) => ({
      id: v.id, name: v.name, record_type: v.recordType, country: v.country, region: v.region, state: v.state, outcome: v.outcome,
      status: v.resultJson ? JSON.parse(v.resultJson).record?.status ?? null : null, created_at: v.createdAt.toISOString(),
    })),
  };
});
