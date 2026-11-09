import { REGISTRIES } from '@/lib/registries';
import { handle } from '@/server/api';

export const GET = handle(async () => ({
  registries: REGISTRIES.map((r) => ({
    id: r.id, name: r.name, authority: r.authority, country: r.country, regions: r.regions, subject_type: r.subjectType,
    record_types: r.recordTypes, official_domains: r.domains, search_entry: r.searchEntry, method: r.method,
    available_fields: r.availableFields, limitations: r.limitations, live_tested: r.livePassed, blocked: r.blocked ?? null,
    monitoring: 'Page monitor on a direct official record URL (when the registry exposes one).',
  })),
  dynamic_coverage: [{ record_type: 'company_registration', countries: 'any ISO 3166-1 alpha-2 code', method: 'The official government company register is discovered with TinyFish Search at request time; non-government and aggregator sites are rejected; confidence is capped at medium.' }],
}));
