import { z } from 'zod';
import { tfRequest, urls } from './client';
import { TinyFishError } from './errors';
import { isOfficialUrl } from '@/lib/url';
import { isOfficialRegistryUrl } from '@/lib/registries';

const SearchResponse = z.object({
  results: z.array(z.object({ position: z.number().optional(), site_name: z.string().optional(), title: z.string(), snippet: z.string().optional(), url: z.string() })),
  total_results: z.number().optional(),
});

export interface SourceHit { url: string; title: string; snippet: string | null }

/**
 * Source discovery. Restricts results to the registry's approved domains and drops anything else.
 * A snippet is only a pointer to a page; it is never treated as proof of licence status.
 */
export async function discoverSources(query: string, domains: string[], country: string): Promise<SourceHit[]> {
  const { data } = await tfRequest(urls().search, '/', {
    query: { query, include_domains: domains.join(','), location: country, language: 'en' },
    timeoutMs: 30_000,
  });
  const parsed = SearchResponse.safeParse(data);
  if (!parsed.success) throw new TinyFishError('malformed', 'Search response failed validation');
  return parsed.data.results
    .filter((r) => isOfficialUrl(r.url, domains))
    .map((r) => ({ url: r.url, title: r.title, snippet: r.snippet ?? null }));
}

/**
 * Finds the official company register for a country. Only government-domain or well-known official
 * register hosts survive the filter; aggregators and directories are discarded.
 */
export async function discoverCompanyRegistry(country: string, countryName: string): Promise<SourceHit | null> {
  for (const q of [`official company register ${countryName} search companies by name`, `${countryName} companies registry business entity search government`]) {
    const { data } = await tfRequest(urls().search, '/', { query: { query: q, location: country, language: 'en' }, timeoutMs: 30_000 });
    const parsed = SearchResponse.safeParse(data);
    if (!parsed.success) throw new TinyFishError('malformed', 'Search response failed validation');
    const hit = parsed.data.results.find((r) => isOfficialRegistryUrl(r.url));
    if (hit) return { url: hit.url, title: hit.title, snippet: hit.snippet ?? null };
  }
  return null;
}
