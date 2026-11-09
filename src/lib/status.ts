import type { Status } from './schemas';

/**
 * Maps registry wording to the normalized taxonomy. Active is anchored on purpose: anything not
 * recognised is `unknown`, never `active`. Order matters (negations are tested first).
 */
const RULES: Array<[RegExp, Status]> = [
  [/\b(suspend|suspension)/i, 'suspended'],
  [/\b(revoke|revoked|revocation|erased|struck off|disqualif)/i, 'revoked'],
  [/\b(expired|delinquent|lapsed)\b/i, 'expired'],
  [/\b(pending|applied|application)\b/i, 'pending'],
  [/\b((?<!proposal to )strike[- ]?off|(?<!proposal to )striking off|amalgamat|liquidat|dormant|converted to llp|inactive|not active|cancel+ed|surrender|dissolved|closed|withdrawn|without a licen[cs]e to practi[sc]e|retired|deceased|non-?practising)/i, 'inactive'],
  [/^(this license is )?(current and )?(active|current|valid|licensed|clear|in good standing|open|live)\.?$/i, 'active'],
  [/^licen[cs]e renewed (&|and) current\.?$/i, 'active'], // Medical Board of California / DCA
  [/^registered with a licen[cs]e to practi[sc]e$/i, 'active'],
];

export function normalizeStatus(raw: string | null | undefined): Status {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return 'unknown';
  for (const [re, status] of RULES) if (re.test(s)) return status;
  return 'unknown';
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * Returns YYYY-MM-DD or null. Numeric dd/mm/yyyy vs mm/dd/yyyy is ambiguous, so the caller
 * passes the registry's convention; an impossible reading returns null rather than guessing.
 */
export function normalizeDate(raw: string | null | undefined, opts: { dayFirst?: boolean | null } = {}): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    // Unknown convention (e.g. a discovered registry): only accept the reading that is unambiguous.
    const dayFirst = typeof opts.dayFirst === 'boolean' ? opts.dayFirst : a > 12 ? true : b > 12 ? false : a === b ? true : null;
    if (dayFirst === null) return null;
    return dayFirst ? valid(+m[3], b, a) : valid(+m[3], a, b);
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?\s+(\d{4})$/);
  if (m) { const i = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()); return i < 0 ? null : valid(+m[3], i + 1, +m[1]); }
  m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (m) { const i = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()); return i < 0 ? null : valid(+m[3], i + 1, +m[2]); }
  // Registers often show a label with the date ("Annual retention fee due date: 01 Aug 2027"): read the one date in it.
  const found = [...s.matchAll(/\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,}\.?,?\s+\d{4}|[A-Za-z]{3,}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4}/g)].map((x) => x[0]);
  return found.length === 1 && found[0] !== s ? normalizeDate(found[0], opts) : null; // two dates in one string is ambiguous: no guess
}
