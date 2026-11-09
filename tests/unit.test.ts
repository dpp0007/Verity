import { describe, expect, it } from 'vitest';
import { normalizeDate, normalizeStatus } from '@/lib/status';
import { nameMatch, resolveCandidates } from '@/lib/matching';
import { computeConfidence } from '@/lib/confidence';
import { detectChanges } from '@/lib/changes';
import { canTransition } from '@/lib/monitorState';
import { isOfficialUrl } from '@/lib/url';
import { CreateVerificationBody, RecordSchema } from '@/lib/schemas';
import { excerptInPage, DetailOutput } from '@/tinyfish/normalization';
import { TinyFishError, kindFromRunError, kindFromStatus } from '@/tinyfish/errors';
import { buildDynamicRegistry, findRegistry, isOfficialRegistryHost, isOfficialRegistryUrl } from '@/lib/registries';
import type { NormalizedRecord } from '@/lib/schemas';

describe('status normalization', () => {
  it.each([
    ['Active', 'active'], ['Current', 'active'], ['License Renewed & Current', 'active'], ['This license is current and active.', 'active'], ['Registered with a licence to practise', 'active'],
    ['Expired', 'expired'], ['Delinquent', 'expired'], ['Suspended', 'suspended'], ['License suspended - probation', 'suspended'], ['Revoked', 'revoked'], ['Erased', 'revoked'],
    ['Inactive', 'inactive'], ['Not active', 'inactive'], ['Registered without a licence to practise', 'inactive'], ['Dissolved', 'inactive'], ['Pending renewal', 'pending'],
  ])('%s -> %s', (raw, expected) => expect(normalizeStatus(raw)).toBe(expected));
  it('never maps unfamiliar wording to active', () => {
    for (const s of ['Active - Proposal to Strike Off', 'In administration', 'Good standing?', 'Unlicensed', '', null, undefined]) expect(normalizeStatus(s as string)).toBe('unknown');
  });
});

describe('date normalization', () => {
  it('handles ISO, textual and numeric formats with the registry convention', () => {
    expect(normalizeDate('2027-03-31')).toBe('2027-03-31');
    expect(normalizeDate('31 March 2027')).toBe('2027-03-31');
    expect(normalizeDate('March 31, 2027')).toBe('2027-03-31');
    expect(normalizeDate('03/04/2027', { dayFirst: true })).toBe('2027-04-03');
    expect(normalizeDate('03/04/2027', { dayFirst: false })).toBe('2027-03-04');
  });
  it('returns null for impossible or unparseable values instead of guessing', () => {
    expect(normalizeDate('31/02/2027', { dayFirst: true })).toBeNull();
    expect(normalizeDate('13/13/2027')).toBeNull();
    expect(normalizeDate('soon')).toBeNull();
    expect(normalizeDate(null)).toBeNull();
  });
});

describe('candidate matching and ambiguity', () => {
  it('matches names regardless of order, titles and punctuation', () => {
    expect(nameMatch('John Smith', 'SMITH, JOHN')).toBe('exact');
    expect(nameMatch('Dr. John A. Smith', 'John Smith')).toBe('exact');
    expect(nameMatch('John Smith', 'John Smithson')).toBe('none');
    expect(nameMatch('John', 'John Smith')).toBe('partial');
    expect(nameMatch('Acme Ltd', 'ACME LIMITED', true)).toBe('exact');
  });
  const c = (id: string, n: string, num: string | null) => ({ id, full_name: n, license_number: num });
  it('resolves uniquely only by licence number or a single exact-name candidate', () => {
    expect(resolveCandidates({ name: 'John Smith', licenseNumber: 'A123', business: false }, [c('1', 'John Smith', 'A999'), c('2', 'John Smith', 'A123')])).toMatchObject({ kind: 'unique', by: 'license_number' });
    expect(resolveCandidates({ name: 'John Smith', licenseNumber: null, business: false }, [c('1', 'John Smith', 'A1')])).toMatchObject({ kind: 'unique', by: 'name' });
  });
  it('never picks the first of several candidates', () => {
    expect(resolveCandidates({ name: 'John Smith', licenseNumber: null, business: false }, [c('1', 'John Smith', 'A1'), c('2', 'John Smith', 'A2')]).kind).toBe('ambiguous');
    expect(resolveCandidates({ name: 'John Smith', licenseNumber: 'ZZZ', business: false }, [c('1', 'John Smith', 'A1'), c('2', 'John Smith', 'A2')]).kind).toBe('ambiguous');
    expect(resolveCandidates({ name: 'John', licenseNumber: null, business: false }, [c('1', 'John Smith', 'A1')]).kind).toBe('ambiguous');
    expect(resolveCandidates({ name: 'x', licenseNumber: null, business: false }, []).kind).toBe('none');
  });
});

