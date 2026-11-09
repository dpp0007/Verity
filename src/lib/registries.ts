import type { RecordType } from './schemas';

export interface Registry {
  id: string;
  name: string;
  authority: string;
  country: string;
  /** Jurisdictions (state/province codes). Empty = national registry; region is optional. */
  regions: string[];
  subjectType: 'person' | 'business';
  recordTypes: RecordType[];
  /** Approved official domains. Every source/record URL must belong to one of these. */
  domains: string[];
  searchEntry: string;
  /** 'agent' = TinyFish browser agent; 'fetch' = TinyFish Fetch on server-rendered official pages; 'vendor' = licensed third-party API. */
  method: 'agent' | 'vendor' | 'fetch';
  /** Environment variables a vendor registry needs before it can be used. */
  requiresEnv?: string[];
  /** Set when a live test showed the site cannot be automated (e.g. CAPTCHA). Requests are refused immediately instead of running for minutes. */
  blocked?: string;
  /** Direct public record URL built from a licence number. Lets a blocked search be skipped: the record page itself needs no search form. */
  profileUrl?: (licenseNumber: string) => string | null;
  /** Fields the public register is expected to expose (to be confirmed by the live smoke test). */
  availableFields: string[];
  /** null = unknown convention (ambiguous numeric dates are rejected rather than guessed). */
  dayFirstDates: boolean | null;
  limitations: string[];
  /** Registry-specific navigation hints appended to the generic agent instructions. */
  hints: string;
  /** Set to true only after `npm run smoke` passed against the live registry; recorded in docs/REGISTRIES.md. */
  livePassed: boolean;
  /** true for registries discovered at request time rather than configured and reviewed. */
  dynamic?: boolean;
}

