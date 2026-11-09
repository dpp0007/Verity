'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { countryName } from '@/lib/registries';
import { api, ApiFail } from '@/lib/client';
import { Loading, Notice } from '@/components/ui';

interface Reg { id: string; name: string; country: string; regions: string[]; subject_type: 'person' | 'business'; record_types: string[]; live_tested: boolean; blocked: string | null; method: string }

const TYPES = [
  { id: 'company_registration', title: 'Company', desc: 'Business registrations, any country', icon: [1, 3, 4, 5, 7] },
  { id: 'medical_license', title: 'Doctor', desc: 'Medical practitioners', icon: [1, 3, 4, 5, 7, 4] },
  { id: 'contractor_license', title: 'Contractor', desc: 'Trade licences', icon: [0, 2, 4, 6, 8] },
] as const;
const COMPANY_WORDS = /\b(ltd|limited|plc|p\.l\.c|llc|inc|corp|corporation|llp|gmbh|pvt|company|co\.)(?=\W|$)/i;
const COUNTRY: Record<string, string> = { US: 'United States', GB: 'United Kingdom', IN: 'India' };

function Glyph({ cells, on }: { cells: readonly number[]; on: boolean }) {
  return (
    <span className="grid shrink-0 grid-cols-3 gap-[2px]" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => <i key={i} className="block h-[7px] w-[7px]" style={{ background: cells.includes(i) ? (on ? 'var(--ink)' : 'var(--mute)') : 'var(--line)' }} />)}
    </span>
  );
}

