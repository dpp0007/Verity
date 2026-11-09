export type NameMatch = 'exact' | 'partial' | 'none';

const NOISE = new Set(['dr', 'mr', 'mrs', 'ms', 'md', 'do', 'mbbs', 'jr', 'sr', 'ii', 'iii', 'prof', 'dba', 'the']);
const COMPANY = new Set(['ltd', 'limited', 'plc', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'llp', 'lp']);

export function nameTokens(name: string, business = false): string[] {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !NOISE.has(t) && !(business && COMPANY.has(t)) && !(!business && t.length === 1));
}

/** exact: same token set (order-insensitive, so "Smith, John" == "John Smith"). partial: one side's tokens contained in the other's. */
export function nameMatch(query: string, candidate: string, business = false): NameMatch {
  const a = nameTokens(query, business), b = nameTokens(candidate, business);
  if (!a.length || !b.length) return 'none';
  const sa = new Set(a), sb = new Set(b);
  const aInB = a.every((t) => sb.has(t)), bInA = b.every((t) => sa.has(t));
  if (aInB && bInA) return 'exact';
  return aInB || bInA ? 'partial' : 'none';
}

export interface Matchable { id: string; full_name: string; license_number: string | null }
export type Resolution =
  | { kind: 'none' }
  | { kind: 'unique'; candidate: Matchable; match: NameMatch; by: 'license_number' | 'name' }
  | { kind: 'ambiguous'; candidates: Matchable[] };

const norm = (s: string) => s.replace(/[\s-]/g, '').toLowerCase();

/** Never picks "the first result": a unique answer needs a licence-number hit or a single exact-name candidate. */
export function resolveCandidates(query: { name: string; licenseNumber: string | null; business: boolean }, cands: Matchable[]): Resolution {
  if (!cands.length) return { kind: 'none' };
  if (query.licenseNumber) {
    const hit = cands.filter((c) => c.license_number && norm(c.license_number) === norm(query.licenseNumber!));
    if (hit.length === 1) return { kind: 'unique', candidate: hit[0], match: nameMatch(query.name, hit[0].full_name, query.business), by: 'license_number' };
  }
  const exact = cands.filter((c) => nameMatch(query.name, c.full_name, query.business) === 'exact');
  if (cands.length === 1 && exact.length === 1) return { kind: 'unique', candidate: exact[0], match: 'exact', by: 'name' };
  return { kind: 'ambiguous', candidates: cands };
}
