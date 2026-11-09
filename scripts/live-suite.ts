/**
 * Live end-to-end suite against REAL TinyFish + real registers. Spends credits; not part of CI.
 *   npm run live-suite              (all cases)
 *   npm run live-suite -- uk        (cases whose label contains "uk")
 * Every case prints what the app would show. Expected outcomes are asserted loosely and reported as OK / CHECK.
 */
import './loadEnv';
import { createVerification, selectCandidate } from '@/server/verifications';
import { settleJobs } from '@/server/verify';
import { toResult } from '@/server/serialize';
import type { CreateVerificationInput, VerificationResult } from '@/lib/schemas';

const OWNER = 'live_suite_owner';
const doc = (name: string, country: string, region: string | null, license_number: string | null): CreateVerificationInput => ({ name, subject_type: 'person', record_type: 'medical_license', country, region, license_number, source_url: null });
const co = (name: string, country: string, license_number: string | null = null): CreateVerificationInput => ({ name, subject_type: 'business', record_type: 'company_registration', country, region: null, license_number, source_url: null });

interface Case { label: string; input: CreateVerificationInput; expect: (r: VerificationResult) => string | null; pick?: RegExp }
const state = (s: string) => (r: VerificationResult) => (r.record?.status === s ? null : `expected status ${s}, got ${r.record?.status}`);
const outcome = (o: string) => (r: VerificationResult) => (r.verification.outcome === o ? null : `expected outcome ${o}, got ${r.verification.outcome} (${r.state})`);
const both = (...f: Array<(r: VerificationResult) => string | null>) => (r: VerificationResult) => f.map((x) => x(r)).find(Boolean) ?? null;

const CASES: Case[] = [
  { label: 'uk: exact by number (control)', input: co('TESCO PLC', 'GB', '00445790'), expect: both(outcome('verified'), state('active')) },
  { label: 'uk: name variant with & and number', input: co('Marks & Spencer Group PLC', 'GB', '04256886'), expect: both(outcome('verified'), state('active')) },
  { label: 'uk: several matches then pick exact', input: co('Marks and Spencer Group', 'GB'), pick: /MARKS AND SPENCER GROUP P\.L\.C\./i, expect: (r) => (r.record?.number === '04256886' ? null : `picked wrong record: ${r.record?.number}`) },
  { label: 'uk: liquidation status (Carillion)', input: co('Carillion plc', 'GB', '03782379'), expect: state('inactive') },
  { label: 'uk: liquidation status (Thomas Cook)', input: co('Thomas Cook Group plc', 'GB', '06091951'), expect: state('inactive') },
  { label: 'uk: no match', input: co('Zzqxv Plorbnik Holdings Limited', 'GB'), expect: outcome('not_found') },
  { label: 'uk: wrong number for a real name must not verify', input: co('TESCO PLC', 'GB', '99999999'), expect: (r) => (r.verification.outcome === 'verified' && r.verification.confidence === 'high' ? 'verified high with a wrong number!' : null) },
  { label: 'ca-md: physician by licence number', input: doc('Peter Shin', 'US', 'CA', 'A 46271'), expect: both(outcome('verified'), state('active'), (r) => (r.record?.expiry_date === '2028-12-31' ? null : `expiry ${r.record?.expiry_date}`)) },
  { label: 'cslb: contractor by name then pick', input: { name: 'Granite Construction Company', subject_type: 'business', record_type: 'contractor_license', country: 'US', region: 'CA', license_number: null, source_url: null }, pick: /GRANITE CONSTRUCTION COMPANY/i, expect: (r) => (r.record?.number ? null : `no record (${r.verification.outcome}: ${r.error?.message ?? r.verification.limitations[0]})`) },
  { label: 'gmc: doctor by name then pick', input: doc('Chris Whitty', 'GB', null, null), pick: /WHITTY/i, expect: (r) => (r.record?.number ? null : `no record (${r.verification.outcome}: ${r.error?.message ?? r.verification.limitations[0]})`) },
  { label: 'nmc: doctor by name then pick', input: doc('Randeep Guleria', 'IN', null, null), pick: /GULERIA/i, expect: (r) => (r.record?.number ? null : `no record (${r.verification.outcome}: ${r.error?.message ?? r.verification.limitations[0]})`) },
  { label: 'in: exact by CIN (vendor)', input: co('Infosys Limited', 'IN', 'L85110KA1981PLC013115'), expect: both(outcome('partially_verified'), state('active')) },
  { label: 'in: several matches (vendor)', input: co('Tata Consultancy Services', 'IN'), pick: /^TATA CONSULTANCY SERVICES LIMITED$/i, expect: both(outcome('partially_verified'), state('active')) },
  { label: 'in: no match (vendor)', input: co('Zzqxv Plorbnik Holdings Limited', 'IN'), expect: outcome('not_found') },
  { label: 'nz: discovered register', input: co('Fonterra Co-operative Group Limited', 'NZ'), pick: /^FONTERRA CO-OPERATIVE GROUP LIMITED/i, expect: (r) => (r.record ? null : `no record (${r.verification.outcome})`) },
  { label: 'ca: discovered register', input: co('Shopify Inc.', 'CA'), pick: /SHOPIFY INC/i, expect: (r) => (r.record ? null : `no record (${r.verification.outcome}: ${r.error?.message ?? r.verification.limitations[0]})`) },
  { label: 'au: discovered register', input: co('Qantas Airways Limited', 'AU'), pick: /QANTAS AIRWAYS LIMITED/i, expect: (r) => (r.record ? null : `no record (${r.verification.outcome}: ${r.error?.message ?? r.verification.limitations[0]})`) },
];

