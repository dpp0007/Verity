import { after } from 'next/server';
import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { log } from '@/lib/log';
import { ApiError } from '@/lib/errors';
import { buildDynamicRegistry, countryName, type Registry } from '@/lib/registries';
import { resolveCandidates, nameMatch } from '@/lib/matching';
import { normalizeDate, normalizeStatus } from '@/lib/status';
import { computeConfidence } from '@/lib/confidence';
import { isOfficialUrl } from '@/lib/url';
import type { Evidence, NormalizedRecord, Outcome, RecordType, Stage } from '@/lib/schemas';
import { discoverCompanyRegistry, discoverSources } from '@/tinyfish/search';
import { sandboxLookup, sandboxSearch } from '@/vendors/sandbox';
import { chLookup, chSearch, normalizeChNumber, type ChCompany } from '@/registries/companiesHouse';
import { fetchPages } from '@/tinyfish/fetch';
import { runAgent } from '@/tinyfish/agent';
import { TinyFishError } from '@/tinyfish/errors';
import { DETAIL_OUTPUT_SCHEMA, DetailOutput, SEARCH_OUTPUT_SCHEMA, SearchOutput, excerptInPage, siteProblem } from '@/tinyfish/normalization';
import { activity, newId } from './activity';
import { registryOf } from './registry';

export interface StoredResult {
  record: NormalizedRecord | null;
  verification: {
    outcome: Outcome; confidence: 'high' | 'medium' | 'low' | null; confidence_reasons: string[]; checked_at: string;
    source_name: string; source_url: string; evidence: Evidence[]; limitations: string[]; matched_name: string | null;
  };
}
export interface StoredCandidate { full_name: string; license_number: string | null; profession: string | null; status_text: string | null; location: string | null; organization: string | null; record_url: string | null }

const jobs = new Set<Promise<void>>();
/**
 * Runs a verification after the HTTP response is sent. On Vercel `after()` keeps the function alive (up to the route's
 * maxDuration) so the job is not killed when the response returns; outside a request (tests, scripts) it just runs.
 * A job that still dies is surfaced as "interrupted" and re-driven by the maintenance cron (see src/server/maintenance.ts).
 */
export function startJob(id: string) {
  const p = runVerification(id).catch((e) => log('error', 'job.crashed', { id, err: String(e) })).finally(() => jobs.delete(p));
  jobs.add(p);
  try { after(p); } catch { /* not inside a request */ }
}

const setStage = (id: string, stage: Stage) => db.verification.update({ where: { id }, data: { stage } });
const addRun = async (id: string, runId: string) => {
  const v = await db.verification.findUniqueOrThrow({ where: { id }, select: { providerRunIds: true } });
  await db.verification.update({ where: { id }, data: { providerRunIds: JSON.stringify([...JSON.parse(v.providerRunIds), runId]) } });
};

function goalSearch(reg: Registry, v: { name: string; licenseNumber: string | null; region: string | null; subjectType: string }) {
  return [
    `You are on an official public register: ${reg.name}. ${reg.hints}`,
    `Task: search for "${v.name}"${v.licenseNumber ? ` (licence/registration number ${v.licenseNumber})` : ''}${v.region ? ` in ${v.region}` : ''}.`,
    v.subjectType === 'person'
      ? 'This is a search for a PERSON: use the first-name / last-name (individual) fields, never a business-name field. If the form rejects a partial name, try last name only.'
      : 'This is a search for a BUSINESS: use the business/company name field.',
    'If a search button cannot be found after two attempts, press Enter in the name field instead; do not keep re-selecting the same dropdowns.',
    'Enter the name (or the number if one was given), submit the search, and review ALL matching results, using pagination if needed (up to 10 candidates).',
    'For each plausible match return what the results list shows: full name, licence/registration number, profession, status text exactly as displayed, location, organisation, and the URL of the record page if available.',
    'Rules: never invent or infer values; use null when a value is not displayed. Do not decide which candidate is correct. Do not merge candidates. If the register is unreachable or the search could not be submitted, set search_performed=false. If the site shows ANY maintenance, error, outage, rate-limit, bot-check or human-verification message instead of results, copy that message into site_message and set search_performed=false: that is not an empty result. Only if the search genuinely ran and the site itself said nothing matched, set search_performed=true, no_results=true and candidates=[].',
  ].join('\n');
}

