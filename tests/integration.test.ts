// Integration tests run against the real database (SQLite test.db) with a SIMULATED TinyFish provider.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db';
import { ApiError } from '@/lib/errors';
import { createVerification, retryVerification, selectCandidate } from '@/server/verifications';
import { settleJobs } from '@/server/verify';
import { toResult } from '@/server/serialize';
import { changeStatus, checkNow, createMonitor, getMonitorView, listAlerts, removeMonitor } from '@/server/monitoring';
import { handleMonitorWebhook } from '@/server/webhook';
import { FakeTinyFish } from './fakeTinyFish';

const fake = new FakeTinyFish();
const OWNER = 'own_' + 'a'.repeat(32);
const RECORD_URL = 'https://search.dca.ca.gov/details/A12345';
const input = { name: 'Jane Roe', subject_type: 'person' as const, record_type: 'medical_license' as const, country: 'US', region: 'CA', license_number: null, source_url: null };
const cand = (o = {}) => ({ full_name: 'ROE, JANE', license_number: 'A12345', profession: 'Physician and Surgeon', status_text: 'Active', location: 'LOS ANGELES, CA', organization: null, record_url: RECORD_URL, ...o });
const detail = (o = {}) => ({
  record_opened: true, full_name: 'JANE ROE', license_number: 'A12345', profession: 'Physician', status_text: 'Active', issue_date_text: '01/15/2015', expiry_date_text: '03/31/2027',
  disciplinary_section_visible: true, disciplinary_actions: [], record_url: RECORD_URL,
  excerpts: [{ field: 'status', text: 'Status: Active' }, { field: 'expiry_date', text: 'Expiration: 03/31/2027' }], ...o,
});

beforeAll(() => fake.install());
afterAll(() => vi.unstubAllGlobals());
beforeEach(async () => {
  fake.reset();
  fake.searchResult = { search_performed: true, no_results: false, candidates: [cand()] };
  fake.detailResult = detail();
  fake.pageText = '# Record\nStatus: Active\nExpiration: 03/31/2027';
  for (const t of ['alert', 'monitorRun', 'monitor', 'candidate', 'evidenceSnapshot', 'verification', 'activityEvent', 'webhookEvent'] as const) await (db[t] as any).deleteMany();
});

async function verify(i = input) {
  const id = await createVerification(OWNER, i);
  await settleJobs();
  return (await toResult(id))!;
}

describe('TinyFish request construction (simulated provider)', () => {
  it('sends X-API-Key and documented paths/params for Search, Agent and Fetch', async () => {
    await verify();
    const search = fake.callsTo('/')[0];
    expect(search.headers['X-API-Key']).toBe('test-key');
    expect(new URL(search.url).searchParams.get('include_domains')).toContain('search.dca.ca.gov');
    const run = fake.calls.find((c) => c.url.endsWith('/v1/automation/run-async'))!;
    expect(run.method).toBe('POST');
    expect(run.body.output_schema.type).toBe('object');
    expect(JSON.stringify(run.body.output_schema)).not.toMatch(/additionalProperties|oneOf/);
    expect(run.body.goal).toContain('never invent');
    const f = fake.calls.find((c) => c.url.startsWith('https://api.fetch.tinyfish.ai'))!;
    expect(f.body).toMatchObject({ urls: [RECORD_URL], format: 'markdown', ttl: 0 });
  });
  it('surfaces invalid credentials honestly, with no fabricated result', async () => {
    process.env.TINYFISH_API_KEY = 'wrong';
    try {
      const r = await verify();
      expect(r.state).toBe('failed');
      expect(r.error?.code).toBe('provider_auth');
      expect(r.record).toBeNull();
      expect(r.verification.outcome).toBe('failed');
    } finally { process.env.TINYFISH_API_KEY = 'test-key'; }
  });
});

