'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiFail, fmt, usePoll } from '@/lib/client';
import type { VerificationResult } from '@/lib/schemas';
import { Badge, JsonViewer, Loading, Meter, Notice, SourceLink, Stamp, useToast } from '@/components/ui';

const STAGES: Array<[string, string, string]> = [
  ['finding_source', 'Finding source', 'Locating the official register'],
  ['searching_registry', 'Searching registry', 'Running the search on the live register'],
  ['comparing_records', 'Comparing records', 'Matching results against your search'],
  ['verifying_evidence', 'Verifying evidence', 'Reading the record and re-checking the page'],
];
const ACTIVE = (r: VerificationResult) => r.state === 'queued' || r.state === 'running';
const LABEL: Record<string, string> = { medical_license: 'Medical licence', contractor_license: 'Contractor licence', company_registration: 'Company registration' };

export default function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const { data: r, error, reload, resume } = usePoll(() => api<VerificationResult>(`/api/v1/verifications/${id}`), (v) => !ACTIVE(v), 2500);
  const [busy, setBusy] = useState<string | null>(null);
  const [monErr, setMonErr] = useState<string | null>(null);

  if (error && !r) return <Notice tone="bad" title={error.status === 404 ? 'Verification not found' : 'Could not load this verification'}>{error.message} <Link className="underline" href="/">Start a new one</Link></Notice>;
  if (!r) return <Loading label="Loading verification" />;

  const v = r.verification;
  const act = async (name: string, fn: () => Promise<void>) => { setBusy(name); try { await fn(); } catch (e) { toast((e as ApiFail).message, 'bad'); } finally { setBusy(null); } };
  const retry = () => act('retry', async () => { const n = await api<{ id: string }>(`/api/v1/verifications/${id}/retry`, { method: 'POST' }); router.push(`/results/${n.id}`); });
  const select = (cid: string) => act(cid, async () => { await api(`/api/v1/verifications/${id}/select`, { method: 'POST', json: { candidate_id: cid } }); resume(); });
  const watch = () => act('watch', async () => {
    setMonErr(null);
    try { await api('/api/v1/monitors', { method: 'POST', json: { verification_id: id } }); toast('Monitor created at TinyFish'); await reload(); }
    catch (e) { setMonErr((e as ApiFail).message); throw e; }
  });
  const canWatch = r.state === 'completed' && !!r.record && ['verified', 'partially_verified'].includes(v.outcome ?? '') && r.monitoring.status === 'not_configured';
  const json = { ...r, history: undefined };
  const place = `${r.jurisdiction.country}${r.jurisdiction.region ? `-${r.jurisdiction.region}` : ''}`;
  const curStage = STAGES.findIndex(([s]) => s === r.stage);

  return (
    <div className="grid gap-6">
      <header>
        <p className="hint mb-2"><Link href="/results" className="underline">Results</Link> <span className="mx-1">/</span> <span className="mono">{r.id}</span></p>
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{r.subject.name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-mute">
          <span>{LABEL[r.record?.type ?? ''] ?? (r.subject.type === 'business' ? 'Business record' : 'Professional record')}</span>
          <span className="mono border border-line bg-panel px-1.5">{place}</span>
          {v.source_name && <span>{v.source_name}</span>}
        </p>
      </header>

      {ACTIVE(r) && (
        <section className="card-strong p-5" aria-live="polite">
          <div className="scan mb-4 w-28" aria-hidden />
          <p className="font-semibold">Verification in progress</p>
          <ol className="mt-4 grid gap-0">
            {STAGES.map(([k, label, desc], i) => {
              const state = r.stage === null ? 'wait' : i < curStage ? 'done' : i === curStage ? 'now' : 'wait';
              return (
                <li key={k} className={`flex gap-3 border-l-2 py-2 pl-4 ${state === 'wait' ? 'border-line text-mute' : state === 'now' ? 'border-ink' : 'border-ok'}`}>
                  <span className={`sq mt-1.5 ${state === 'now' ? 'blink' : ''}`} style={{ background: state === 'done' ? 'var(--ok)' : state === 'now' ? 'var(--ink)' : 'var(--line)' }} aria-hidden />
                  <span><span className="font-medium">{label}{state === 'now' && '…'}{state === 'done' && <span className="hint ml-2">done</span>}</span>
                    {state !== 'wait' && <span className="hint block">{desc}</span>}</span>
                </li>
              );
            })}
          </ol>
          <p className="hint mt-3">A step only appears once it is actually running. Registry searches can take a minute or more; you can leave this page and come back.</p>
        </section>
      )}

      {r.state === 'failed' && (
        <Notice tone="bad" title={v.outcome === 'temporarily_unavailable' ? 'Registry temporarily unavailable' : 'Verification failed'}>
          <p>{r.error?.message ?? 'The verification did not complete.'}</p>
          <p className="hint mt-1">No licence status was determined. This is not evidence that the record is expired, suspended or missing.</p>
          <button className="btn btn-sm mt-3" onClick={retry} disabled={busy === 'retry'}>Retry verification</button>
        </Notice>
      )}

      {r.state === 'awaiting_selection' && (
        <section>
          <Notice tone="warn" title={`${r.candidates.length} possible matches`}>Choose the correct record. Verity will not guess, and candidates are never merged.</Notice>
          <div className="card mt-3 overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Name</th><th>Number</th><th>Profession</th><th>Status</th><th>Location / organisation</th><th /></tr></thead>
              <tbody>
                {r.candidates.map((c) => (
                  <tr key={c.id}>
                    <td className="font-semibold">{c.full_name}</td>
                    <td className="mono">{c.license_number ?? '—'}</td>
                    <td>{c.profession ?? '—'}</td>
                    <td>{c.status_text ?? '—'}</td>
                    <td>{[c.location, c.organization].filter(Boolean).join(' · ') || '—'}</td>
                    <td className="text-right"><button className="btn btn-sm btn-primary" disabled={busy !== null} onClick={() => select(c.id)}>Select</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint mt-2">None of these? <Link className="underline" href="/">Refine the search</Link> with the registration number or a different spelling.</p>
        </section>
      )}

      {r.state === 'completed' && v.outcome === 'not_found' && (
        <Notice tone="warn" title="No matching record found">
          <p>The search of <b>{v.source_name}</b> returned no matching records at {fmt(v.checked_at)}.</p>
          <ul className="mt-1 list-disc pl-5">{v.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          <div className="mt-3 flex flex-wrap gap-2"><Link className="btn btn-sm" href="/">Try another spelling or number</Link><button className="btn btn-sm" onClick={retry} disabled={busy === 'retry'}>Retry search</button></div>
          <p className="mt-3"><SourceLink url={v.source_url}>Open the official registry</SourceLink></p>
        </Notice>
      )}

      {r.state === 'completed' && v.outcome === 'unsupported' && (
        <Notice tone="info" title="No official register available"><p>{v.limitations.join(' ')}</p></Notice>
      )}

      {r.state === 'completed' && r.record && (
        <>
          {v.outcome === 'partially_verified' && <Notice tone="warn" title="Partially verified">Some important fields could not be confirmed. Review the limitations below and confirm with the official source.</Notice>}

          <section className="card-strong rise">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line p-5">
              <Stamp value={r.record.status} />
              <div className="flex flex-wrap items-center gap-2"><Badge value={v.outcome} />{v.confidence && <Badge value={v.confidence} label={`${v.confidence} confidence`} />}</div>
              <span className="hint ml-auto">Last verified {fmt(v.checked_at)}</span>
            </div>
            <dl className="grid gap-x-8 gap-y-5 p-5 sm:grid-cols-2">
              <Item k="Matched record name" v={v.matched_name} big />
              <Item k="Licence / registration number" v={r.record.number} mono big />
              <Item k="Status as shown by the source" v={r.record.source_status} />
              <Item k="Normalized status" v={r.record.status} />
              <Item k="Issue / registration date" v={r.record.issue_date} mono />
              <Item k="Expiration date" v={r.record.expiry_date} mono />
              <div className="sm:col-span-2">
                <dt className="eyebrow mb-1">Disciplinary actions</dt>
                <dd>
                  {r.record.disciplinary_actions === null ? <span className="text-mute">Not available from this source</span>
                    : r.record.disciplinary_actions.length === 0 ? 'None shown by the source'
                    : <ul className="list-disc pl-5">{r.record.disciplinary_actions.map((d) => <li key={d}>{d}</li>)}</ul>}
                </dd>
              </div>
            </dl>
            <div className="grid gap-4 border-t border-line bg-sunk p-5 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="eyebrow mb-1">Official source</p>
                <SourceLink url={v.source_url} />
                <p className="hint mt-1">{v.source_name}</p>
              </div>
              <a className="btn btn-sm self-start" href={v.source_url ?? '#'} target="_blank" rel="noopener noreferrer">Open official source ↗</a>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card p-5">
              <div className="mb-2 flex items-center gap-3"><h2 className="font-semibold">Why this evidence rating?</h2><Meter level={v.confidence} /></div>
              <ul className="grid gap-1.5 text-[13.5px]">{v.confidence_reasons.map((c) => <li key={c} className="flex gap-2"><span className="sq mt-2 bg-mute" aria-hidden />{c}</li>)}</ul>
            </div>
            <div className="card p-5">
              <h2 className="mb-2 font-semibold">Limitations</h2>
              {v.limitations.length === 0 ? <p className="hint">None recorded.</p> : <ul className="grid gap-1.5 text-[13.5px]">{v.limitations.map((l) => <li key={l} className="flex gap-2"><span className="sq mt-2" style={{ background: 'var(--warn)' }} aria-hidden />{l}</li>)}</ul>}
            </div>
          </section>

          <section className="card p-5">
            <h2 className="font-semibold">Evidence</h2>
            <p className="hint mb-3">Retrieved {fmt(v.checked_at)}. Excerpts marked “confirmed” were found verbatim on an independently fetched copy of the page.</p>
            {v.evidence.length === 0 ? <p className="text-mute">No source excerpts were captured.</p> : (
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {v.evidence.map((e, i) => (
                  <li key={i} className="border border-line bg-sunk p-3">
                    <p className="mb-1 flex items-center gap-2 text-xs"><span className="eyebrow">{e.fields.join(', ')}</span>
                      <span className={`tone-${e.validated ? 'ok' : 'mute'} inline-flex items-center gap-1`}><span className="sq" style={{ background: 'var(--t)' }} aria-hidden />{e.validated ? 'confirmed on fetched page' : 'not independently confirmed'}</span></p>
                    <blockquote className="mono whitespace-pre-wrap break-words">{e.excerpt}</blockquote>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {r.state === 'completed' && (
        <section className="flex flex-wrap items-center gap-2.5">
          {r.monitoring.status !== 'not_configured'
            ? <span className="hint inline-flex items-center gap-2">Monitoring: <Badge value={r.monitoring.status} /> <Link className="underline" href="/watchlist">View in Watchlist</Link></span>
            : <button className="btn btn-primary" onClick={watch} disabled={!canWatch || busy === 'watch'} title={canWatch ? '' : 'Needs a verified record with a direct official page'}>{busy === 'watch' ? 'Creating monitor…' : 'Add to Watchlist'}</button>}
          <button className="btn" onClick={retry} disabled={busy === 'retry'}>Retry verification</button>
          <a className="btn btn-ghost" href="#history">View verification history</a>
        </section>
      )}
      {monErr && <Notice tone="bad" title="Monitor not created">{monErr}</Notice>}

      {(r.state === 'completed' || r.state === 'failed') && (r.record || r.error) && (
        <details className="group">
          <summary className="mb-2 text-[13px] font-semibold">Structured JSON</summary>
          <JsonViewer value={json} filename={`${r.id}.json`} />
        </details>
      )}

      <section id="history" className="card p-5">
        <h2 className="mb-3 font-semibold">Verification history</h2>
        {r.history.length === 0 ? <p className="hint">No events yet.</p> : (
          <ol className="grid gap-0">
            {r.history.map((h, i) => (
              <li key={i} className="flex gap-3 border-l-2 border-line py-1.5 pl-4">
                <span className="mono shrink-0 text-mute">{fmt(h.at)}</span><span className="min-w-0 break-words">{h.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Item({ k, v, mono, big }: { k: string; v: string | null; mono?: boolean; big?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow mb-1">{k}</dt>
      <dd className={`${mono ? 'mono' : ''} ${big ? 'text-base font-semibold' : ''} break-words`}>{v ?? <span className="font-normal text-mute">Not available</span>}</dd>
    </div>
  );
}