function goalDetail(reg: Registry, c: StoredCandidate) {
  return [
    `You are on an official public register: ${reg.name}. ${reg.hints}`,
    `Open the single record for: name "${c.full_name}"${c.license_number ? `, number ${c.license_number}` : ''}${c.location ? `, location ${c.location}` : ''}${c.record_url ? `, record page ${c.record_url}` : ''}.`,
    'Extract exactly what the record page displays: full name, licence/registration number, profession, status text verbatim, issue/registration date and expiry date as displayed, and any public disciplinary/enforcement actions (one string each).',
    'Do not submit any form. Never attempt to solve, click through or bypass a CAPTCHA or human-verification challenge: if one blocks the record page, set record_opened=false.',
    'Set disciplinary_section_visible=true only if the page actually has a disciplinary/enforcement/conditions section (even if empty); otherwise false.',
    'In excerpts, copy VERBATIM short text snippets from the page that show the status, the number and the expiry date (field = status|number|expiry_date|name|disciplinary). Never paraphrase excerpts. Use null for anything not displayed. Do not open any other person\'s record.',
  ].join('\n');
}

async function fail(id: string, e: unknown) {
  const v = await db.verification.findUnique({ where: { id } });
  if (!v) return;
  const tf = e instanceof TinyFishError ? e : null;
  const outcome: Outcome = tf ? tf.userFacingOutcome : 'failed';
  const code = tf ? `provider_${tf.kind}` : 'internal_error';
  const message = tf
    ? tf.message.includes('company-data provider') ? tf.message
    : tf.kind === 'auth' ? 'TinyFish rejected the API credentials (invalid or expired key). No verification result was produced.'
    : tf.kind === 'billing' ? 'TinyFish reports insufficient credits. No verification result was produced.'
    : tf.message
    : 'Unexpected error while verifying. No verification result was produced.';
  log('error', 'verification.failed', { id, code, msg: tf?.message ?? String(e), requestId: tf?.opts.requestId });
  await db.verification.update({ where: { id }, data: { state: 'failed', outcome, errorJson: JSON.stringify({ code, message, retryable: tf?.retryable ?? false }) } });
  await activity(v.ownerId, 'verification.failed', `Verification failed: ${message}`, { verification_id: id });
  if (v.kind === 'recheck' && v.monitorId) await (await import('./monitoring')).onRecheckFinished(id).catch((x) => log('error', 'recheck.finish', { err: String(x) }));
}

async function finish(id: string, outcome: Outcome, result: StoredResult, state: 'completed' | 'awaiting_selection' = 'completed') {
  const v = await db.verification.update({ where: { id }, data: { state, stage: null, outcome, resultJson: JSON.stringify(result), errorJson: null } });
  if (state === 'completed') await activity(v.ownerId, 'verification.completed', `Verification completed: ${outcome.replace('_', ' ')} (${v.name})`, { verification_id: id });
  if (v.kind === 'recheck' && v.monitorId) await (await import('./monitoring')).onRecheckFinished(id);
}

