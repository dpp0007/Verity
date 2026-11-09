import { getOwner, handle, rateLimit } from '@/server/api';
import { checkNow } from '@/server/monitoring';

export const POST = handle(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await getOwner(req);
  rateLimit(`check:${owner}`, 6);
  return checkNow(owner, (await params).id);
});
