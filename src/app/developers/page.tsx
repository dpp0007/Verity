'use client';
import { useEffect, useState } from 'react';
import { api, fmt } from '@/lib/client';
import { Empty, JsonViewer, Loading, Notice } from '@/components/ui';
import { ERROR_CODES, openapi } from '@/lib/openapi';

interface Ev { id: string; type: string; message: string; refs: Record<string, string>; at: string }

const EXAMPLE_REQ = { name: 'EXAMPLE NAME', subject_type: 'person', record_type: 'medical_license', country: 'US', region: 'CA', license_number: null, source_url: null };
const EXAMPLE_RES = {
  id: 'ver_example_123', state: 'completed', subject: { type: 'person', name: 'Example Professional' },
  record: { type: 'medical_license', number: 'SOURCE_PROVIDED_NUMBER', status: 'active', source_status: 'Active', issue_date: null, expiry_date: null, disciplinary_actions: null },
  jurisdiction: { country: 'US', region: 'CA' },
  verification: { outcome: 'verified', confidence: 'high', checked_at: '2026-11-03T00:00:00Z', source_name: 'Official Registry', source_url: 'https://official-registry.example/record', evidence: [], limitations: [] },
  monitoring: { enabled: false, monitor_id: null, status: 'not_configured' },
};
const WEBHOOK = { fetch_monitor_id: '<tinyfish monitor id>', id: '<monitor run id>', is_baseline: false, outcome: 'changed', diff: '<unified diff>', judgment: { purpose: '…', is_relevant: true, summary: '…', error: null }, results: [{ url: '…', text: '…' }], errors: [] };

export default function Developers() {
  const [ev, setEv] = useState<Ev[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<{ events: Ev[] }>('/api/v1/activity').then((d) => setEv(d.events)).catch((e) => setErr(e.message)); }, []);
  const base = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">API &amp; Activity</h1>
        <p className="hint">Versioned REST API at <span className="mono">/api/v1</span>. Machine-readable spec: <a className="underline mono" href="/api/v1/openapi">/api/v1/openapi</a>.</p>
      </div>

      <section className="card p-5 text-sm grid gap-2">
        <h2 className="font-semibold">Authentication</h2>
        <p>Browser sessions use an anonymous, httpOnly owner cookie; records are private to that owner. Programmatic clients send <span className="mono">Authorization: Bearer &lt;key&gt;</span> (keys are configured server-side in <span className="mono">VERITY_API_KEYS</span>). TinyFish credentials never reach the client.</p>
        <h2 className="font-semibold mt-2">Monitoring workflow</h2>
        <ol className="list-decimal pl-5">
          <li><span className="mono">POST /verifications</span> and poll until <span className="mono">state = completed</span>.</li>
          <li><span className="mono">POST /monitors</span> with the <span className="mono">verification_id</span>: Verity creates a TinyFish Page Monitor on the official record URL and stores its baseline.</li>
          <li>TinyFish calls <span className="mono">POST /webhooks/tinyfish</span> on each scheduled run. A page change triggers a re-verification; alerts are created only for real field changes.</li>
          <li><span className="mono">PATCH</span> to pause/resume, <span className="mono">POST …/check</span> to run now, <span className="mono">DELETE</span> to remove.</li>
        </ol>
      </section>

      <section className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
          <tbody>
            {Object.entries(openapi.paths).flatMap(([p, ops]) => Object.entries(ops as Record<string, { summary?: string }>).map(([m, o]) => (
              <tr key={m + p}><td className="mono uppercase">{m}</td><td className="mono">{p}</td><td>{o.summary}</td></tr>
            )))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3">
        <h2 className="font-semibold">Examples <span className="hint font-normal">(schema examples, not live results)</span></h2>
        <pre className="card mono p-3 overflow-x-auto bg-sunk">{`curl -X POST ${base}/api/v1/verifications \\\n  -H "Authorization: Bearer $VERITY_KEY" -H "Content-Type: application/json" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  -d '${JSON.stringify(EXAMPLE_REQ)}'`}</pre>
        <JsonViewer value={EXAMPLE_RES} filename="verification.schema-example.json" />
        <JsonViewer value={WEBHOOK} filename="webhook.schema-example.json" />
      </section>

      <section className="card overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Error code</th><th>HTTP</th><th>Meaning</th></tr></thead>
          <tbody>{ERROR_CODES.map(([c, s, m]) => <tr key={c}><td className="mono">{c}</td><td className="mono">{s}</td><td>{m}</td></tr>)}</tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Activity</h2>
        {err && <Notice tone="bad" title="Could not load activity">{err}</Notice>}
        {!ev && !err && <Loading />}
        {ev && ev.length === 0 && <Empty title="No activity yet">Events appear as you verify records and monitor them.</Empty>}
        {ev && ev.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Time</th><th>Event</th><th>Detail</th><th>Ids</th></tr></thead>
              <tbody>{ev.map((e) => (
                <tr key={e.id}>
                  <td className="mono whitespace-nowrap">{fmt(e.at)}</td><td className="mono">{e.type}</td><td>{e.message}</td>
                  <td className="mono text-xs">{Object.entries(e.refs).filter(([, v]) => v).map(([k, v]) => <div key={k}>{k}={v}</div>)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