async function runVerification(id: string): Promise<void> {
  const claimed = await db.verification.updateMany({ where: { id, state: 'queued' }, data: { state: 'running' } });
  if (claimed.count === 0) return;
  try {
    const v = await db.verification.findUniqueOrThrow({ where: { id }, include: { candidates: true } });
    let reg = registryOf(v);
    const limitations: string[] = [];
    if (!reg && v.registryId?.startsWith('dyn-')) {
      // Company register for a country with no configured registry: discover it, official government sources only.
      await setStage(id, 'finding_source');
      const cname = countryName(v.country);
      const hit = v.sourceUrlInput ? { url: v.sourceUrlInput, title: '' } : await discoverCompanyRegistry(v.country, cname);
      if (!hit) {
        await finish(id, 'unsupported', { record: null, verification: { outcome: 'unsupported', confidence: null, confidence_reasons: [], checked_at: new Date().toISOString(), source_name: `No official company register identified for ${cname}`, source_url: '', evidence: [], limitations: [`Verity could not identify an official government company register for ${cname}. Nothing was searched and no result was produced; use the registry's own website.`], matched_name: null } });
        return;
      }
      reg = buildDynamicRegistry(v.country, hit.url, hit.title);
      await db.verification.update({ where: { id }, data: { registryJson: JSON.stringify(reg) } });
      await activity(v.ownerId, 'registry.discovered', `Official register discovered for ${cname}: ${hit.url}`, { verification_id: id, registry_id: reg.id });
      limitations.push('This registry was discovered automatically and has not been reviewed by Verity.');
    }
    if (!reg) throw new ApiError(500, 'registry_missing', 'Registry configuration missing');
    const selected = v.candidates.find((c) => c.selected);
    if (selected) {
      await completeWithCandidate(id, reg, JSON.parse(selected.dataJson), 'user_selected');
      return;
    }

    // Direct public record page from a licence number: no search form (and so no CAPTCHA-gated search) is involved.
    const direct = v.licenseNumber ? reg.profileUrl?.(v.licenseNumber) : null;
    if (direct) {
      await completeWithCandidate(id, reg, { full_name: v.name, license_number: v.licenseNumber, profession: null, status_text: null, location: null, organization: null, record_url: direct }, 'license_number', limitations);
      return;
    }
    let entry = reg.method !== 'agent' ? reg.searchEntry : (v.sourceUrlInput ?? reg.searchEntry);
    let cands: StoredCandidate[];
    if (reg.method === 'vendor') {
      cands = await vendorSearch(id, v);
    } else if (reg.method === 'fetch') {
      cands = await fetchSearch(id, v);
    } else {
    // 1. Source discovery (Search) - finds the official entry point; never proves a status.
    await setStage(id, 'finding_source');
    if (!v.sourceUrlInput && !reg.dynamic) {
      try {
        const hits = await discoverSources(`${reg.name} ${v.recordType.replace('_', ' ')} search`, reg.domains, reg.country);
        await activity(v.ownerId, 'registry.discovered', hits.length ? `Official source discovered: ${hits[0].url}` : `No search hit on approved domains; using configured entry ${reg.searchEntry}`, { verification_id: id, registry_id: reg.id });
        // Search results are pointers only; the configured entry stays authoritative unless a hit is on the same host.
        if (hits[0] && new URL(hits[0].url).hostname === new URL(reg.searchEntry).hostname) entry = hits[0].url;
      } catch (e) {
        if (e instanceof TinyFishError && (e.kind === 'auth' || e.kind === 'billing')) throw e;
        limitations.push('Automated source discovery was unavailable; the configured official registry entry point was used.');
      }
    }

    // 2. Registry search (Agent).
    await setStage(id, 'searching_registry');
    const { runId, result } = await runAgent({ url: entry, goal: goalSearch(reg, v), outputSchema: SEARCH_OUTPUT_SCHEMA, onStart: (r) => addRun(id, r) });
    const parsed = SearchOutput.safeParse(result);
    if (!parsed.success) throw new TinyFishError('malformed', 'Registry search output failed validation', { providerRunId: runId });
    const out = parsed.data;
    await activity(v.ownerId, 'search.completed', `Registry search completed (${out.candidates.length} candidate(s))`, { verification_id: id, run_id: runId });
    const problem = !out.candidates.length ? siteProblem(out) : null;
    if (!out.search_performed || problem) throw new TinyFishError('unavailable', `${problem ?? out.notes ?? 'The registry search could not be completed.'} This is not a "no match" result.`, { providerRunId: runId });

    cands = out.candidates.map((c) => ({ ...c, record_url: c.record_url && isOfficialUrl(c.record_url, reg.domains) ? c.record_url : null }));
    }
    const rows = cands.map((c) => ({ id: newId('cand'), verificationId: id, dataJson: JSON.stringify(c) }));
    if (rows.length) await db.candidate.createMany({ data: rows });

    // 3. Compare.
    await setStage(id, 'comparing_records');
    const base = { source_name: reg.name, source_url: entry, checked_at: new Date().toISOString(), evidence: [] as Evidence[], matched_name: null };
    if (!cands.length) {
      await finish(id, 'not_found', { record: null, verification: { ...base, outcome: 'not_found', confidence: null, confidence_reasons: [], limitations: [...limitations, `No record matched in ${reg.name}. A no-match result does not prove the subject is unlicensed or unregistered: try alternative spellings or a licence/registration number.`] } });
      return;
    }
    const res = resolveCandidates({ name: v.name, licenseNumber: v.licenseNumber, business: v.subjectType === 'business' }, rows.map((r, i) => ({ id: r.id, ...cands[i] })));
    if (res.kind === 'unique') {
      const i = rows.findIndex((r) => r.id === res.candidate.id);
      await db.candidate.update({ where: { id: rows[i].id }, data: { selected: true } });
      await completeWithCandidate(id, reg, cands[i], res.by === 'license_number' ? 'license_number' : 'exact_unique_name', limitations);
      return;
    }
    await finish(id, 'ambiguous', { record: null, verification: { ...base, outcome: 'ambiguous', confidence: null, confidence_reasons: [], limitations: [...limitations, 'Several records could plausibly match. Choose the correct one; Verity will not guess.'] } }, 'awaiting_selection');
  } catch (e) {
    await fail(id, e);
  }
}