/** Reserved, transitional and obsolete ISO codes that Intl still names: not places with a company register. */
const NOT_COUNTRIES = new Set(['AC', 'CP', 'DG', 'EA', 'IC', 'TA', 'EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'AN', 'BU', 'CS', 'DD', 'DY', 'FX', 'HV', 'NH', 'RH', 'SU', 'TP', 'UK', 'VD', 'YD', 'YU', 'ZR']);

export default function VerifyPage() {
  const router = useRouter();
  const [regs, setRegs] = useState<Reg[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', record_type: 'company_registration', country: 'GB', region: '', license_number: '', source_url: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<ApiFail | null>(null);
  const key = useRef<string>('');

  useEffect(() => { api<{ registries: Reg[] }>('/api/v1/registries').then((d) => setRegs(d.registries)).catch((e) => setLoadErr(e.message)); }, []);

  const isCompany = f.record_type === 'company_registration';
  const forType = useMemo(() => (regs ?? []).filter((r) => r.record_types.includes(f.record_type)), [regs, f.record_type]);
  // Company registers work worldwide (the official register is discovered), so every ISO country is offered.
  const allCountries = useMemo(() => {
    const out: Array<[string, string]> = [];
    for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
      const c = String.fromCharCode(a, b), n = countryName(c);
      if (n && n !== c && !/unknown/i.test(n) && !NOT_COUNTRIES.has(c)) out.push([c, n]);
    }
    return out.filter(([, n], i) => out.findIndex(([, m]) => m === n) === i).sort((x, y) => x[1].localeCompare(y[1]));
  }, []);
  const countryList: Array<[string, string]> = isCompany ? allCountries : [...new Set(forType.map((r) => r.country))].map((c) => [c, COUNTRY[c] ?? countryName(c)]);
  const country = countryList.some(([c]) => c === f.country) ? f.country : isCompany ? 'GB' : countryList[0]?.[0] ?? '';
  const configured = forType.some((r) => r.country === country);
  const regionOpts = [...new Set(forType.filter((r) => r.country === country).flatMap((r) => r.regions))];
  const region = regionOpts.length ? (regionOpts.includes(f.region) ? f.region : regionOpts[0]) : '';
  const reg = forType.find((r) => r.country === country && (r.regions.length === 0 || r.regions.includes(region)));
  const subjectType = isCompany ? 'business' : reg?.subject_type;
  const looksLikeCompany = COMPANY_WORDS.test(f.name);
  const blocked = !!reg?.blocked && !f.license_number.trim();
  const cname = countryName(country);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const v: Record<string, string> = {};
    if (f.name.trim().length < 2) v.name = 'Enter the full name of the person or business (at least 2 characters).';
    if (f.source_url && !/^https:\/\//i.test(f.source_url)) v.source_url = 'Registry URL must start with https://';
    setErrs(v);
    if (Object.keys(v).length || (!reg && !isCompany) || blocked) return;
    setBusy(true); setFail(null);
    key.current ||= crypto.randomUUID(); // same key on retry of this exact submission => no duplicate run
    try {
      const r = await api<{ id: string }>('/api/v1/verifications', {
        method: 'POST', idempotencyKey: key.current,
        json: { name: f.name.trim(), subject_type: subjectType, record_type: f.record_type, country, region: region || null, license_number: f.license_number || null, source_url: f.source_url || null },
      });
      router.push(`/results/${r.id}`);
    } catch (err) { setFail(err as ApiFail); setBusy(false); }
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { key.current = ''; setF({ ...f, [k]: e.target.value }); };

  return (
    <div>
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow mb-2">Official records verification</p>
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">Trust, verified <span className="rounded-lg bg-lime px-2 text-lime-ink">at the source.</span></h1>
        <p className="mt-3 text-[15px] text-mute">Check a licence or company registration against the official register, see exactly where the answer came from, and get alerted if it changes. No account needed.</p>
      </header>

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_300px]">
        <section aria-label="Verification form">
          {loadErr && <Notice tone="bad" title="Could not load supported registries">{loadErr}</Notice>}
          {!regs && !loadErr && <Loading label="Loading supported registries" />}
          {regs && (
            <form onSubmit={submit} className="card-strong grid gap-6 p-5 sm:p-6" noValidate>
              <fieldset>
                <legend className="label">1 · What are you checking?</legend>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5" role="radiogroup">
                  {TYPES.map((t) => (
                    <label key={t.id} className="choice">
                      <input type="radio" name="record_type" value={t.id} checked={f.record_type === t.id} onChange={set('record_type')} />
                      <span className="flex items-start gap-3">
                        <Glyph cells={t.icon} on={f.record_type === t.id} />
                        <span><span className="block font-semibold leading-tight">{t.title}</span><span className="hint">{t.desc}</span></span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <label className="label" htmlFor="nm">2 · {subjectType === 'business' ? 'Business name' : 'Full name'}</label>
                <input id="nm" className="field field-lg" value={f.name} onChange={set('name')} placeholder={isCompany ? 'e.g. Tesco PLC' : 'e.g. Jane Smith'}
                  aria-invalid={!!errs.name} aria-describedby="nm-err" autoComplete="off" />
                {errs.name && <p id="nm-err" className="mt-1.5 text-xs font-medium" style={{ color: 'var(--bad)' }}>{errs.name}</p>}
                {!isCompany && looksLikeCompany && (
                  <div className="mt-2"><Notice tone="warn" title="This looks like a company name">Choose “Company” above to search a company register.</Notice></div>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="co">3 · Country</label>
                  <select id="co" className="field" value={country} onChange={set('country')}>
                    {countryList.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                  <p className="hint mt-1.5">Each register only covers its own jurisdiction.</p>
                </div>
                {regionOpts.length > 0 ? (
                  <div>
                    <label className="label" htmlFor="rg">State / province</label>
                    <select id="rg" className="field" value={region} onChange={set('region')}>{regionOpts.map((r) => <option key={r}>{r}</option>)}</select>
                  </div>
                ) : (
                  <div>
                    <label className="label" htmlFor="ln">{isCompany ? 'Company number (optional)' : 'Licence number (optional)'}</label>
                    <input id="ln" className="field mono" value={f.license_number} onChange={set('license_number')} autoComplete="off" placeholder={country === 'GB' ? '00445790' : country === 'IN' ? '21-character CIN' : ''} />
                    <p className="hint mt-1.5">Removes look-alike names.</p>
                  </div>
                )}
              </div>
              {regionOpts.length > 0 && (
                <div>
                  <label className="label" htmlFor="ln2">Licence number (optional)</label>
                  <input id="ln2" className="field mono" value={f.license_number} onChange={set('license_number')} autoComplete="off" />
                </div>
              )}

              <details>
                <summary className="text-[13px] font-medium">Know the official registry URL?</summary>
                <div className="mt-2">
                  <input aria-label="Official registry URL" className="field mono" placeholder="https://…" value={f.source_url} onChange={set('source_url')} aria-invalid={!!errs.source_url} />
                  {errs.source_url && <p className="mt-1.5 text-xs font-medium" style={{ color: 'var(--bad)' }}>{errs.source_url}</p>}
                  <p className="hint mt-1.5">Must be https on an official government or register domain; anything else is refused.</p>
                </div>
              </details>

              {blocked && <Notice tone="warn" title="This registry cannot be searched automatically">{reg?.blocked}</Notice>}
              {isCompany && !configured && (
                <Notice tone="info" title={`No built-in register for ${cname}`}>
                  Verity will look for {cname}&apos;s official government company register when you submit. Results from discovered registers are capped at medium confidence.
                </Notice>
              )}
              {fail && (
                <Notice tone="bad" title={['unsupported_jurisdiction', 'unsupported_record_type', 'registry_unavailable', 'registry_not_configured'].includes(fail.code) ? 'Not available' : 'Could not start verification'}>{fail.message}</Notice>
              )}

              <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
                <button className="btn btn-primary px-5 py-2.5" disabled={busy || (!reg && !isCompany) || blocked} type="submit">{busy ? 'Starting…' : fail?.retryable ? 'Retry' : 'Verify record'}</button>
                <span className="hint">{reg && !isCompany ? reg.name : 'Searches the official register live. This can take up to a minute.'}</span>
              </div>
            </form>
          )}
        </section>

        <aside className="grid content-start gap-4">
          <div className="card p-5">
            <h2 className="eyebrow mb-3">Every result answers</h2>
            <ol className="grid gap-2.5 text-[13.5px]">
              {['What official record was found?', 'Why does it match your search?', 'What is its status at the source?', 'Where can you check it yourself?', 'What happens if it changes?'].map((q, i) => (
                <li key={q} className="flex gap-3"><span className="mono mt-0.5 text-mute">0{i + 1}</span><span>{q}</span></li>
              ))}
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