export const REGISTRIES: Registry[] = [
  {
    id: 'us-ca-medical-board',
    name: 'Medical Board of California (DCA License Search)',
    authority: 'Medical Board of California / CA Department of Consumer Affairs',
    country: 'US', regions: ['CA'], subjectType: 'person', recordTypes: ['medical_license'],
    domains: ['mbc.ca.gov', 'search.dca.ca.gov', 'dca.ca.gov'],
    searchEntry: 'https://search.dca.ca.gov/',
    method: 'agent',
    availableFields: ['full_name', 'license_number', 'status', 'issue_date', 'expiry_date', 'disciplinary_actions'],
    dayFirstDates: false,
    limitations: ['Name search is unavailable (the DCA search form uses a CAPTCHA, which Verity does not bypass). Lookup by Physician and Surgeon ("A") licence number opens the public profile page directly, which has no CAPTCHA. Other licence types are not supported.', 'Public search is a DCA-wide tool; the agent must restrict the board to the Medical Board of California.', 'Disciplinary details may be provided as linked documents.'],
    hints: 'You are on a public Medical Board of California licence profile page (search.dca.ca.gov/profile/...). Read the licence status, issue date, expiration date and any Public Record Actions shown on this page. Do not use the search form. The licence details are loaded by script: wait at most 10 seconds for the licence status and dates to appear, then read the page once. Copy the name, number, status and dates exactly as displayed, character for character. Do not reload or retry the page more than once.',
    blocked: 'Searching by name is not possible: the DCA search form is protected by a CAPTCHA and Verity does not bypass CAPTCHAs. Enter the physician licence number (e.g. A 46271) and Verity will open the public licence profile directly.',
    profileUrl: (n) => { const m = /^A?\s*(\d{1,6})$/i.exec(n.trim()); return m ? `https://search.dca.ca.gov/profile/800/8002/${m[1]}/A` : null; },
    livePassed: true,
  },
  {
    id: 'gb-gmc-register',
    name: 'General Medical Council — The Medical Register',
    authority: 'General Medical Council (UK)',
    country: 'GB', regions: [], subjectType: 'person', recordTypes: ['medical_license'],
    domains: ['gmc-uk.org'],
    searchEntry: 'https://www.gmc-uk.org/registrants/',
    method: 'agent',
    availableFields: ['full_name', 'license_number', 'status', 'registration_date', 'licence_to_practise'],
    dayFirstDates: true,
    limitations: ['GMC numbers are 7 digits. The register shows whether a doctor holds a licence to practise.', 'Fitness-to-practise outcomes are published on separate pages and may not be on the record page.'],
    hints: 'This is the GMC List of Registered Medical Practitioners. Search by name or GMC reference number, open the practitioner page, and read registration status, whether they have a licence to practise, and any published restrictions/conditions or fitness-to-practise notes.',
    livePassed: false,
  },
  {
    id: 'gb-companies-house',
    name: 'Companies House — Find and update company information',
    authority: 'Companies House (UK Government)',
    country: 'GB', regions: [], subjectType: 'business', recordTypes: ['company_registration'],
    domains: ['company-information.service.gov.uk', 'companieshouse.gov.uk'],
    searchEntry: 'https://find-and-update.company-information.service.gov.uk/',
    method: 'fetch',
    availableFields: ['company_name', 'company_number', 'status', 'incorporation_date', 'company_type', 'registered_office'],
    dayFirstDates: true,
    limitations: ['Companies House does not expose licence-style expiry dates or disciplinary actions; those are returned as unavailable (null).'],
    hints: 'This is Companies House company search. Search by company name or 8-character company number, open each plausible company page, and read the company status (e.g. Active, Dissolved), company number, incorporation date and registered office. Do not use the officer search.',
    livePassed: true,
  },
  {
    id: 'in-company-vendor',
    name: 'MCA company data via Sandbox (licensed third-party API)',
    authority: 'Ministry of Corporate Affairs (India), reported by a licensed provider',
    country: 'IN', regions: [], subjectType: 'business', recordTypes: ['company_registration'],
    domains: ['mca.gov.in'],
    searchEntry: 'https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html',
    method: 'vendor', requiresEnv: ['VERITY_ENABLE_THIRD_PARTY_VENDORS', 'SANDBOX_API_KEY', 'SANDBOX_API_SECRET'], // third-party data is opt-in: Verity is TinyFish-only by default
    availableFields: ['company_name', 'cin', 'status', 'registration_date', 'company_class', 'registered_office'],
    dayFirstDates: true,
    limitations: ['Data is supplied by a licensed third party (Sandbox) and not read from the MCA website; it is not independently confirmed, so confidence is capped at medium.', 'The MCA lookup itself needs a CAPTCHA, so there is no direct record URL and monitoring is unavailable.', 'Live-tested 2026-11-03 with a Sandbox production account.'],
    hints: '',
    livePassed: false,
  },
  {
    id: 'us-ca-cslb',
    name: 'Contractors State License Board — License Check',
    authority: 'California Contractors State License Board (CSLB)',
    country: 'US', regions: ['CA'], subjectType: 'business', recordTypes: ['contractor_license'],
    domains: ['cslb.ca.gov'],
    searchEntry: 'https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx',
    method: 'agent',
    availableFields: ['business_name', 'license_number', 'status', 'issue_date', 'expiry_date', 'classifications', 'bond', 'disciplinary_actions'],
    dayFirstDates: false,
    limitations: ['The tool has separate searches by licence number and by business name; the agent should use licence number when provided.', 'Detail pages are session-based, so a durable direct record URL may not exist (monitoring then falls back to unsupported).'],
    hints: 'This is the CSLB Check a License tool. Search by licence number when one is given, otherwise by business name. Open the licence detail page and read licence status, issue and expiration dates, classifications and any disciplinary/complaint disclosure. If the detail page URL is session-specific, still report the URL you observed.',
    livePassed: false,
  },
  {
    id: 'in-nmc-medical-register',
    name: 'National Medical Commission — Indian Medical Register',
    authority: 'National Medical Commission (India)',
    country: 'IN', regions: [], subjectType: 'person', recordTypes: ['medical_license'],
    domains: ['nmc.org.in'],
    searchEntry: 'https://www.nmc.org.in/information-desk/indian-medical-register/',
    method: 'agent',
    availableFields: ['full_name', 'registration_number', 'state_medical_council', 'year_of_registration', 'qualification'],
    dayFirstDates: true,
    limitations: ['Not live-tested. The register may sit behind a CAPTCHA; if so searches will fail as temporarily unavailable.', 'The register lists registration, council and qualification; it may not show a current licence status or expiry (those stay null/unknown).'],
    hints: 'This is the Indian Medical Register of the National Medical Commission (also reachable as the National Medical Register). Search by name (and State Medical Council / year of registration if offered) or by registration number, open each plausible doctor record, and read the registration number, council, year of registration and any status or remarks exactly as displayed.',
    livePassed: false,
  },
];