const chCandidate = (c: ChCompany): StoredCandidate => ({ full_name: c.name, license_number: c.number, profession: c.type, status_text: c.status, location: c.office, organization: null, record_url: c.url });

/** Companies House via TinyFish Fetch: direct lookup when a number is given, otherwise name search. */
async function fetchSearch(id: string, v: { ownerId: string; name: string; licenseNumber: string | null }): Promise<StoredCandidate[]> {
  await setStage(id, 'searching_registry');
  const num = v.licenseNumber ? normalizeChNumber(v.licenseNumber) : null;
  const found = num ? [...(await chLookup([num])).values()].filter((c): c is ChCompany => !!c) : await chSearch(v.name);
  await activity(v.ownerId, 'search.completed', `Companies House search completed (${found.length} candidate(s))`, { verification_id: id });
  // Registers search fuzzily ("Holdings Limited" alone matches thousands). Unrelated names are not candidates.
  return found.map(chCandidate).filter((c) => num || nameMatch(v.name, c.full_name, true) !== 'none');
}

async function completeFetched(id: string, reg: Registry, cand: StoredCandidate, identification: 'license_number' | 'exact_unique_name' | 'user_selected', limitations: string[]) {
  const v = await db.verification.findUniqueOrThrow({ where: { id } });
  await setStage(id, 'verifying_evidence');
  const c = (await chLookup([cand.license_number!])).get(cand.license_number!); // fresh fetch of the record page
  if (!c) throw new TinyFishError('unavailable', 'The company page could not be found when re-reading it. This is not evidence about its status.');
  const at = new Date().toISOString();
  const status = normalizeStatus(c.status);
  const issue = normalizeDate(c.incorporated, { dayFirst: true });
  if (status === 'unknown') limitations.push(c.status ? `Source status "${c.status}" is not a recognised status and is reported as unknown.` : 'The source did not display a status.');
  if (c.dissolved) limitations.push(`The source reports the company dissolved on ${c.dissolved}.`);
  limitations.push('Companies House does not publish an expiry date or disciplinary actions for companies; both are unavailable (null).');
  const lines = [`Company Overview for ${c.name} (${c.number})`, c.status ? `Company status ${c.status}` : null, c.incorporated ? `Incorporated on ${c.incorporated}` : null].filter((x): x is string => !!x);
  const evidence: Evidence[] = lines.map((l, i) => ({ url: c.url, excerpt: l, fields: [i === 0 ? 'name' : l.startsWith('Company status') ? 'status' : 'issue_date'], fetched_at: at, validated: excerptInPage(l, c.text) }));
  const conf = computeConfidence({ identification, nameMatch: nameMatch(v.name, c.name, true), hasNumber: true, status, statusEvidenceValidated: evidence.some((e) => e.fields[0] === 'status' && e.validated), hasStatusExcerpt: true, conflicting: false });
  const record: NormalizedRecord = { type: v.recordType as RecordType, number: c.number, status, source_status: c.status, issue_date: issue, expiry_date: null, disciplinary_actions: null };
  await finish(id, conf.outcome, { record, verification: { outcome: conf.outcome, confidence: conf.level, confidence_reasons: conf.reasons, checked_at: at, source_name: reg.name, source_url: c.url, evidence, limitations, matched_name: c.name } });
}