async function runCase(c: Case) {
  const t0 = Date.now();
  let r: VerificationResult | null = null;
  try {
    const id = await createVerification(OWNER, c.input);
    await settleJobs();
    r = await toResult(id);
    if (r?.state === 'awaiting_selection' && c.pick) {
      const hit = r.candidates.find((x) => c.pick!.test(x.full_name) || c.pick!.test(x.license_number ?? ''));
      if (hit) { await selectCandidate(OWNER, id, hit.id); await settleJobs(); r = await toResult(id); }
      else return { c, r, secs: (Date.now() - t0) / 1000, verdict: `CHECK: no candidate matched ${c.pick} among ${r.candidates.map((x) => x.full_name).join(' | ')}` };
    }
  } catch (e) {
    return { c, r, secs: (Date.now() - t0) / 1000, verdict: `CHECK: threw ${(e as Error).message}` };
  }
  const problem = r ? c.expect(r) : 'no result';
  return { c, r, secs: (Date.now() - t0) / 1000, verdict: problem ? `CHECK: ${problem}` : 'OK' };
}

(async () => {
  const filter = process.argv[2]?.toLowerCase();
  const cases = CASES.filter((c) => !filter || c.label.toLowerCase().includes(filter));
  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  const BATCH = 3; // TinyFish agent concurrency is limited; keep it modest
  for (let i = 0; i < cases.length; i += BATCH) {
    const out = await Promise.all(cases.slice(i, i + BATCH).map(runCase));
    for (const o of out) {
      const r = o.r;
      console.log(`\n[${o.verdict.startsWith('OK') ? 'OK   ' : 'CHECK'}] ${o.c.label}  (${o.secs.toFixed(0)}s)`);
      if (r) {
        console.log(`  state=${r.state} outcome=${r.verification.outcome} confidence=${r.verification.confidence}`);
        console.log(`  record=${r.record ? `${r.verification.matched_name} | ${r.record.number} | ${r.record.status} ("${r.record.source_status}") | issued ${r.record.issue_date} | expiry ${r.record.expiry_date}` : 'none'}`);
        console.log(`  source=${r.verification.source_url} (${r.verification.source_name})`);
        if (r.error) console.log(`  error=${r.error.code}: ${r.error.message.slice(0, 200)}`);
        if (r.candidates.length) console.log(`  candidates=${r.candidates.length}: ${r.candidates.slice(0, 4).map((x) => x.full_name).join(' | ')}`);
        const unconfirmed = r.verification.evidence.filter((e) => !e.validated).length;
        console.log(`  evidence=${r.verification.evidence.length} (unconfirmed ${unconfirmed}), limitations=${r.verification.limitations.length}`);
      }
      if (!o.verdict.startsWith('OK')) console.log(`  >> ${o.verdict}`);
      results.push(o);
    }
  }
  const ok = results.filter((x) => x.verdict === 'OK').length;
  console.log(`\n==== ${ok}/${results.length} matched expectations ====`);
  for (const o of results.filter((x) => x.verdict !== 'OK')) console.log(`CHECK ${o.c.label}: ${o.verdict}`);
  process.exit(0);
})();
