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
      <h1 className="text-2xl font-bold">Results</h1>
      <p className="hint mb-4">Your verification history.</p>
      {err && <Notice tone="bad" title="Could not load results">{err}</Notice>}
      {!rows && !err && <Loading />}
      {rows && rows.length === 0 && <Empty title="No verifications yet"><Link className="underline" href="/">Verify a record</Link> to see it here.</Empty>}
      {rows && rows.length > 0 && (
        <div className="card overflow-x-auto">
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