async function vendorSearch(id: string, v: { ownerId: string; name: string; licenseNumber: string | null }): Promise<StoredCandidate[]> {
  await setStage(id, 'searching_registry');
  const cin = v.licenseNumber && /^[A-Z0-9]{21}$/i.test(v.licenseNumber.trim()) ? v.licenseNumber.trim().toUpperCase() : null;
  const found = cin ? await sandboxLookup(cin).then((m) => (m ? [{ cin: m.cin, company_name: m.company_name }] : [])) : await sandboxSearch(v.name);
  await activity(v.ownerId, 'search.completed', `Company data search completed (${found.length} candidate(s))`, { verification_id: id });
  return found.filter((r) => !!cin || nameMatch(v.name, r.company_name, true) !== 'none').map((r) => ({ full_name: r.company_name, license_number: r.cin, profession: null, status_text: null, location: null, organization: null, record_url: null }));
}

async function completeVendor(id: string, reg: Registry, cand: StoredCandidate, identification: 'license_number' | 'exact_unique_name' | 'user_selected', limitations: string[]) {
  const v = await db.verification.findUniqueOrThrow({ where: { id } });
  await setStage(id, 'verifying_evidence');
  const m = cand.license_number ? await sandboxLookup(cand.license_number) : null;
  if (!m) throw new TinyFishError('unavailable', 'The data provider returned no master data for this company. This is not evidence about its status.');
  const at = new Date().toISOString();
  const status = normalizeStatus(m.company_status);
  const issue = normalizeDate(m.company_registration_date, { dayFirst: true });
  if (status === 'unknown') limitations.push(m.company_status ? `Provider status "${m.company_status}" is not a recognised status and is reported as unknown.` : 'The provider did not return a status.');
  limitations.push('Data comes from a licensed third-party provider reporting MCA records; it was not read from the MCA website and is not independently confirmed.');
  if (m.updated_at) limitations.push(`Provider data refreshed ${new Date(m.updated_at).toISOString().slice(0, 10)}.`);
  limitations.push('MCA records have no expiry date or disciplinary section; both are unavailable (null). No direct MCA record page exists (CAPTCHA-gated), so the MCA lookup page is shown as the place to confirm.');
  const evidence: Evidence[] = [
    { url: reg.searchEntry, excerpt: `company_status: ${m.company_status ?? 'null'}`, fields: ['status'], fetched_at: at, validated: false },
    { url: reg.searchEntry, excerpt: `cin: ${m.cin}`, fields: ['number'], fetched_at: at, validated: false },
  ];
  const nm = nameMatch(v.name, m.company_name, true);
  const conf = computeConfidence({ identification, nameMatch: nm, hasNumber: true, status, statusEvidenceValidated: false, hasStatusExcerpt: true, conflicting: false });
  const record: NormalizedRecord = { type: v.recordType as RecordType, number: m.cin, status, source_status: m.company_status ?? null, issue_date: issue, expiry_date: null, disciplinary_actions: null };
  await finish(id, conf.outcome, { record, verification: { outcome: conf.outcome, confidence: conf.level, confidence_reasons: conf.reasons, checked_at: at, source_name: reg.name, source_url: reg.searchEntry, evidence, limitations, matched_name: m.company_name } });
}

