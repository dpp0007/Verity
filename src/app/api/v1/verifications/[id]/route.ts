import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { getOwner, handle } from '@/server/api';
import { toResult } from '@/server/serialize';
import { deleteVerification } from '@/server/verifications';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner(req);
  const { id } = await params;
  const own = await db.verification.findFirst({ where: { id, ownerId: owner }, select: { id: true } });
  const r = own ? await toResult(id) : null;
  if (!r) throw new ApiError(404, 'not_found', 'Verification not found');
  return r;
});

export const DELETE = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  await deleteVerification(await getOwner(req), (await params).id);
  return { deleted: true };
});
