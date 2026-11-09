import { z } from 'zod';

/** Providers return "" or "N/A" for missing values; internally missing is always null. */
const nstr = z.preprocess(
  (v) => (typeof v === 'string' && (!v.trim() || /^(n\/?a|none|null|unknown|not (available|shown|provided))$/i.test(v.trim())) ? null : v),
  z.string().nullable().optional().transform((v) => v ?? null),
);

// ---- Agent output schemas: TinyFish structured-output subset (no additionalProperties/oneOf/const) ----
const S = { type: 'string', nullable: true } as const;

export const SEARCH_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    search_performed: { type: 'boolean' },
    no_results: { type: 'boolean' },
    candidates: {
      type: 'array', maxItems: 10,
      items: {
        type: 'object',
        properties: { full_name: { type: 'string' }, license_number: S, profession: S, status_text: S, location: S, organization: S, record_url: S },
        required: ['full_name'],
      },
    },
    notes: S,
  },
  required: ['search_performed', 'no_results', 'candidates'],
} as const;

export const DETAIL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    record_opened: { type: 'boolean' },
    full_name: S, license_number: S, profession: S, status_text: S, issue_date_text: S, expiry_date_text: S,
    disciplinary_section_visible: { type: 'boolean' },
    disciplinary_actions: { type: 'array', items: { type: 'string' } },
    excerpts: { type: 'array', maxItems: 8, items: { type: 'object', properties: { field: { type: 'string' }, text: { type: 'string' } }, required: ['field', 'text'] } },
    record_url: S,
    notes: S,
  },
  required: ['record_opened', 'disciplinary_section_visible', 'excerpts'],
} as const;

export const SearchOutput = z.object({
  search_performed: z.boolean(),
  no_results: z.boolean(),
  candidates: z.array(z.object({
    full_name: z.string().min(1),
    license_number: nstr, profession: nstr, status_text: nstr, location: nstr, organization: nstr, record_url: nstr,
  })).max(25),
  notes: nstr,
});
export type SearchOutput = z.infer<typeof SearchOutput>;

export const DetailOutput = z.object({
  record_opened: z.boolean(),
  full_name: nstr, license_number: nstr, profession: nstr, status_text: nstr, issue_date_text: nstr, expiry_date_text: nstr,
  disciplinary_section_visible: z.boolean(),
  disciplinary_actions: z.array(z.string()).default([]),
  // Agents emit empty excerpts for fields the page does not show; those are dropped, not treated as malformed output.
  excerpts: z.array(z.object({ field: z.string(), text: z.string() })).default([]).transform((a) => a.filter((x) => x.text.trim())),
  record_url: nstr,
  notes: nstr,
});
export type DetailOutput = z.infer<typeof DetailOutput>;

const flat = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** An excerpt counts as validated only if it appears verbatim (whitespace/case-insensitive) in independently fetched page text. */
export function excerptInPage(excerpt: string, pageText: string): boolean {
  const e = flat(excerpt.replace(/[*_`#>|]/g, ''));
  return e.length >= 3 && flat(pageText.replace(/[*_`#>|]/g, '')).includes(e);
}