export const registryById = (id: string) => REGISTRIES.find((r) => r.id === id);

export function findRegistry(country: string, region: string | null, recordType: RecordType): Registry | null {
  return (
    REGISTRIES.find((r) => r.country === country && r.recordTypes.includes(recordType) && (r.regions.length === 0 || (region && r.regions.includes(region)))) ?? null
  );
}

/** Combinations where a live test showed the official public lookup cannot be automated. Refused up front instead of timing out. */
export const KNOWN_BLOCKED: Record<string, string> = {};

export function supportMessage(country: string, region: string | null, recordType: RecordType): string {
  const sameType = REGISTRIES.filter((r) => r.recordTypes.includes(recordType));
  if (!sameType.length) return `Record type "${recordType}" is not supported.`;
  if (recordType === 'company_registration') return 'Company registrations are supported in any country.';
  const where = sameType.map((r) => `${r.country}${r.regions.length ? '-' + r.regions.join('/') : ''}`).join(', ');
  return `No supported official registry for ${recordType} in ${country}${region ? '-' + region : ''}. Supported: ${where}.`;
}

// ---- Company registers for any country: discovered at request time ----

const OFFICIAL_LABELS = new Set(['gov', 'gob', 'gouv', 'govt', 'gv', 'go', 'gc', 'government', 'overheid', 'admin', 'bund', 'europa']);
/** Well-known official registers whose hostnames carry no government label. Aggregators (OpenCorporates, D&B, ...) are never listed. */
const KNOWN_REGISTER_HOSTS = ['handelsregister.de', 'kvk.nl', 'bolagsverket.se', 'brreg.no', 'virk.dk', 'prh.fi', 'zefix.ch', 'infogreffe.fr', 'canada.ca', 'ised-isde.canada.ca', 'ic.gc.ca'];

export function isOfficialRegistryHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || /^[\d.]+$/.test(h) || h.includes(':')) return false;
  const labels = h.split('.');
  // The government label must sit where only a registrar can grant it: the TLD itself (.gov) or the second level under a ccTLD (gov.uk, go.ke, gob.mx).
  // 'gov.evil.com' therefore fails.
  const last = labels[labels.length - 1], second = labels[labels.length - 2];
  const govHost = last === 'gov' || (last.length === 2 && !!second && OFFICIAL_LABELS.has(second));
  return govHost || KNOWN_REGISTER_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}
export function isOfficialRegistryUrl(raw: string): boolean {
  try { const u = new URL(raw); return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443') && isOfficialRegistryHost(u.hostname); } catch { return false; }
}
export const countryName = (code: string) => { try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code; } catch { return code; } };

/** Approved domain for a discovered registry: the government-label host and its subdomains (e.g. registry.gov.xx). */
function approvedDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.');
  const last = labels[labels.length - 1];
  const take = last === 'gov' ? 2 : last.length === 2 && OFFICIAL_LABELS.has(labels[labels.length - 2] ?? '') ? 3 : labels.length;
  return labels.slice(-take).join('.');
}

export function buildDynamicRegistry(country: string, entryUrl: string, title: string): Registry {
  const host = new URL(entryUrl).hostname;
  const name = countryName(country);
  return {
    id: `dyn-${country}`, name: title.slice(0, 120) || `Official company register (${name})`, authority: `Official company register of ${name} (discovered automatically)`,
    country, regions: [], subjectType: 'business', recordTypes: ['company_registration'], domains: [approvedDomain(host)], searchEntry: entryUrl, method: 'agent',
    availableFields: ['company_name', 'company_number', 'status', 'incorporation_date'], dayFirstDates: null,
    limitations: ['This registry was discovered automatically and has not been reviewed by Verity; confidence is capped at medium.', 'The register may be in another language and may not expose every field.'],
    hints: `This is the official company register of ${name}. The page may be in a language other than English. Find the search by company name or registration number (not officers, trademarks or individuals), open each plausible company record, and read the legal name, registration number, legal status exactly as displayed, and registration/incorporation date.`,
    livePassed: false, dynamic: true,
  };
}