export async function completeWithCandidate(
  id: string, reg: Registry, cand: StoredCandidate,
  identification: 'license_number' | 'exact_unique_name' | 'user_selected', limitations: string[] = [],
) {
  if (reg.method === 'vendor') return completeVendor(id, reg, cand, identification, limitations);
  if (reg.method === 'fetch') return completeFetched(id, reg, cand, identification, limitations);
  const v = await db.verification.findUniqueOrThrow({ where: { id } });
  await setStage(id, 'verifying_evidence');
  const entry = cand.record_url ?? reg.searchEntry;
  const { runId, result } = await runAgent({ url: entry, goal: goalDetail(reg, cand), outputSchema: DETAIL_OUTPUT_SCHEMA, onStart: (r) => addRun(id, r) });
  const parsed = DetailOutput.safeParse(result);
  if (!parsed.success) throw new TinyFishError('malformed', 'Record output failed validation', { providerRunId: runId });
  let d = parsed.data;
  if (!d.record_opened) throw new TinyFishError('unavailable', d.notes ?? 'The record page could not be opened. This is not evidence about the licence status.', { providerRunId: runId });

  const recordUrl = [d.record_url, cand.record_url].find((u) => u && isOfficialUrl(u, reg.domains)) ?? null;
  if (d.record_url && !isOfficialUrl(d.record_url, reg.domains)) limitations.push('A record URL outside the approved official domains was ignored.');
  const sourceUrl = recordUrl ?? reg.searchEntry;
  if (!recordUrl) limitations.push('No direct record URL was available; the registry search page is shown as the source.');

  // Independent re-fetch of the record page to validate agent excerpts.
  let pageText: string | null = null;
  const fetchedAt = new Date().toISOString();
  if (recordUrl) {
    try {
      const f = await fetchPages([recordUrl]);
      const page = f.pages[0];
      if (page?.text) {
        pageText = page.text;
        if (!isOfficialUrl(page.finalUrl, reg.domains)) { pageText = null; limitations.push('The record page redirected outside the official domains; page content was discarded.'); }
      } else limitations.push(`Independent page fetch failed (${f.errors[0]?.error ?? 'empty content'}); excerpts could not be re-confirmed.`);
    } catch (e) {
      if (e instanceof TinyFishError && (e.kind === 'auth' || e.kind === 'billing')) throw e;
      limitations.push('Independent page fetch was unavailable; excerpts could not be re-confirmed.');
    }
  } else limitations.push('Excerpts could not be re-confirmed without a direct record URL.');

  // Some official pages render status with script, so Fetch cannot see it and an agent read is the only evidence.
  // Agent reads vary (a misspelt name, a missed date), so take further separate reads and require two of three to agree
  // on status, number and expiry. A consensus can overrule an outlier first read. This is labelled as such; it is
  // never presented as a Fetch confirmation.
  let confirmedByReads = false;
  const fetchSawStatus = !!pageText && d.excerpts.some((x) => /status/i.test(x.field) && excerptInPage(x.text, pageText!));
  if (recordUrl && !fetchSawStatus && d.status_text) {
    const norm = (a: string | null | undefined) => (a ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const agree = (x: typeof d, y: typeof d) => norm(x.status_text) === norm(y.status_text) && norm(x.license_number) === norm(y.license_number) && norm(x.expiry_date_text) === norm(y.expiry_date_text);
    const reads: Array<typeof d> = [d];
    try {
      for (let n = 0; n < 2 && !(reads.length >= 2 && reads.some((x, i) => reads.some((y, j) => i < j && agree(x, y)))); n++) {
        const next = await runAgent({ url: recordUrl, goal: goalDetail(reg, cand), outputSchema: DETAIL_OUTPUT_SCHEMA, onStart: (r) => addRun(id, r) });
        const p = DetailOutput.safeParse(next.result);
        if (p.success && p.data.record_opened) reads.push(p.data);
      }
    } catch (e) {
      if (e instanceof TinyFishError && (e.kind === 'auth' || e.kind === 'billing')) throw e;
    }
    const pair = reads.flatMap((x, i) => reads.slice(i + 1).map((y) => [x, y] as const)).find(([x, y]) => agree(x, y));
    if (pair) {
      confirmedByReads = true;
      if (pair[0] !== d) { d = pair[0]; limitations.push('The first browser read disagreed with two later reads and was discarded in favour of the consensus.'); }
      limitations.push(`Confirmed by ${reads.length} separate browser reads of the official page, ${pair.length} of which agree (Fetch could not see this page's status).`);
    } else limitations.push(reads.length < 2 ? 'A second browser read was unavailable; excerpts were not confirmed.' : 'Separate browser reads of the official page did not agree, so the excerpts were not confirmed.');
  }

  const evidence: Evidence[] = d.excerpts.map((x) => ({
    url: sourceUrl, excerpt: x.text.slice(0, 600), fields: [x.field], fetched_at: fetchedAt,
    validated: confirmedByReads || (pageText ? excerptInPage(x.text, pageText) : false),
  }));
  if (pageText) {
    await db.evidenceSnapshot.create({ data: { id: newId('ev'), verificationId: id, url: recordUrl!, fetchedAt: new Date(fetchedAt), contentHash: createHash('sha256').update(pageText).digest('hex'), excerptsJson: JSON.stringify(evidence), text: pageText.slice(0, 60_000) } });
  }

  const status = normalizeStatus(d.status_text);
  if (status === 'unknown') limitations.push(d.status_text ? `Source status "${d.status_text}" is not a recognised status and is reported as unknown.` : 'The source did not display a status.');
  const expiry = normalizeDate(d.expiry_date_text, { dayFirst: reg.dayFirstDates });
  const issue = normalizeDate(d.issue_date_text, { dayFirst: reg.dayFirstDates });
  if (d.expiry_date_text && !expiry) limitations.push(`Expiry date "${d.expiry_date_text}" could not be parsed unambiguously.`);
  else if (!d.expiry_date_text) limitations.push('The source does not display an expiry date.');
  if (d.issue_date_text && !issue) limitations.push(`Issue date "${d.issue_date_text}" could not be parsed unambiguously.`);
  if (!d.disciplinary_section_visible) limitations.push('The source page shows no disciplinary information section; disciplinary history is unavailable (not confirmed empty).');
  if (!d.license_number && !cand.license_number) limitations.push('No licence/registration number was shown.');

  const number = d.license_number ?? cand.license_number;
  const conflicting =
    (!!d.license_number && !!cand.license_number && d.license_number.replace(/\s/g, '') !== cand.license_number.replace(/\s/g, '')) ||
    (!!d.full_name && nameMatch(cand.full_name, d.full_name, v.subjectType === 'business') === 'none');
  if (conflicting) limitations.push('The record page conflicts with the candidate list (different name or number).');

  const nm = nameMatch(v.name, d.full_name ?? cand.full_name, v.subjectType === 'business');
  const statusEv = evidence.filter((e) => e.fields.some((f) => /status/i.test(f)));
  let conf = computeConfidence({
    identification, nameMatch: nm, hasNumber: !!number, status,
    statusEvidenceValidated: statusEv.some((e) => e.validated), hasStatusExcerpt: statusEv.length > 0, conflicting,
  });

  if (reg.dynamic && conf.level === 'high') {
    conf = { level: 'medium', outcome: 'partially_verified', reasons: [...conf.reasons, 'The registry was discovered automatically and has not been reviewed by Verity, so confidence is capped at medium.'] };
  }
  const record: NormalizedRecord = {
    type: v.recordType as RecordType, number, status, source_status: d.status_text, issue_date: issue, expiry_date: expiry,
    disciplinary_actions: d.disciplinary_section_visible ? d.disciplinary_actions : null,
  };
  await finish(id, conf.outcome, {
    record,
    verification: { outcome: conf.outcome, confidence: conf.level, confidence_reasons: conf.reasons, checked_at: fetchedAt, source_name: reg.name, source_url: sourceUrl, evidence, limitations, matched_name: d.full_name ?? cand.full_name },
  });
}

/** Resolves when all in-process jobs (including ones they spawn) have finished. Used by tests and the worker. */
export async function settleJobs() {
  while (jobs.size) await Promise.allSettled([...jobs]);
}
