import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOwner, handle, rateLimit, readJson } from '@/server/api';
import { createMonitor, listMonitors } from '@/server/monitoring';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req) => ({ monitors: await listMonitors(await getOwner(req)) }));

export const POST = handle(async (req) => {
  const owner = await getOwner(req);
  await rateLimit('monitor', owner);
  const { verification_id } = await readJson(req, z.object({ verification_id: z.string().min(1) }));
  return NextResponse.json(await createMonitor(owner, verification_id), { status: 201 });
});
