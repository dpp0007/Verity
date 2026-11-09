import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { ApiError, errorBody } from '@/lib/errors';
import { log } from '@/lib/log';

const MAX_BODY = 64 * 1024;
const hits = new Map<string, number[]>();

/** In-memory sliding window; per-process (see README for multi-instance deployments). */
export function rateLimit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new ApiError(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.', undefined, true);
  arr.push(now);
  hits.set(key, arr);
}

export const safeEqual = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest(), y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

/** Anonymous cookie owner for the web UI, or a bearer key for programmatic access. Data is isolated per owner. */
export async function getOwner(req: Request): Promise<string> {
  const auth = req.headers.get('authorization');
  if (auth) {
    const key = auth.replace(/^Bearer\s+/i, '');
    const allowed = (process.env.VERITY_API_KEYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!allowed.some((k) => safeEqual(k, key))) throw new ApiError(401, 'invalid_api_key', 'Invalid or missing API key.');
    return 'key_' + createHash('sha256').update(key).digest('hex').slice(0, 16);
  }
  const jar = await cookies();
  const existing = jar.get('verity_owner')?.value;
  if (existing && /^own_[a-f0-9]{32}$/.test(existing)) return existing;
  const id = 'own_' + randomUUID().replace(/-/g, '');
  jar.set('verity_owner', id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 24 * 365 });
  return id;
}

export async function readJson<S extends ZodTypeAny>(req: Request, schema: S): Promise<z.output<S>> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new ApiError(413, 'payload_too_large', 'Request body too large.');
  let json: unknown;
  try { json = text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, 'invalid_json', 'Request body is not valid JSON.'); }
  return schema.parse(json);
}

type Handler<C> = (req: Request, ctx: C) => Promise<Response | unknown>;

/** Consistent error responses + cross-origin write protection for cookie-authenticated calls. */
export function handle<C = unknown>(fn: Handler<C>) {
  return async (req: Request, ctx: C) => {
    try {
      if (!['GET', 'HEAD'].includes(req.method) && !req.headers.get('authorization')) {
        const origin = req.headers.get('origin');
        if (origin && new URL(origin).host !== req.headers.get('host')) throw new ApiError(403, 'forbidden_origin', 'Cross-origin request refused.');
      }
      const out = await fn(req, ctx);
      return out instanceof Response ? out : NextResponse.json(out);
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json(errorBody(e), { status: e.status });
      if (e instanceof ZodError) {
        return NextResponse.json({ error: { code: 'validation_error', message: e.issues[0]?.message ?? 'Invalid input', retryable: false, details: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }, { status: 400 });
      }
      log('error', 'api.unhandled', { path: new URL(req.url).pathname, err: String(e) });
      return NextResponse.json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Try again shortly.', retryable: true, details: null } }, { status: 500 });
    }
  };
}
