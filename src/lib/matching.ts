export type NameMatch = 'exact' | 'partial' | 'none';

const NOISE = new Set(['dr', 'mr', 'mrs', 'ms', 'md', 'do', 'mbbs', 'jr', 'sr', 'ii', 'iii', 'prof', 'dba', 'the']);
const COMPANY = new Set(['ltd', 'limited', 'plc', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'llp', 'lp']);

const SHORT_FORMS = new Map<string, Set<string>>(Object.entries({
  chris: ['christopher', 'christine', 'christina'], bob: ['robert'], rob: ['robert'], bill: ['william'], will: ['william'], mike: ['michael'], jim: ['james'],
  tom: ['thomas'], dave: ['david'], dan: ['daniel'], joe: ['joseph'], jack: ['john'], liz: ['elizabeth'], kate: ['katherine', 'catherine'], sue: ['susan'],
  jen: ['jennifer'], nick: ['nicholas'], tony: ['anthony'], sam: ['samuel', 'samantha'], alex: ['alexander', 'alexandra'], andy: ['andrew'], steve: ['stephen', 'steven'],
  matt: ['matthew'], ben: ['benjamin'], pat: ['patrick', 'patricia'], rich: ['richard'], rick: ['richard'], ed: ['edward', 'edmund'], ted: ['edward', 'theodore'],
  jenny: ['jennifer'], sally: ['sarah'], hilary: ['hillary'],
}).map(([k, v]) => [k, new Set(v)]));

function nameTokens(name: string, business = false): string[] {
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
  if (a.every((t) => sb.has(t)) && b.every((t) => sa.has(t))) return 'exact';
  // People use short forms ("Chris" for "Christopher"). Only a known given-name short form counts, and only ever as
  // 'partial', so it can never make a record the automatic unique answer. Surnames get no tolerance ("Smith" != "Smithson").
  const like = (t: string, set: Set<string>) => set.has(t) || (!business && [...set].some((u) => SHORT_FORMS.get(t)?.has(u) || SHORT_FORMS.get(u)?.has(t)));
  return a.every((t) => like(t, sb)) || b.every((t) => like(t, sa)) ? 'partial' : 'none';
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
