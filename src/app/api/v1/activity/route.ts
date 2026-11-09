import { db } from '@/lib/db';
import { getOwner, handle } from '@/server/api';
import { listAlerts } from '@/server/monitoring';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => {
  const owner = await getOwner(req);
  const [events, alerts] = await Promise.all([
    db.activityEvent.findMany({ where: { ownerId: owner }, orderBy: { createdAt: 'desc' }, take: 100 }),
    listAlerts(owner),
  ]);
  return {
    events: events.map((e) => ({ id: e.id, type: e.type, message: e.message, refs: JSON.parse(e.refsJson), at: e.createdAt.toISOString() })),
    alerts,
  };
});
