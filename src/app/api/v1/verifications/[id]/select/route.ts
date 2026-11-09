import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOwner, handle, readJson } from '@/server/api';
import { selectCandidate } from '@/server/verifications';
import { toResult } from '@/server/serialize';

export const POST = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner(req);
  const { id } = await params;
  const { candidate_id } = await readJson(req, z.object({ candidate_id: z.string().min(1) }));
  await selectCandidate(owner, id, candidate_id);
  return NextResponse.json(await toResult(id), { status: 202 });
});
