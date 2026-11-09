import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getOwner, handle, rateLimit, readJson } from '@/server/api';
import { changeStatus, getMonitorView, removeMonitor } from '@/server/monitoring';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req, { params }: Ctx) => getMonitorView(await getOwner(req), (await params).id));

/** PATCH { status: "paused" | "active" } pauses or resumes the real TinyFish monitor. */
export const PATCH = handle(async (req, { params }: Ctx) => {
  const owner = await getOwner(req);
  rateLimit(`monitor:${owner}`, 30);
  const { status } = await readJson(req, z.object({ status: z.enum(['paused', 'active']) }));
  return changeStatus(owner, (await params).id, status === 'paused' ? 'pause' : 'resume');
});

export const DELETE = handle(async (req, { params }: Ctx) => {
  await removeMonitor(await getOwner(req), (await params).id);
  return new NextResponse(null, { status: 204 });
});