describe('verification workflow', () => {
  it('verifies a unique record with evidence confirmed against the fetched page', async () => {
    const r = await verify();
    expect(r.state).toBe('completed');
    expect(r.verification).toMatchObject({ outcome: 'verified', confidence: 'high', source_url: RECORD_URL });
    expect(r.record).toMatchObject({ status: 'active', source_status: 'Active', number: 'A12345', expiry_date: '2027-03-31', issue_date: '2015-01-15', disciplinary_actions: [] });
    expect(r.verification.evidence.every((e) => e.validated)).toBe(true);
    expect(r.history.map((h) => h.type)).toEqual(expect.arrayContaining(['verification.requested', 'registry.discovered', 'search.completed', 'verification.completed']));
    expect(await db.evidenceSnapshot.count()).toBe(1);
  });
  it('downgrades to medium when excerpts are on neither the fetched page nor a matching second read', async () => {
    fake.pageText = '# Record\nSomething else';
    fake.detailSecond = detail({ status_text: 'Expired' });
    const r = await verify();
    expect(r.verification.confidence).toBe('medium');
    expect(r.verification.outcome).toBe('partially_verified');
    expect(r.verification.evidence.some((e) => e.validated)).toBe(false);
    expect(r.verification.limitations.join(' ')).toMatch(/did not agree/);
  });
  it('confirms by a second browser read when Fetch cannot see the status, and says so', async () => {
    fake.pageText = '# Record\nStatus is rendered by script';
    const r = await verify();
    expect(r.verification.confidence).toBe('high');
    expect(r.verification.evidence.every((e) => e.validated)).toBe(true);
    expect(r.verification.limitations.join(' ')).toMatch(/second, separate browser read/);
  });
  it('keeps unfamiliar statuses unknown and missing fields null with explanations', async () => {
    fake.detailResult = detail({ status_text: 'Under review', expiry_date_text: null, disciplinary_section_visible: false, excerpts: [] });
    const r = await verify();
    expect(r.record).toMatchObject({ status: 'unknown', source_status: 'Under review', expiry_date: null, disciplinary_actions: null });
    expect(r.verification.confidence).not.toBe('high');
    expect(r.verification.limitations.join(' ')).toMatch(/not a recognised status/);
    expect(r.verification.limitations.join(' ')).toMatch(/expiry date/);
  });
  it('requires disambiguation for several candidates and never merges them', async () => {
    fake.searchResult = { search_performed: true, no_results: false, candidates: [cand(), cand({ license_number: 'A99999', location: 'FRESNO, CA', record_url: 'https://search.dca.ca.gov/details/A99999' })] };
    const r = await verify();
    expect(r.state).toBe('awaiting_selection');
    expect(r.verification.outcome).toBe('ambiguous');
    expect(r.record).toBeNull();
    expect(r.candidates).toHaveLength(2);
    expect(fake.calls.filter((c) => String(c.body?.goal).includes('Open the single record'))).toHaveLength(0);

    fake.detailResult = detail({ license_number: 'A99999', record_url: 'https://search.dca.ca.gov/details/A99999' });
    await selectCandidate(OWNER, r.id, r.candidates[1].id);
    await settleJobs();
    const done = (await toResult(r.id))!;
    expect(done.state).toBe('completed');
    expect(done.record?.number).toBe('A99999');
    expect(done.verification.confidence).toBe('high');
    await expect(selectCandidate(OWNER, r.id, r.candidates[0].id)).rejects.toMatchObject({ code: 'invalid_state' });
  });
  it('reports an explicit no-match and does not claim unlicensed', async () => {
    fake.searchResult = { search_performed: true, no_results: true, candidates: [] };
    const r = await verify();
    expect(r.verification.outcome).toBe('not_found');
    expect(r.record).toBeNull();
    expect(r.verification.source_url).toBeTruthy();
    expect(r.verification.limitations.join(' ')).toMatch(/does not prove/);
  });
  it('treats an incomplete search as unavailable, never as not_found', async () => {
    fake.searchResult = { search_performed: false, no_results: false, candidates: [], notes: 'form would not submit' };
    const r = await verify();
    expect(r.state).toBe('failed');
    expect(r.verification.outcome).toBe('temporarily_unavailable');
    expect(r.error?.retryable).toBe(true);
  });
  it('reports malformed agent output as failure', async () => {
    fake.agentMalformed = true;
    const r = await verify();
    expect(r.state).toBe('failed');
    expect(r.error?.code).toBe('provider_malformed');
  });
  it('reports agent timeout/blocked as temporarily unavailable', async () => {
    fake.agentFailure = { code: 'SITE_BLOCKED', category: 'AGENT_FAILURE', message: 'blocked' };
    const r = await verify();
    expect(r.verification.outcome).toBe('temporarily_unavailable');
  });
  it('continues with a limitation when the independent fetch fails', async () => {
    fake.fetchError = 'timeout';
    fake.detailSecond = detail({ status_text: 'Expired' });
    const r = await verify();
    expect(r.state).toBe('completed');
    expect(r.verification.confidence).not.toBe('high');
    expect(r.verification.limitations.join(' ')).toMatch(/fetch failed/);
  });
  it('flags conflicting candidate vs record data', async () => {
    fake.detailResult = detail({ license_number: 'ZZ0000' });
    const r = await verify();
    expect(r.verification.confidence).toBe('low');
    expect(r.verification.limitations.join(' ')).toMatch(/conflicts/);
  });
  it('ignores record URLs outside approved domains', async () => {
    fake.searchResult = { search_performed: true, no_results: false, candidates: [cand({ record_url: 'https://evil.example.com/x' })] };
    fake.detailResult = detail({ record_url: 'https://evil.example.com/x' });
    const r = await verify();
    expect(r.verification.source_url).toBe('https://search.dca.ca.gov/');
    expect(JSON.stringify(r)).not.toContain('evil.example.com');
  });
  it('rejects unsupported jurisdictions, record types and off-domain source URLs before any provider call', async () => {
    await expect(createVerification(OWNER, { ...input, region: 'NY' })).rejects.toMatchObject({ code: 'unsupported_jurisdiction', status: 422 });
    await expect(createVerification(OWNER, { ...input, source_url: 'https://evil.com/' })).rejects.toMatchObject({ code: 'invalid_source_url' });
    await expect(createVerification(OWNER, { ...input, subject_type: 'business' })).rejects.toBeInstanceOf(ApiError);
    expect(fake.calls).toHaveLength(0);
  });
  it('deduplicates idempotent submissions and in-flight duplicates; retry creates a new run', async () => {
    const a = await createVerification(OWNER, input, { idempotencyKey: 'k1' });
    const b = await createVerification(OWNER, input, { idempotencyKey: 'k1' });
    const c = await createVerification(OWNER, input);
    expect(b).toBe(a);
    expect(c).toBe(a);
    await settleJobs();
    const again = await retryVerification(OWNER, a);
    expect(again).not.toBe(a);
    await settleJobs();
  });
  it('isolates data between owners', async () => {
    const r = await verify();
    expect(await db.verification.findFirst({ where: { id: r.id, ownerId: 'own_' + 'b'.repeat(32) } })).toBeNull();
    await expect(retryVerification('own_' + 'b'.repeat(32), r.id)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('fails stuck jobs as interrupted', async () => {
    const r = await verify();
    await db.verification.update({ where: { id: r.id }, data: { state: 'running', outcome: null } });
    await db.$executeRaw`UPDATE Verification SET updatedAt = 0 WHERE id = ${r.id}`;
    expect((await toResult(r.id))!.error?.code).toBe('interrupted');
  });
});

describe('company registers in any country (discovered registry)', () => {
  const co = { name: 'Acme Traders', subject_type: 'business' as const, record_type: 'company_registration' as const, country: 'KE', region: null, license_number: null, source_url: null };
  const KE = 'https://businessregistration.go.ke/company/C123';
  const run = async (i = co) => { const id = await createVerification(OWNER, i); await settleJobs(); return (await toResult(id))!; };
  beforeEach(() => {
    fake.searchHits = [{ url: 'https://opencorporates.com/companies/ke', title: 'OpenCorporates' }, { url: 'https://businessregistration.go.ke/search', title: 'Business Registration Service' }];
    fake.searchResult = { search_performed: true, no_results: false, candidates: [cand({ full_name: 'ACME TRADERS LIMITED', license_number: 'C123', record_url: KE })] };
    fake.detailResult = detail({ full_name: 'ACME TRADERS LIMITED', license_number: 'C123', record_url: KE, status_text: 'Active', expiry_date_text: null, disciplinary_section_visible: false });
    fake.pageText = 'Status: Active';
  });
  afterEach(() => { fake.searchHits = [{ url: 'https://search.dca.ca.gov/', title: 'DCA License Search' }]; });

  it('discovers the official register, skips aggregators and caps confidence at medium', async () => {
    const r = await run();
    expect(r.state).toBe('completed');
    expect(r.verification.source_name).toBe('Business Registration Service');
    expect(r.verification.source_url).toBe(KE);
    expect(r.verification.confidence).toBe('medium');
    expect(r.verification.confidence_reasons.join(' ')).toMatch(/discovered automatically/);
    expect(r.record?.status).toBe('active');
    expect(r.history.map((h) => h.type)).toContain('registry.discovered');
    const search = fake.calls.find((c) => new URL(c.url).hostname === 'api.search.tinyfish.ai')!;
    expect(new URL(search.url).searchParams.get('location')).toBe('KE');
    expect(new URL(search.url).searchParams.get('include_domains')).toBeNull();
  });
  it('returns unsupported (not a guess) when only non-official sites are found', async () => {
    fake.searchHits = [{ url: 'https://opencorporates.com/companies/ke', title: 'OpenCorporates' }, { url: 'https://www.dnb.com/ke', title: 'D&B' }];
    const r = await run();
    expect(r.verification.outcome).toBe('unsupported');
    expect(r.record).toBeNull();
    expect(fake.calls.some((c) => c.url.endsWith('/v1/automation/run-async'))).toBe(false);
  });
  it('ignores record URLs outside the discovered registry domain', async () => {
    fake.searchResult = { search_performed: true, no_results: false, candidates: [cand({ full_name: 'ACME TRADERS LIMITED', license_number: 'C123', record_url: null })] };
    fake.detailResult = detail({ full_name: 'ACME TRADERS LIMITED', license_number: 'C123', record_url: 'https://evil.example.com/x', disciplinary_section_visible: false });
    const r = await run();
    expect(r.verification.source_url).toBe('https://businessregistration.go.ke/search');
  });
  it('India companies use the licensed vendor and are refused when it is not configured', async () => {
    const saved = process.env.SANDBOX_API_KEY;
    delete process.env.SANDBOX_API_KEY;
    try { await expect(createVerification(OWNER, { ...co, country: 'IN' })).rejects.toMatchObject({ code: 'registry_not_configured', status: 422 }); } finally { process.env.SANDBOX_API_KEY = saved; }
    expect(fake.calls).toHaveLength(0);
  });
  it('rejects a non-official source_url and non-company types for unconfigured countries', async () => {
    await expect(createVerification(OWNER, { ...co, source_url: 'https://opencorporates.com/x' })).rejects.toMatchObject({ code: 'invalid_source_url' });
    await expect(createVerification(OWNER, { ...co, subject_type: 'person', record_type: 'medical_license' })).rejects.toMatchObject({ code: 'unsupported_jurisdiction' });
  });
  it('can still be monitored when the record has a direct URL on the discovered domain', async () => {
    const r = await run();
    expect((await createMonitor(OWNER, r.id)).status).toBe('active');
  });
});

describe('India companies via licensed vendor (simulated Sandbox)', () => {
  const inCo: Parameters<typeof createVerification>[1] = { name: 'Infosys Limited', subject_type: 'business', record_type: 'company_registration', country: 'IN', region: null, license_number: null, source_url: null };
  const CIN = 'L85110KA1981PLC013115';
  const master = { company_name: 'INFOSYS LIMITED', company_status: 'Active', company_registration_date: '02/07/1981', company_class: 'Public', updated_at: Date.UTC(2026, 9, 1) };
  const run = async (i = inCo) => { const id = await createVerification(OWNER, i); await settleJobs(); return (await toResult(id))!; };

  it('searches by name, then verifies the selected CIN; vendor data is labelled and capped at medium', async () => {
    fake.sbxRecords = [{ cin: CIN, company_name: 'INFOSYS LIMITED' }, { cin: 'U72200KA2011PLC057096', company_name: 'INFOSYS BPM LIMITED' }];
    fake.sbxMaster = master;
    const r = await run();
    expect(r.state).toBe('awaiting_selection'); // two candidates, never auto-picked? exact-name candidate exists but several results
    await selectCandidate(OWNER, r.id, r.candidates[0].id);
    await settleJobs();
    const done = (await toResult(r.id))!;
    expect(done.record).toMatchObject({ number: CIN, status: 'active', source_status: 'Active', issue_date: '1981-07-02', expiry_date: null, disciplinary_actions: null });
    expect(done.verification.confidence).toBe('medium');
    expect(done.verification.source_name).toMatch(/Sandbox \(licensed third-party/);
    expect(done.verification.limitations.join(' ')).toMatch(/not read from the MCA website/);
    expect(done.verification.evidence.every((e) => !e.validated)).toBe(true);
    expect(fake.calls.some((c) => c.url.includes('tinyfish.ai'))).toBe(false); // no TinyFish calls for vendor registries
    await expect(createMonitor(OWNER, r.id)).rejects.toMatchObject({ code: 'monitoring_unsupported' });
  });
  it('looks up directly by CIN and maps MCA statuses without ever mapping unknown ones to active', async () => {
    fake.sbxMaster = { ...master, company_status: 'Strike Off' };
    const r = await run({ ...inCo, license_number: CIN });
    expect(r.record?.status).toBe('inactive');
    fake.sbxMaster = { ...master, company_status: 'Under Review' };
    expect((await run({ ...inCo, license_number: CIN, name: 'Infosys Limited ' })).record?.status).toBe('unknown');
  });
  it('reports not_found for a vendor no-match and failed (auth) for bad credentials', async () => {
    expect((await run()).verification.outcome).toBe('not_found');
    fake.sbxAuthFail = true;
    const r = await run({ ...inCo, name: 'Another Company' });
    expect(r.state).toBe('failed');
    expect(r.error?.code).toBe('provider_auth');
    expect(r.record).toBeNull();
  });
});

describe('UK companies via Companies House (Fetch only, simulated pages with the real layout)', () => {
  const page = (name: string, n: string, status: string, inc = '23 July 2001') => `* Company Overview for ${name} (${n})\n* Filing history for ${name} (${n})\n\n* Registered office address\n* Waterside House, London, W2 1NW\n\n* Company status\n* ${status}\n\n* Company type\n* Public limited Company\n\n* Incorporated on\n* ${inc}\n`;
  const html = (...nums: string[]) => `<main><h1> Search results </h1><article><ul>${nums.map((n) => `<li>\n<p> ${n} - Incorporated on 23 July 2001 </p>\n<p>Waterside House</p>\n</li>`).join('')}</ul></article></main>`;
  const uk = { name: 'MARKS AND SPENCER GROUP P.L.C.', subject_type: 'business' as const, record_type: 'company_registration' as const, country: 'GB', region: null, license_number: null as string | null, source_url: null };
  const run = async (i: typeof uk) => { const id = await createVerification(OWNER, i); await settleJobs(); return (await toResult(id))!; };
  beforeEach(() => { fake.chPages = { '04256886': page('MARKS AND SPENCER GROUP P.L.C.', '04256886', 'Active'), '00214436': page('MARKS AND SPENCER P.L.C.', '00214436', 'Active', '17 June 1926'), '03782379': page('CARILLION PLC', '03782379', 'Liquidation', '28 May 1999') }; fake.chHtml = html('04256886', '00214436'); });

  it('verifies by number using only Fetch (no agent), with the page-derived evidence confirmed', async () => {
    const r = await run({ ...uk, license_number: '4256886' }); // short number is zero-padded
    expect(r.verification).toMatchObject({ outcome: 'verified', confidence: 'high', source_url: 'https://find-and-update.company-information.service.gov.uk/company/04256886' });
    expect(r.record).toMatchObject({ number: '04256886', status: 'active', source_status: 'Active', issue_date: '2001-07-23', expiry_date: null, disciplinary_actions: null });
    expect(r.verification.evidence.every((e) => e.validated)).toBe(true);
    expect(fake.calls.some((c) => c.url.includes('/v1/automation'))).toBe(false);
    expect(fake.calls.every((c) => c.url.startsWith('https://api.fetch.tinyfish.ai'))).toBe(true);
  });
  it('lists several matches from a name search and never picks one', async () => {
    const r = await run(uk);
    expect(r.state).toBe('awaiting_selection');
    expect(r.candidates.map((c) => c.license_number)).toEqual(['04256886', '00214436']);
    await selectCandidate(OWNER, r.id, r.candidates[1].id);
    await settleJobs();
    expect((await toResult(r.id))!.record?.number).toBe('00214436');
  });
  it('maps liquidation to inactive and never to active', async () => {
    const r = await run({ ...uk, name: 'Carillion plc', license_number: '03782379' });
    expect(r.record).toMatchObject({ status: 'inactive', source_status: 'Liquidation' });
  });
  it('reports no match for an unknown number or an empty search, and a changed layout as a failure', async () => {
    expect((await run({ ...uk, license_number: '99999999' })).verification.outcome).toBe('not_found');
    fake.chHtml = '<main><h1> Search results </h1><p>No results found</p></main>';
    expect((await run({ ...uk, name: 'Zzqx Nothing Ltd' })).verification.outcome).toBe('not_found');
    fake.chHtml = html('04256886'); // fuzzy hits whose names share nothing with the query are not candidates
    expect((await run({ ...uk, name: 'Zzqx Plorbnik Holdings Limited' })).verification.outcome).toBe('not_found');
    fake.chHtml = '<html>something else entirely</html>';
    const bad = await run({ ...uk, name: 'Layout Changed Ltd' });
    expect(bad.state).toBe('failed');
    expect(bad.error?.code).toBe('provider_malformed'); // a site redesign is surfaced, never turned into "not found"
  });
  it('can be monitored because the record page is a direct official URL', async () => {
    const r = await run({ ...uk, license_number: '04256886' });
    expect((await createMonitor(OWNER, r.id)).status).toBe('active');
  });
});

describe('monitoring', () => {
  async function verified() {
    const r = await verify();
    return r.id;
  }
  it('creates a real page monitor, persists provider id/baseline, and refuses duplicates', async () => {
    const vid = await verified();
    const m = await createMonitor(OWNER, vid);
    expect(m).toMatchObject({ provider_monitor_id: 'tf_mon_1', status: 'active', current_status: 'active' });
    const call = fake.calls.find((c) => c.url.endsWith('/v1/monitors') && c.method === 'POST')!;
    expect(call.body).toMatchObject({ type: 'fetch', config: { url: RECORD_URL, format: 'markdown' }, schedule_cron: '0 6 * * *' });
    expect(call.body.purpose).toMatch(/distinguish them from page-layout/);
    expect(call.body.webhook_url).toBe('https://verity.test/api/v1/webhooks/tinyfish?token=test-secret-123');
    expect(m.runs[0]).toMatchObject({ source: 'baseline', outcome: 'baseline', ok: true });
    await expect(createMonitor(OWNER, vid)).rejects.toMatchObject({ code: 'monitor_exists', status: 409 });
    expect(fake.calls.filter((c) => c.url.endsWith('/v1/monitors') && c.method === 'POST')).toHaveLength(1);
    expect((await toResult(vid))!.monitoring).toMatchObject({ status: 'active', enabled: true });
  });
  it('does not claim a monitor exists when TinyFish creation fails', async () => {
    const vid = await verified();
    fake.monitorCreate = 'fail';
    await expect(createMonitor(OWNER, vid)).rejects.toMatchObject({ code: 'provider_billing', status: 402 });
    expect(await db.monitor.count()).toBe(0);
    expect((await toResult(vid))!.monitoring.status).toBe('not_configured');
  });
  it('refuses to monitor records that cannot be tracked', async () => {
    fake.searchResult = { search_performed: true, no_results: false, candidates: [cand({ record_url: null })] };
    fake.detailResult = detail({ record_url: null });
    const r = await verify();
    await expect(createMonitor(OWNER, r.id)).rejects.toMatchObject({ code: 'monitoring_unsupported' });
    fake.searchResult = { search_performed: true, no_results: true, candidates: [] };
    const nf = await verify({ ...input, name: 'Nobody Here' });
    await expect(createMonitor(OWNER, nf.id)).rejects.toMatchObject({ code: 'monitoring_unsupported' });
  });
  const hook = (mid: string, o: any = {}) => JSON.stringify({ fetch_monitor_id: 'tf_mon_1', id: mid, is_baseline: false, outcome: 'changed', diff: '-Active\n+Suspended', judgment: { is_relevant: true, summary: 's' }, results: [{ url: RECORD_URL, text: 'Status: Suspended' }], errors: [], ...o });

  it('re-verifies on a relevant change and alerts on the verified field difference; duplicate deliveries are ignored', async () => {
    const vid = await verified();
    const m = await createMonitor(OWNER, vid);
    fake.detailResult = detail({ status_text: 'Suspended', excerpts: [{ field: 'status', text: 'Status: Suspended' }] });
    fake.pageText = '# Record\nStatus: Suspended\nExpiration: 03/31/2027';
    expect((await handleMonitorWebhook('test-secret-123', hook('wh1'))).body).toMatchObject({ received: true, outcome: 'recheck_started' });
    await settleJobs();
    const alerts = await listAlerts(OWNER);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ field: 'status', previous: 'active', next: 'suspended', source_url: RECORD_URL, run_id: 'wh1', subject: 'Jane Roe' });
    expect(alerts[0].evidence.excerpts[0].excerpt).toBe('Status: Suspended');
    const view = await getMonitorView(OWNER, m.id);
    expect(view).toMatchObject({ current_status: 'suspended' });
    expect(view.latest_alert?.field).toBe('status');
    // duplicate delivery
    expect((await handleMonitorWebhook('test-secret-123', hook('wh1'))).body).toMatchObject({ duplicate: true });
    await settleJobs();
    expect(await listAlerts(OWNER)).toHaveLength(1);
  });
  it('records a monitoring error (no alert) when the check failed', async () => {
    const m = await createMonitor(OWNER, await verified());
    const out = await handleMonitorWebhook('test-secret-123', hook('wh2', { outcome: null, results: [], errors: [{ url: RECORD_URL, error: 'target_unreachable' }] }));
    expect(out.body).toMatchObject({ outcome: 'error' });
    expect(await listAlerts(OWNER)).toHaveLength(0);
    const v = await getMonitorView(OWNER, m.id);
    expect(v.last_error).toMatch(/target_unreachable/);
    expect(v.runs[0]).toMatchObject({ outcome: 'error', ok: false });
  });
  it('does not alert when TinyFish judges the change irrelevant (layout/banner)', async () => {
    await createMonitor(OWNER, await verified());
    const out = await handleMonitorWebhook('test-secret-123', hook('wh3', { judgment: { is_relevant: false } }));
    expect(out.body).toMatchObject({ outcome: 'irrelevant_change' });
    expect(await listAlerts(OWNER)).toHaveLength(0);
    expect(fake.calls.filter((c) => String(c.body?.goal).includes('Open the single record'))).toHaveLength(1); // only the original verification
  });
  it('does not alert when the re-verification is inconclusive (page changed, extraction failed)', async () => {
    await createMonitor(OWNER, await verified());
    fake.agentFailure = { code: 'TIMEOUT', category: 'SYSTEM_FAILURE', message: 'slow' };
    await handleMonitorWebhook('test-secret-123', hook('wh4'));
    await settleJobs();
    expect(await listAlerts(OWNER)).toHaveLength(0);
    const m = await db.monitor.findFirstOrThrow();
    expect(m.currentStatus).toBe('active');
    expect(m.lastError).toBeTruthy();
  });
  it('does not alert for a layout-only change that leaves the verified fields identical', async () => {
    await createMonitor(OWNER, await verified());
    await handleMonitorWebhook('test-secret-123', hook('wh5'));
    await settleJobs();
    expect(await listAlerts(OWNER)).toHaveLength(0);
  });
  it('authenticates and validates webhooks', async () => {
    await createMonitor(OWNER, await verified());
    await expect(handleMonitorWebhook('bad', hook('x'))).rejects.toMatchObject({ status: 401 });
    await expect(handleMonitorWebhook(null, hook('x'))).rejects.toMatchObject({ status: 401 });
    await expect(handleMonitorWebhook('test-secret-123', '{not json')).rejects.toMatchObject({ code: 'invalid_json' });
    await expect(handleMonitorWebhook('test-secret-123', JSON.stringify({ fetch_monitor_id: 'unknown', id: '1', results: [], errors: [] }))).rejects.toMatchObject({ status: 404 });
  });
  it('manual check detects page change via content hash and re-verifies', async () => {
    const m = await createMonitor(OWNER, await verified());
    fake.runNow = { results: [{ url: RECORD_URL, text: 'v2 changed' }], errors: [] };
    fake.detailResult = detail({ expiry_date_text: '03/31/2028' });
    await checkNow(OWNER, m.id);
    await settleJobs();
    const alerts = await listAlerts(OWNER);
    expect(alerts.map((a) => a.field)).toEqual(['expiry_date']);
    expect(alerts[0]).toMatchObject({ previous: '2027-03-31', next: '2028-03-31' });
  });
  it('supports pause, resume, invalid transitions, remove, and provider-side deletion', async () => {
    const m = await createMonitor(OWNER, await verified());
    expect((await changeStatus(OWNER, m.id, 'pause')).status).toBe('paused');
    await expect(changeStatus(OWNER, m.id, 'pause')).rejects.toMatchObject({ code: 'invalid_state' });
    expect((await changeStatus(OWNER, m.id, 'resume')).status).toBe('active');
    expect(fake.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ status: 'paused' }, { status: 'active' }]);
    fake.providerMonitorMissing = true;
    const gone = await getMonitorView(OWNER, m.id);
    expect(gone.status).toBe('failed');
    expect(gone.last_error).toMatch(/no longer exists/);
    await removeMonitor(OWNER, m.id); // provider 404 on delete is tolerated
    await expect(getMonitorView(OWNER, m.id)).rejects.toMatchObject({ status: 404 });
    // the record can be added again after removal
    fake.providerMonitorMissing = false;
    expect((await createMonitor(OWNER, (await db.verification.findFirstOrThrow()).id)).status).toBe('active');
  });
  it('isolates monitors between owners', async () => {
    const m = await createMonitor(OWNER, await verified());
    await expect(getMonitorView('own_' + 'c'.repeat(32), m.id)).rejects.toMatchObject({ status: 404 });
  });
});
