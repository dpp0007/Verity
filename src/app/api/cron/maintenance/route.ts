import { NextResponse } from 'next/server';
import { safeEqual } from '@/server/api';
import { maintenance } from '@/server/maintenance';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Vercel Cron calls this with `Authorization: Bearer $CRON_SECRET`. Without the secret set, the route refuses everything.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Not authorised.', retryable: false, details: null } }, { status: 401 });
  }
  return NextResponse.json(await maintenance());
}
