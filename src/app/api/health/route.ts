import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { envIssues, isSimulatedProvider } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  let database = 'ok';
  try { await db.$queryRaw`SELECT 1`; } catch { database = 'unavailable'; }
  const issues = envIssues();
  const ok = database === 'ok' && issues.length === 0;
  return NextResponse.json({ status: ok ? 'ok' : 'degraded', database, config_issues: issues, provider: isSimulatedProvider() ? 'simulated' : 'tinyfish' }, { status: ok ? 200 : 503 });
}