describe('confidence', () => {
  const base = { identification: 'exact_unique_name' as const, nameMatch: 'exact' as const, hasNumber: true, status: 'active' as const, statusEvidenceValidated: true, hasStatusExcerpt: true, conflicting: false };
  it('high only with unique identity, number, known status and validated evidence', () => {
    expect(computeConfidence(base)).toMatchObject({ level: 'high', outcome: 'verified' });
  });
  it('medium when evidence could not be independently confirmed', () => {
    expect(computeConfidence({ ...base, statusEvidenceValidated: false })).toMatchObject({ level: 'medium', outcome: 'partially_verified' });
  });
  it('low when status is unknown and the name is only partial', () => {
    expect(computeConfidence({ ...base, status: 'unknown', nameMatch: 'partial', statusEvidenceValidated: false, hasStatusExcerpt: false }).level).toBe('low');
  });
  it('conflicting source data is never high', () => {
    expect(computeConfidence({ ...base, conflicting: true }).level).toBe('low');
  });
});

describe('change detection', () => {
  const rec = (o: Partial<NormalizedRecord> = {}): NormalizedRecord => ({ type: 'medical_license', number: 'A1', status: 'active', source_status: 'Active', issue_date: null, expiry_date: '2027-01-01', disciplinary_actions: [], ...o });
  it('detects status, expiry and new disciplinary actions', () => {
    expect(detectChanges(rec(), rec({ status: 'suspended' }))).toEqual([{ field: 'status', previous: 'active', next: 'suspended' }]);
    expect(detectChanges(rec(), rec({ expiry_date: '2028-01-01' }))[0]).toMatchObject({ field: 'expiry_date', next: '2028-01-01' });
    expect(detectChanges(rec(), rec({ disciplinary_actions: ['Public reprimand 2026'] }))[0]).toMatchObject({ field: 'disciplinary_actions', next: 'Public reprimand 2026' });
  });
  it('ignores no-ops and unavailable values (failed extraction is not a change)', () => {
    expect(detectChanges(rec(), rec())).toEqual([]);
    expect(detectChanges(rec(), rec({ status: 'unknown', source_status: null, expiry_date: null, disciplinary_actions: null }))).toEqual([]);
  });
});

describe('monitor state transitions', () => {
  it('enforces valid transitions', () => {
    expect(canTransition('active', 'pause')).toBe(true);
    expect(canTransition('paused', 'pause')).toBe(false);
    expect(canTransition('paused', 'resume')).toBe(true);
    expect(canTransition('active', 'resume')).toBe(false);
    expect(canTransition('removed', 'check')).toBe(false);
    expect(canTransition('failed', 'remove')).toBe(true);
  });
});

