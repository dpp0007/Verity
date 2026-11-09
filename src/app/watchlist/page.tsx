'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiFail, fmt } from '@/lib/client';
import { Badge, Confirm, Empty, Loading, Notice, SourceLink, useToast } from '@/components/ui';

interface Mon {
  id: string; verification_id: string; status: string; subject: { name: string }; record_type: string; jurisdiction: { country: string; region: string | null };
  registry_name: string; source_url: string; current_status: string; webhook_active: boolean; last_checked_at: string | null; last_success_at: string | null;
  last_change_at: string | null; last_error: string | null; latest_alert: { field: string; previous: string | null; next: string | null; detected_at: string } | null;
  runs: Array<{ id: string; outcome: string; ok: boolean; error: string | null; at: string }>;
}
interface Alert { id: string; subject: string; field: string; previous: string | null; next: string | null; source_url: string; detected_at: string; run_id: string | null; evidence: { excerpts?: Array<{ excerpt: string | null; validated: boolean }> } }

export default function Watchlist() {
  const toast = useToast();
  const [mons, setMons] = useState<Mon[] | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rm, setRm] = useState<Mon | null>(null);
  const [fl, setFl] = useState({ status: '', country: '', type: '', state: '' });

  const load = useCallback(async () => {
    try {
      const [m, a] = await Promise.all([api<{ monitors: Mon[] }>('/api/v1/monitors'), api<{ alerts: Alert[] }>('/api/v1/activity')]);
      setMons(m.monitors); setAlerts(a.alerts); setErr(null);
    } catch (e) { setErr((e as ApiFail).message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    try { await fn(); toast(ok); await load(); } catch (e) { toast((e as ApiFail).message, 'bad'); await load(); } finally { setBusy(null); }
  };
  const rows = useMemo(() => (mons ?? []).filter((m) =>
    (!fl.status || m.current_status === fl.status) && (!fl.country || m.jurisdiction.country === fl.country) && (!fl.type || m.record_type === fl.type) && (!fl.state || m.status === fl.state)), [mons, fl]);
  const uniq = (f: (m: Mon) => string) => [...new Set((mons ?? []).map(f))];

  return (
    <section className="grid gap-5">
      <div>
        <p className="eyebrow mb-1">Monitoring</p><h1 className="text-2xl font-bold">Watchlist</h1>
        <p className="hint">Records monitored by TinyFish page monitors. Alerts are created only when a re-verified field actually changes.</p>
      </div>
      {err && <Notice tone="bad" title="Could not load the watchlist">{err}</Notice>}
      {!mons && !err && <Loading />}
      {mons && mons.length === 0 && <Empty title="Nothing is being monitored"><Link className="underline" href="/">Verify a record</Link>, then choose “Add to Watchlist”.</Empty>}
      {mons && mons.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filters">
            <Sel label="Status" v={fl.status} set={(v) => setFl({ ...fl, status: v })} opts={uniq((m) => m.current_status)} />
            <Sel label="Jurisdiction" v={fl.country} set={(v) => setFl({ ...fl, country: v })} opts={uniq((m) => m.jurisdiction.country)} />
            <Sel label="Record type" v={fl.type} set={(v) => setFl({ ...fl, type: v })} opts={uniq((m) => m.record_type)} />
            <Sel label="Monitoring" v={fl.state} set={(v) => setFl({ ...fl, state: v })} opts={uniq((m) => m.status)} />
          </div>
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Subject</th><th>Record</th><th>Status</th><th>Monitoring</th><th>Last successful check</th><th>Last change</th><th>Latest alert</th><th>Actions</th></tr></thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td><Link className="underline font-medium" href={`/results/${m.verification_id}`}>{m.subject.name}</Link><div className="hint">{m.registry_name}</div></td>
                    <td>{m.record_type.replace('_', ' ')}<div className="mono hint">{m.jurisdiction.country}{m.jurisdiction.region ? `-${m.jurisdiction.region}` : ''}</div></td>
                    <td><Badge value={m.current_status} /></td>
                    <td>
                      <Badge value={m.status} />
                      {!m.webhook_active && <div className="hint">Manual checks only (no public webhook)</div>}
                      {m.last_error && <div className="text-bad text-xs mt-1" role="alert">Check error: {m.last_error}</div>}
                    </td>
                    <td className="hint">{fmt(m.last_success_at)}</td>
                    <td className="hint">{fmt(m.last_change_at)}</td>
                    <td className="text-xs">{m.latest_alert ? <>{m.latest_alert.field}: <span className="mono">{m.latest_alert.previous ?? '—'} → {m.latest_alert.next ?? '—'}</span></> : '—'}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <button className="btn btn-sm" disabled={busy !== null || !['active', 'paused', 'failed'].includes(m.status)} onClick={() => run(m.id + 'c', () => api(`/api/v1/monitors/${m.id}/check`, { method: 'POST' }), 'Check completed')}>{busy === m.id + 'c' ? 'Checking…' : 'Check now'}</button>
                        {m.status === 'active' && <button className="btn btn-sm" disabled={busy !== null} onClick={() => run(m.id + 'p', () => api(`/api/v1/monitors/${m.id}`, { method: 'PATCH', json: { status: 'paused' } }), 'Monitor paused')}>Pause</button>}
                        {m.status === 'paused' && <button className="btn btn-sm" disabled={busy !== null} onClick={() => run(m.id + 'r', () => api(`/api/v1/monitors/${m.id}`, { method: 'PATCH', json: { status: 'active' } }), 'Monitor resumed')}>Resume</button>}
                        <button className="btn btn-sm" disabled={busy !== null} onClick={() => setRm(m)}>Remove</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="hint p-3">No monitors match these filters.</p>}
          </div>
        </>
      )}

      <div>
        <h2 className="font-semibold mb-2">Alerts</h2>
        {alerts.length === 0 ? <Empty title="No alerts">Alerts appear when a monitored record&apos;s status, expiry or disciplinary information changes.</Empty> : (
          <ul className="grid gap-2">
            {alerts.map((a) => (
              <li key={a.id} className="card p-3.5" style={{ borderLeft: '4px solid var(--warn)' }}>
                <p className="font-medium">{a.subject} · {a.field.replace('_', ' ')} changed</p>
                <p className="mono">{a.previous ?? '—'} → {a.next ?? '—'}</p>
                <p className="hint">Detected {fmt(a.detected_at)}{a.run_id ? ` · run ${a.run_id}` : ''}</p>
                {a.evidence.excerpts?.[0]?.excerpt && <blockquote className="mono mt-1 whitespace-pre-wrap break-words border-l-2 border-line pl-2">{a.evidence.excerpts[0].excerpt}</blockquote>}
                <SourceLink url={a.source_url} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <Confirm open={!!rm} title="Remove this monitor?" confirmLabel="Remove monitor" onCancel={() => setRm(null)}
        body={<>This deletes the TinyFish monitor for <b>{rm?.subject.name}</b>. Past alerts are kept.</>}
        onConfirm={() => { const m = rm!; setRm(null); run(m.id + 'x', () => api(`/api/v1/monitors/${m.id}`, { method: 'DELETE' }), 'Monitor removed'); }} />
    </section>
  );
}

function Sel({ label, v, set, opts }: { label: string; v: string; set: (v: string) => void; opts: string[] }) {
  return (
    <label className="text-xs">
      <span className="hint mr-1">{label}</span>
      <select className="field !w-auto !py-1" value={v} onChange={(e) => set(e.target.value)}>
        <option value="">All</option>{opts.map((o) => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
      </select>
    </label>
  );
}
