import { env } from '@/lib/env';
import { log } from '@/lib/log';
import { TinyFishError, kindFromStatus } from './errors';

export const urls = () => ({
  search: process.env.TINYFISH_SEARCH_URL || 'https://api.search.tinyfish.ai',
  fetch: process.env.TINYFISH_FETCH_URL || 'https://api.fetch.tinyfish.ai',
  agent: process.env.TINYFISH_AGENT_URL || 'https://agent.tinyfish.ai',
});

interface ReqOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
  /** Bounded retries for 429/5xx/network errors. Use 0 for non-idempotent calls that must not duplicate. */
  retries?: number;
}

/** The only place the API key is attached. Auth header per docs: X-API-Key. */
export async function tfRequest<T = unknown>(base: string, path: string, o: ReqOpts = {}): Promise<{ data: T; requestId?: string }> {
  const u = new URL(path, base.endsWith('/') ? base : base + '/');
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) u.searchParams.set(k, v);
  const apiKey = env().TINYFISH_API_KEY; // outside the try: a configuration error must not read as a network error
  const retries = o.retries ?? 2;
  let lastErr: TinyFishError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(lastErr?.opts.retryAfterMs ?? 500 * 2 ** attempt, 8000));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), o.timeoutMs ?? 30_000);
    try {
      const res = await fetch(u, {
        method: o.method ?? 'GET',
        headers: { 'X-API-Key': apiKey, ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
        signal: ctl.signal,
        cache: 'no-store',
      });
      const requestId = res.headers.get('x-request-id') ?? undefined;
      const text = await res.text();
      let json: unknown = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
      if (res.ok) {
        if (json === null && text) throw new TinyFishError('malformed', 'TinyFish returned a non-JSON response', { status: res.status, requestId });
        return { data: json as T, requestId };
      }
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      const retryAfter = Number(res.headers.get('retry-after'));
      lastErr = new TinyFishError(kindFromStatus(res.status, err?.code), err?.message ?? `TinyFish HTTP ${res.status}`, {
        status: res.status, code: err?.code, requestId, retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : undefined,
      });
      log('warn', 'tinyfish.error', { path: u.pathname, status: res.status, code: err?.code, requestId, attempt });
    } catch (e) {
      if (e instanceof TinyFishError) { lastErr = e; }
      else if ((e as Error).name === 'AbortError') lastErr = new TinyFishError('timeout', 'TinyFish request timed out');
      else lastErr = new TinyFishError('unavailable', 'Could not reach TinyFish');
    } finally {
      clearTimeout(timer);
    }
    if (!lastErr.retryable) break;
  }
  throw lastErr!;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
