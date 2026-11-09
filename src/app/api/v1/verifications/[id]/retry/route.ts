import { NextResponse } from 'next/server';
import { getOwner, handle, rateLimit } from '@/server/api';
import { retryVerification } from '@/server/verifications';
import { toResult } from '@/server/serialize';

export const maxDuration = 300; // seconds: the verification runs after the response (see startJob)

export const POST = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner(req);
  await rateLimit('verify', owner);
  const { id } = await params;
  return NextResponse.json(await toResult(await retryVerification(owner, id)), { status: 202 });
});
