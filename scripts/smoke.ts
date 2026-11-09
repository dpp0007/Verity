/**
 * Live smoke test against the REAL TinyFish API and REAL official registries. Not part of CI; it spends credits.
 *
 *   npm run smoke -- <registry-id> "<subject name>" [licence-number]
 *   npm run smoke -- --list
 *
 * Exit codes: 0 = workflow completed and validated, 1 = completed but failed validation / outcome not usable,
 * 2 = NOT TESTED (key invalid, registry or TinyFish unreachable). Exit 2 is never reported as a pass.
 */
import './loadEnv';
import { REGISTRIES, isOfficialRegistryHost, registryById, type Registry } from '@/lib/registries';
import { isOfficialUrl } from '@/lib/url';
import { VerificationResultSchema } from '@/lib/schemas';
import { createVerification } from '@/server/verifications';
import { settleJobs } from '@/server/verify';
import { toResult } from '@/server/serialize';
import { fetchPages } from '@/tinyfish/fetch';
import { TinyFishError } from '@/tinyfish/errors';

const DEFAULTS: Record<string, [string, string | null]> = {
  // A well-known public company; person/contractor registries need a subject you are entitled to look up.
  'gb-companies-house': ['TESCO PLC', '00445790'],
};

async function main() {
  const [a, b, c] = process.argv.slice(2);
  if (a === '--list' || !a) {
    for (const r of REGISTRIES) console.log(`${r.id.padEnd(24)} ${r.name}  [live-passed flag: ${r.livePassed}]`);
    process.exit(a ? 0 : 1);
  }
  // `dyn-XX`: company register of country XX, discovered at run time (e.g. dyn-NZ).
  const dyn = /^dyn-([A-Za-z]{2})$/.exec(a);
  const reg = dyn
    ? ({ id: a, name: `discovered register (${dyn[1].toUpperCase()})`, country: dyn[1].toUpperCase(), regions: [], subjectType: 'business', recordTypes: ['company_registration'], domains: [], searchEntry: '' } as unknown as Registry)
    : registryById(a);
  if (!reg) { console.error(`Unknown registry ${a}. Use --list.`); process.exit(1); }
  const [name, num] = b ? [b, c ?? null] : DEFAULTS[reg.id] ?? [null, null];
  if (!name) { console.error(`Provide a subject: npm run smoke -- ${reg.id} "<name>" [number]`); process.exit(1); }

  console.log(`== ${reg.name}`);
  // 1. reachability of the official entry point through TinyFish Fetch (discovered registers are found by the workflow itself)
  if (!dyn) try {
    const f = await fetchPages([reg.searchEntry]);
    if (!f.pages.length) { console.log(`NOT TESTED: entry point not retrievable (${f.errors[0]?.error ?? 'no content'})`); process.exit(2); }
    console.log(`source reachable: yes (${f.pages[0].finalUrl}, ${f.pages[0].text.length} chars)`);
  } catch (e) {
    console.log(`NOT TESTED: TinyFish Fetch failed - ${(e as TinyFishError).message}`);
    process.exit(2);
  }

  // 2. full workflow
  const id = await createVerification('smoke_owner', {
    name, subject_type: reg.subjectType, record_type: reg.recordTypes[0], country: reg.country, region: reg.regions[0] ?? null, license_number: num, source_url: null,
  });
  await settleJobs();
  const r = await toResult(id);
  if (!r) { console.log('FAIL: result missing'); process.exit(1); }

  const schemaOk = VerificationResultSchema.safeParse(r).success;
  const urlOk = !!r.verification.source_url && (dyn ? isOfficialRegistryHost(new URL(r.verification.source_url).hostname) : isOfficialUrl(r.verification.source_url, reg.domains));
  const missing = r.record ? Object.entries(r.record).filter(([, v]) => v === null).map(([k]) => k) : [];
  console.log(JSON.stringify({ state: r.state, outcome: r.verification.outcome, confidence: r.verification.confidence, status: r.record?.status ?? null, schemaOk, sourceUrlOnOfficialDomain: urlOk, missingFields: missing, candidates: r.candidates.length, limitations: r.verification.limitations, error: r.error }, null, 2));

  if ((r.state === 'failed' && r.verification.outcome === 'temporarily_unavailable') || r.error?.code === 'provider_auth' || r.error?.code === 'provider_billing') {
    console.log('NOT TESTED: provider/registry unavailable - this is not a pass.');
    process.exit(2);
  }
  const usable = r.state === 'awaiting_selection' || ['verified', 'partially_verified', 'not_found'].includes(r.verification.outcome ?? '');
  const pass = schemaOk && urlOk && usable;
  console.log(pass ? 'PASS (workflow ran end to end; review the fields above before marking the registry live-tested)' : 'FAIL');
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
