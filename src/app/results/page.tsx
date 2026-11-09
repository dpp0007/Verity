'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fmt } from '@/lib/client';
import { Badge, Empty, Loading, Notice } from '@/components/ui';

interface Row { id: string; name: string; record_type: string; country: string; region: string | null; state: string; outcome: string | null; status: string | null; created_at: string }

export default function ResultsIndex() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<{ verifications: Row[] }>('/api/v1/verifications').then((d) => setRows(d.verifications)).catch((e) => setErr(e.message)); }, []);
  return (
    <section>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h1 className="text-[28px] font-semibold">Results</h1>
        <span className="pill live"><i />Checked live</span>
      </div>
      {err && <Notice tone="bad" title="Could not load results">{err}</Notice>}
      {!rows && !err && <Loading />}
      {rows && rows.length === 0 && <Empty title="No verifications yet"><Link className="underline" href="/">Verify a record</Link> to see it here.</Empty>}
      {rows && rows.length > 0 && (
        <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          {[
            ['Checks', rows.length, 'all time'],
            ['Verified', rows.filter((r) => r.outcome === 'verified').length, 'confirmed at the source'],
            ['Needs review', rows.filter((r) => r.outcome === 'partially_verified' || r.outcome === 'ambiguous' || r.state === 'awaiting_selection').length, 'partial or several matches'],
            ['Unavailable', rows.filter((r) => r.state === 'failed' || r.outcome === 'temporarily_unavailable').length, 'not evidence of anything'],
          ].map(([k, n, sub]) => (
            <div key={String(k)} className="card p-4">
              <p className="text-[13px] text-mute">{k}</p>
              <p className="stat mt-1">{n}</p>
              <p className="hint mt-1">{sub}</p>
            </div>
          ))}
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="panel-h"><span className="tile" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></svg></span><h2>Verification history</h2></div>
          <table className="tbl">
            <thead><tr><th>Subject</th><th>Record</th><th>Jurisdiction</th><th>Outcome</th><th>Status</th><th>Requested</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link className="underline" href={`/results/${r.id}`}>{r.name}</Link></td>
                  <td>{r.record_type.replace('_', ' ')}</td>
                  <td className="mono">{r.country}{r.region ? `-${r.region}` : ''}</td>
                  <td><Badge value={r.outcome ?? (r.state === 'awaiting_selection' ? 'ambiguous' : r.state)} /></td>
                  <td>{r.status ? <Badge value={r.status} /> : '—'}</td>
                  <td className="hint">{fmt(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
