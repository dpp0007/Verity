import { getOwner, handle, rateLimit } from '@/server/api';
import { checkNow } from '@/server/monitoring';

export const maxDuration = 300; // seconds: the verification runs after the response (see startJob)

export const POST = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner(req);
  await rateLimit('check', owner);
  return checkNow(owner, (await params).id);
});
