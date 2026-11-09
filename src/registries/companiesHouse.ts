/**
 * Companies House (UK) adapter using TinyFish Fetch only.
 * The search page and company pages are server-rendered, so no browser interaction is needed: a search is
 * one Fetch (numbers), then one batched Fetch of the top company pages (names, status, dates). This is much
 * faster and more deterministic than a browser agent. Parsers are pure so they can be unit-tested.
 */
import { fetchPages } from '@/tinyfish/fetch';
import { TinyFishError } from '@/tinyfish/errors';

export const CH_BASE = 'https://find-and-update.company-information.service.gov.uk';
export const chCompanyUrl = (n: string) => `${CH_BASE}/company/${encodeURIComponent(n)}`;

export interface ChCompany { number: string; name: string; status: string | null; incorporated: string | null; dissolved: string | null; office: string | null; type: string | null; url: string; text: string }

/** UK numbers are 8 characters (2-letter prefix + 6 digits, or 8 digits). Short numeric input is zero-padded. */
export function normalizeChNumber(raw: string): string | null {
  const s = raw.replace(/\s/g, '').toUpperCase();
  if (/^\d{1,8}$/.test(s)) return s.padStart(8, '0');
  return /^[A-Z]{2}\d{6}$/.test(s) ? s : null;
}

/** Company numbers in the order they appear in a search-results page (HTML format). */
export function parseSearchNumbers(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<p>\s*([A-Z]{0,2}\d{6,8})\s*-\s*(?:Incorporated|Dissolved)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

const after = (text: string, label: string) => new RegExp(`${label}\\s*\\n+\\s*\\*?\\s*([^\\n]+)`, 'i').exec(text)?.[1]?.trim() ?? null;

export function parseCompanyPage(text: string, url: string): ChCompany | null {
  const m = /Company Overview for (.+?) \(([A-Z]{0,2}\d{6,8})\)/.exec(text);
  if (!m) return null;
  return {
    number: m[2], name: m[1].trim(), status: after(text, 'Company status'), incorporated: after(text, 'Incorporated on'),
    dissolved: after(text, 'Dissolved on'), office: after(text, 'Registered office address'), type: after(text, 'Company type'), url, text,
  };
}

/** Looks up one company by number. Returns null for a 404 (no such company), throws on fetch failure. */
export async function chLookup(numbers: string[]): Promise<Map<string, ChCompany | null>> {
  const urls = numbers.map(chCompanyUrl);
  const { pages, errors } = await fetchPages(urls);
  const out = new Map<string, ChCompany | null>();
  for (const [i, n] of numbers.entries()) {
    const page = pages.find((p) => p.url === urls[i]);
    const err = errors.find((e) => e.url === urls[i]);
    if (page) {
      const c = parseCompanyPage(page.text, urls[i]);
      if (!c) throw new TinyFishError('malformed', 'The Companies House page did not have the expected layout (the site may have changed).');
      out.set(n, c);
    } else if (err?.error === 'page_not_found') out.set(n, null);
    else throw new TinyFishError(err?.error === 'timeout' || err?.error === 'target_unreachable' ? 'unavailable' : 'unavailable', `Companies House could not be fetched (${err?.error ?? 'no content'}). This is not evidence about the company.`);
  }
  return out;
}

/** Name search: HTML results page for company numbers, then batched page fetches for the details. */
export async function chSearch(name: string, limit = 10): Promise<ChCompany[]> {
  const { pages, errors } = await fetchPages([`${CH_BASE}/search/companies?q=${encodeURIComponent(name)}`], 'html');
  if (!pages[0]) throw new TinyFishError('unavailable', `The Companies House search could not be fetched (${errors[0]?.error ?? 'no content'}). This is not a "no match" result.`);
  const numbers = parseSearchNumbers(pages[0].text).slice(0, limit);
  if (!numbers.length) {
    if (!/Search results|Company results|No results/i.test(pages[0].text)) throw new TinyFishError('malformed', 'The Companies House search page did not have the expected layout (the site may have changed).');
    return [];
  }
  const found = await chLookup(numbers);
  return numbers.map((n) => found.get(n)).filter((c): c is ChCompany => !!c);
}
