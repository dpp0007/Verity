import { z } from 'zod';
import { tfRequest, urls } from './client';
import { TinyFishError } from './errors';

const Result = z.object({
  url: z.string(), final_url: z.string(),
  title: z.string().nullable().optional(), text: z.unknown().nullable().optional(), format: z.string().optional(),
});
const FetchResponse = z.object({
  results: z.array(Result),
  errors: z.array(z.object({ url: z.string(), error: z.string(), status: z.number().optional() })).default([]),
});

export interface FetchedPage { url: string; finalUrl: string; title: string | null; text: string }

/** Live retrieval (ttl 0). Per-URL failures are returned as errors, never thrown, so callers can report partial success. */
export async function fetchPages(targets: string[], format: 'markdown' | 'html' = 'markdown'): Promise<{ pages: FetchedPage[]; errors: Array<{ url: string; error: string; status?: number }> }> {
  const { data } = await tfRequest(urls().fetch, '/', {
    method: 'POST',
    body: { urls: targets, format, ttl: 0, per_url_timeout_ms: 60_000, purpose: 'Verify an official public record' },
    timeoutMs: 150_000,
  });
  const p = FetchResponse.safeParse(data);
  if (!p.success) throw new TinyFishError('malformed', 'Fetch response failed validation');
  return {
    pages: p.data.results.map((r) => ({ url: r.url, finalUrl: r.final_url, title: r.title ?? null, text: typeof r.text === 'string' ? r.text : '' })),
    errors: p.data.errors,
  };
}
