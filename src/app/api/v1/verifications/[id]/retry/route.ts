import { NextResponse } from 'next/server';
import { getOwner, handle, rateLimit } from '@/server/api';
import { retryVerification } from '@/server/verifications';
import { toResult } from '@/server/serialize';

export const POST = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner(req);
  rateLimit(`verify:${owner}`, 10);
  const { id } = await params;
  return NextResponse.json(await toResult(await retryVerification(owner, id)), { status: 202 });
});
