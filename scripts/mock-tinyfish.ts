/**
 * SIMULATED TinyFish provider for the Playwright e2e suite ONLY.
 * Mirrors the documented contracts of Search, Fetch, Agent and Monitor. Never used in real deployments:
 * it refuses to start unless VERITY_E2E=1, and the app reports provider="simulated" on /api/health.
 */
import http from 'node:http';

if (process.env.VERITY_E2E !== '1') { console.error('mock-tinyfish is for e2e tests only (set VERITY_E2E=1).'); process.exit(1); }

const URL_A = 'https://www.gmc-uk.org/doctors/A12345';
const state = { suspended: false, runs: new Map<string, any>(), n: 0, monitorStatus: 'active', pageVersion: 1, mid: 0 };

const cand = (name: string, num: string) => ({ full_name: name, license_number: num, profession: 'Physician and Surgeon', status_text: 'Active', location: 'LOS ANGELES, CA', organization: null, record_url: `https://www.gmc-uk.org/doctors/${num}` });

function searchFor(goal: string) {
  if (/Jane Roe/.test(goal)) return { search_performed: true, no_results: false, candidates: [cand('ROE, JANE', 'A12345')] };
  if (/Sam Smith/.test(goal)) return { search_performed: true, no_results: false, candidates: [cand('SMITH, SAM', 'B11111'), { ...cand('SMITH, SAM', 'B22222'), location: 'FRESNO, CA' }] };
  if (/Nobody Here/.test(goal)) return { search_performed: true, no_results: true, candidates: [] };
  return { search_performed: true, no_results: true, candidates: [] };
}
function detailFor(goal: string) {
  const num = /number (\w+)/.exec(goal)?.[1] ?? 'A12345';
  const status = state.suspended ? 'Suspended' : 'Active';
  return {
    record_opened: true, full_name: /SMITH/.test(goal) ? 'SAM SMITH' : 'JANE ROE', license_number: num, profession: 'Physician and Surgeon', status_text: status,
    issue_date_text: '01/15/2015', expiry_date_text: '03/31/2027', disciplinary_section_visible: true, disciplinary_actions: [],
    record_url: `https://www.gmc-uk.org/doctors/${num}`,
    excerpts: [{ field: 'status', text: `Status: ${status}` }, { field: 'expiry_date', text: 'Expiration: 03/31/2027' }],
  };
}
const pageText = (num = 'A12345') => `# Licence ${num}\nStatus: ${state.suspended ? 'Suspended' : 'Active'}\nExpiration: 03/31/2027\n(v${state.pageVersion})`;
const monitor = () => ({ id: `mock_mon_${state.mid}`, type: 'fetch', name: 'm', config: { url: URL_A, format: 'markdown' }, schedule_cron: '0 6 * * *', status: state.monitorStatus, last_error: null, webhook_url: null });

http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const u = new URL(req.url!, 'http://x');
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    const send = (o: unknown, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers['x-api-key'] !== 'test-key' && !u.pathname.startsWith('/__')) return send({ error: { code: 'INVALID_API_KEY', message: 'bad key' } }, 401);

    if (u.pathname === '/__control') { Object.assign(state, body); return send({ ok: true, state: { suspended: state.suspended, pageVersion: state.pageVersion } }); }
    if (req.method === 'GET' && u.pathname === '/') return send({ query: u.searchParams.get('query'), results: [{ position: 1, site_name: 'dca', title: 'DCA License Search', snippet: '', url: 'https://search.dca.ca.gov/' }], total_results: 1, page: 0 });
    if (req.method === 'POST' && u.pathname === '/') return send({ results: body.urls.map((url: string) => ({ url, final_url: url, title: 't', text: pageText(url.split('/').pop()), format: 'markdown' })), errors: [] });
    if (u.pathname === '/v1/automation/run-async') {
      const id = `mrun_${++state.n}`;
      const goal: string = body.goal;
      if (/Fail Case/.test(goal)) state.runs.set(id, { run_id: id, status: 'FAILED', result: null, error: { code: 'SITE_BLOCKED', category: 'AGENT_FAILURE', message: 'Target site blocked the automation.' } });
      else state.runs.set(id, { run_id: id, status: 'COMPLETED', result: goal.includes('Open the single record') ? detailFor(goal) : searchFor(goal) });
      return send({ run_id: id, error: null });
    }
    const rg = u.pathname.match(/^\/v1\/runs\/([^/]+)$/);
    if (rg) return state.runs.has(rg[1]) ? send(state.runs.get(rg[1])) : send({ error: { code: 'NOT_FOUND', message: 'x' } }, 404);
    if (u.pathname === '/v1/monitors' && req.method === 'POST') { state.mid++; state.monitorStatus = 'active'; } if (u.pathname === '/v1/monitors' && req.method === 'POST') return send({ monitor: monitor(), run: { id: 'mock_base', is_baseline: true, results: [{ url: body.config.url, final_url: body.config.url, text: pageText() }], errors: [] } }, 201);
    if (u.pathname.startsWith('/v1/monitors/mock_mon_')) {
      if (u.pathname.endsWith('/runs')) return send({ run: { id: `mock_run_${++state.n}`, is_baseline: false, results: [{ url: URL_A, text: pageText() }], errors: [] } }, 201);
      if (req.method === 'PATCH') { state.monitorStatus = body.status; return send(monitor()); }
      if (req.method === 'DELETE') return send({ deleted: true, id: u.pathname.split('/')[3] });
      return send(monitor());
    }
    send({ error: { code: 'NOT_FOUND', message: u.pathname } }, 404);
  });
}).listen(4010, '127.0.0.1', () => console.log('SIMULATED TinyFish on http://127.0.0.1:4010'));