describe('schemas, urls and evidence', () => {
  it('validates the create body', () => {
    expect(() => CreateVerificationBody.parse({ name: '', subject_type: 'person', record_type: 'medical_license', country: 'US' })).toThrow();
    expect(CreateVerificationBody.parse({ name: 'Jo Doe', subject_type: 'person', record_type: 'medical_license', country: 'us', region: 'ca' })).toMatchObject({ country: 'US', region: 'CA', license_number: null });
    expect(() => CreateVerificationBody.parse({ name: 'Jo', subject_type: 'person', record_type: 'bogus', country: 'US' })).toThrow();
  });
  it('rejects a record with a status outside the taxonomy', () => {
    expect(RecordSchema.safeParse({ type: 'medical_license', number: null, status: 'good', source_status: null, issue_date: null, expiry_date: null, disciplinary_actions: null }).success).toBe(false);
  });
  it('accepts only https URLs on approved official domains', () => {
    const d = ['gmc-uk.org'];
    expect(isOfficialUrl('https://www.gmc-uk.org/doctors/1234567', d)).toBe(true);
    for (const u of ['http://www.gmc-uk.org/', 'https://gmc-uk.org.evil.com/', 'https://evil.com/?u=gmc-uk.org', 'https://user:pw@gmc-uk.org/', 'https://gmc-uk.org:8443/', 'https://127.0.0.1/', 'https://localhost/', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) expect(isOfficialUrl(u, d), u).toBe(false);
  });
  it('validates excerpts against fetched page text', () => {
    const page = '# Licence\n\n**Status:**  Active\nExpiry: 31 March 2027';
    expect(excerptInPage('Status: Active', page)).toBe(true);
    expect(excerptInPage('Status: Suspended', page)).toBe(false);
    expect(excerptInPage('', page)).toBe(false);
  });
  it('treats provider placeholders as null and validates agent detail output', () => {
    const r = DetailOutput.parse({ record_opened: true, license_number: 'N/A', status_text: ' Active ', expiry_date_text: '', disciplinary_section_visible: false, excerpts: [] });
    expect(r.license_number).toBeNull();
    expect(r.expiry_date_text).toBeNull();
    expect(DetailOutput.safeParse({ record_opened: 'yes' }).success).toBe(false);
  });
});

describe('error normalization and registry coverage', () => {
  it('classifies provider errors by retryability', () => {
    expect(kindFromStatus(401)).toBe('auth');
    expect(kindFromStatus(402)).toBe('billing');
    expect(kindFromStatus(429)).toBe('rate_limit');
    expect(kindFromStatus(503)).toBe('unavailable');
    expect(new TinyFishError('billing', 'x').retryable).toBe(false);
    expect(new TinyFishError('auth', 'x').retryable).toBe(false);
    expect(new TinyFishError('unavailable', 'x').retryable).toBe(true);
    expect(new TinyFishError('timeout', 'x').userFacingOutcome).toBe('temporarily_unavailable');
    expect(new TinyFishError('malformed', 'x').userFacingOutcome).toBe('failed');
    expect(kindFromRunError('site_blocked', 'AGENT_FAILURE')).toBe('blocked');
    expect(kindFromRunError(undefined, 'BILLING_FAILURE')).toBe('billing');
  });
  it('only resolves supported jurisdictions', () => {
    expect(findRegistry('US', 'CA', 'medical_license')?.id).toBe('us-ca-medical-board');
    expect(findRegistry('GB', null, 'company_registration')?.id).toBe('gb-companies-house');
    expect(findRegistry('US', 'NY', 'medical_license')).toBeNull();
    expect(findRegistry('FR', null, 'medical_license')).toBeNull();
    expect(findRegistry('IN', null, 'medical_license')?.id).toBe('in-nmc-medical-register');
  });
});

describe('worldwide company registers', () => {
  it('accepts only government-style or known official register hosts', () => {
    for (const h of ['register.gov.uk', 'businessregistration.go.ke', 'data.gouv.fr', 'www.registrodeempresas.gob.mx', 'www.companiesoffice.govt.nz', 'zefix.ch', 'www.handelsregister.de', 'ised-isde.canada.ca']) expect(isOfficialRegistryHost(h), h).toBe(true);
    for (const h of ['opencorporates.com', 'www.dnb.com', 'northdata.com', 'gov.evil.com', 'localhost', '10.0.0.1', 'en.wikipedia.org']) expect(isOfficialRegistryHost(h), h).toBe(false);
    expect(isOfficialRegistryUrl('http://register.gov.uk/')).toBe(false);
  });
  it('derives a narrow approved domain for a discovered registry and rejects other hosts', () => {
    const r = buildDynamicRegistry('KE', 'https://www.businessregistration.go.ke/search', 'BRS Kenya');
    expect(r).toMatchObject({ dynamic: true, domains: ['businessregistration.go.ke'], dayFirstDates: null });
  });
  it('rejects ambiguous numeric dates when the convention is unknown', () => {
    expect(normalizeDate('03/04/2027', { dayFirst: null })).toBeNull();
    expect(normalizeDate('25/04/2027', { dayFirst: null })).toBe('2027-04-25');
    expect(normalizeDate('04/25/2027')).toBe('2027-04-25');
  });
});

import { normalizeChNumber, parseCompanyPage, parseSearchNumbers } from '@/registries/companiesHouse';
describe('Companies House parsers (layouts captured live 2026-11-03)', () => {
  it('extracts company numbers from the search results HTML, in order, without duplicates', () => {
    const html = '<li>\n<p> 03782379 - Incorporated on 28 May 1999 - Liquidation </p>\n<p>Leeds</p>\n</li><li>\n<p> SC020258 - Incorporated on 15 March 1938 - Liquidation </p></li><li><p> 03782379 - dup </p></li><li><p> 03902700 - Dissolved on 8 October 2026 </p></li>';
    expect(parseSearchNumbers(html)).toEqual(['03782379', 'SC020258', '03902700']);
    expect(parseSearchNumbers('<p>nothing</p>')).toEqual([]);
  });
  it('parses name, status and dates from a company page', () => {
    const md = '* Company Overview for MARKS AND SPENCER GROUP P.L.C. (04256886)\n\n* Registered office address\n* Waterside House, London, W2 1NW\n\n* Company status\n* Active\n\n* Incorporated on\n* 23 July 2001\n';
    expect(parseCompanyPage(md, 'u')).toMatchObject({ number: '04256886', name: 'MARKS AND SPENCER GROUP P.L.C.', status: 'Active', incorporated: '23 July 2001', office: 'Waterside House, London, W2 1NW' });
    expect(parseCompanyPage('<html>redesigned</html>', 'u')).toBeNull();
  });
  it('normalizes company numbers', () => {
    expect(normalizeChNumber('445790')).toBe('00445790');
    expect(normalizeChNumber('sc 020258')).toBe('SC020258');
    expect(normalizeChNumber('abc')).toBeNull();
  });
});

describe('California Medical Board: direct profile by licence number (no CAPTCHA-gated search)', () => {
  const reg = findRegistry('US', 'CA', 'medical_license')!;
  it.each([['A 46271', '46271'], ['a46271', '46271'], ['46271', '46271'], [' A  7 ', '7']])('%s -> profile %s', (input, n) => {
    expect(reg.profileUrl!(input)).toBe(`https://search.dca.ca.gov/profile/800/8002/${n}/A`);
  });
  it.each(['', 'Shin', 'G 12345', '1234567', 'A 12-3'])('%j is not a supported licence number', (input) => expect(reg.profileUrl!(input)).toBeNull());
  it('the profile URL is on an approved official domain', () => expect(isOfficialUrl(reg.profileUrl!('46271')!, reg.domains)).toBe(true));
});

describe('names with short forms and dates with labels (found in live GMC runs)', () => {
  it('matches "Chris" to "Christopher" only as partial, never exact', () => {
    expect(nameMatch('Chris Whitty', 'Christopher John Macrae WHITTY')).toBe('partial');
    expect(nameMatch('Whitty, Christopher', 'Christopher John Macrae WHITTY')).toBe('partial');
    expect(nameMatch('Chris Whitty', 'Christopher Whitley')).toBe('none');
    expect(nameMatch('Smith', 'Smithson')).toBe('none'); // surnames get no tolerance
    expect(nameMatch('Bob Hale', 'Robert Hale')).toBe('partial');
    expect(nameMatch('Chris Hale', 'Christopher Hale', true)).toBe('none'); // businesses get no short-form tolerance
  });
  it.each([
    ['Annual retention fee due date: 01 Aug 2027', '2027-08-01'], ['Full registration date: 01 Aug 1992', '1992-08-01'], ['Expires: 2028-12-31', '2028-12-31'],
    ['Issued 31/03/2027', '2027-03-31'],
  ])('reads the one date in "%s"', (raw, iso) => expect(normalizeDate(raw, { dayFirst: true })).toBe(iso));
  it('refuses a string with two dates and never guesses', () => expect(normalizeDate('Issued 01 Aug 1992, expires 01 Aug 2027')).toBeNull());
});
