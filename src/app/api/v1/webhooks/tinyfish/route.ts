import { NextResponse } from 'next/server';
import { handle } from '@/server/api';
import { handleMonitorWebhook } from '@/server/webhook';

export const dynamic = 'force-dynamic';

// TinyFish documents no webhook signature, so the shared secret travels in the URL we register
// (?token=WEBHOOK_SECRET) and every delivery is deduplicated. See docs/TINYFISH.md.
export const POST = handle(async (req) => {
  const out = await handleMonitorWebhook(new URL(req.url).searchParams.get('token'), await req.text());
  return NextResponse.json(out.body, { status: out.status });
});
